import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { extractOAuthToken } from './auth.js';

// Resolve paths lazily to avoid circular dependency with db.ts
const DATA_DIR = join(os.homedir(), '.beepbot-v2');

function getWorkspaceDir(): string {
  return join(DATA_DIR, 'workspace');
}

function getMemoryDir(): string {
  return join(DATA_DIR, 'workspace', 'memory');
}

export interface MemoryFact {
  text: string;
  category: 'preference' | 'project' | 'decision' | 'event' | 'fact' | 'other';
  importance: 'low' | 'medium' | 'high';
  contradiction?: {
    supersedes: string;
    reason: string;
  };
}

export interface StoredMemory {
  content: string;
  category: string;
  importance: string;
  created_at: string;
}

/** Make a cheap Haiku API call using the OAuth token as x-api-key */
async function callHaiku(oauthToken: string, systemPrompt: string, userMessage: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': oauthToken,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1000,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Haiku API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  const textBlock = data.content?.find(b => b.type === 'text');
  return textBlock?.text || '';
}

/** Initialize memory tables in the SQLite database */
export function initMemoryTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT, -- preference | project | decision | event | fact | other
      importance TEXT CHECK(importance IN ('low', 'medium', 'high')) DEFAULT 'medium',
      source_file TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      superseded_by TEXT,
      tags TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content, category, tokenize='porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS memory_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

/** Heuristic filter to determine if a conversation turn is worth remembering */
export function heuristicWorthRemembering(responseText: string, userMessage: string): boolean {
  if (!responseText || responseText.length < 40) {
    return false;
  }

  const lowerResponse = responseText.toLowerCase();
  const lowerUser = userMessage.toLowerCase();

  // Skip heartbeats, simple acks, and error messages
  if (lowerResponse.includes('heartbeat_ok') || 
      lowerResponse.match(/^(ok|yes|no|done|sure|got it|understood)\.?\s*$/i) ||
      lowerResponse.includes('error:') ||
      lowerResponse.includes('failed to') ||
      lowerResponse.includes('cannot') && lowerResponse.length < 100) {
    return false;
  }

  // Check for memory keywords
  const memoryKeywords = [
    'remember', 'note that', 'prefer', 'decision', 'update', 'project', 'important',
    'always', 'never', 'don\'t forget', 'keep in mind', 'learned', 'discovered',
    'configuration', 'setting', 'workflow', 'process', 'habit'
  ];

  for (const keyword of memoryKeywords) {
    if (lowerResponse.includes(keyword) || lowerUser.includes(keyword)) {
      return true;
    }
  }

  // Check for user memory requests
  const userMemoryKeywords = ['remember', 'note', 'don\'t forget', 'keep track', 'save this'];
  for (const keyword of userMemoryKeywords) {
    if (lowerUser.includes(keyword)) {
      return true;
    }
  }

  // Check for structured content (lists, multiple lines of substance)
  const lines = responseText.split('\n').filter(line => line.trim().length > 0);
  if (lines.length > 3) {
    return true;
  }

  // Check for numbered or bulleted lists
  if (responseText.match(/^\s*[1-9]\.\s/m) || responseText.match(/^\s*[-*•]\s/m)) {
    return true;
  }

  return false;
}

/** 
 * Extract structured memories from a conversation turn using a dedicated Haiku SDK session.
 * Uses the same OAuth flow as the main agent — no API key needed.
 */
export async function extractMemories(
  db: Database.Database, 
  responseText: string, 
  userMessage: string
): Promise<MemoryFact[]> {
  const oauthToken = extractOAuthToken();
  if (!oauthToken) {
    console.warn('[memory] No OAuth token for memory extraction');
    return [];
  }

  try {
    // Get recent facts for contradiction checking
    const recentFacts = db.prepare(`
      SELECT content, category FROM memories 
      WHERE created_at >= datetime('now', '-7 days') AND superseded_by IS NULL
      ORDER BY created_at DESC LIMIT 20
    `).all() as Array<{ content: string; category: string }>;

    const recentContext = recentFacts.length > 0 
      ? `\nRecent stored facts (check for contradictions):\n${recentFacts.map(f => `- [${f.category}] ${f.content}`).join('\n')}`
      : '';

    const extractionPrompt = `Extract memorable facts from this conversation turn. Only extract durable, actionable information.

User said: ${userMessage.slice(0, 500)}
Assistant replied: ${responseText.slice(0, 1000)}
${recentContext}

Extract 1-8 atomic facts. For each, output one line in this exact format:
FACT|category|importance|text

Categories: preference, project, decision, event, fact, other
Importance: low, medium, high

If a fact contradicts a recent stored fact, add: |SUPERSEDES: old fact text

Example output:
FACT|preference|high|User prefers Vim over VS Code for config files
FACT|project|medium|Project deadline is March 20, 2026
FACT|preference|medium|User wants dark mode in all apps|SUPERSEDES: User preferred light mode

Only output FACT lines. No other text.`;

    const result = await callHaiku(
      oauthToken,
      'You are a memory extraction system. Extract only durable, important facts from conversations. Be precise and concise. Output only FACT lines in the specified format.',
      extractionPrompt
    );
    return parseFactLines(result);
  } catch (err) {
    console.warn('[memory] Haiku extraction failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** Parse FACT|category|importance|text lines from Haiku response */
function parseFactLines(response: string): MemoryFact[] {
  const facts: MemoryFact[] = [];
  const lines = response.split('\n').filter(l => l.trim().startsWith('FACT|'));

  for (const line of lines) {
    const parts = line.trim().split('|');
    if (parts.length < 4) continue;

    const category = parts[1]?.trim() as MemoryFact['category'];
    const importance = parts[2]?.trim() as MemoryFact['importance'];
    const text = parts[3]?.trim();

    if (!text || text.length < 5) continue;
    if (!['preference', 'project', 'decision', 'event', 'fact', 'other'].includes(category)) continue;
    if (!['low', 'medium', 'high'].includes(importance)) continue;

    const fact: MemoryFact = { text, category, importance };

    // Check for SUPERSEDES marker
    const supersedesIdx = line.indexOf('|SUPERSEDES:');
    if (supersedesIdx !== -1) {
      const supersededText = line.slice(supersedesIdx + 12).trim();
      if (supersededText) {
        fact.contradiction = { supersedes: supersededText, reason: 'Updated information' };
      }
    }

    facts.push(fact);
  }

  return facts.slice(0, 8);
}

/** Parse YAML response from memory extraction */

/** Write extracted memories to database and files */
export async function writeMemories(
  db: Database.Database,
  facts: MemoryFact[],
  dailyFilePath: string
): Promise<void> {
  if (facts.length === 0) return;

  const timestamp = new Date().toISOString();
  const dateStr = timestamp.slice(0, 10);

  try {
    // Ensure memory directory exists
    const fs = await import('fs');
    if (!fs.existsSync(getMemoryDir())) {
      fs.mkdirSync(getMemoryDir(), { recursive: true });
    }

    for (const fact of facts) {
      const id = randomUUID();
      
      // Handle contradictions - mark superseded memories
      if (fact.contradiction) {
        db.prepare(`
          UPDATE memories 
          SET superseded_by = ? 
          WHERE content LIKE ? AND superseded_by IS NULL
        `).run(id, `%${fact.contradiction.supersedes.slice(0, 50)}%`);
      }

      // Insert into memories table
      db.prepare(`
        INSERT INTO memories (id, content, category, importance, source_file, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, fact.text, fact.category, fact.importance, dailyFilePath, timestamp);

      // Get the rowid of the just-inserted memory row
      const row = db.prepare('SELECT rowid FROM memories WHERE id = ?').get(id) as { rowid: number } | undefined;
      if (row) {
        db.prepare(`
          INSERT INTO memories_fts (rowid, content, category)
          VALUES (?, ?, ?)
        `).run(row.rowid, fact.text, fact.category);
      }
    }

    // Append to daily log
    const dailyContent = facts.map(f => {
      const contradictionNote = f.contradiction 
        ? ` (supersedes: ${f.contradiction.supersedes})` 
        : '';
      return `- [${f.importance}] [${f.category}] ${f.text}${contradictionNote}`;
    }).join('\n');

    const dailyEntry = `\n## ${new Date().toLocaleTimeString()} - Memory Extraction\n${dailyContent}\n`;
    
    try {
      fs.appendFileSync(join(getMemoryDir(), `${dateStr}.md`), dailyEntry);
    } catch (err) {
      // Create file if it doesn't exist
      fs.writeFileSync(join(getMemoryDir(), `${dateStr}.md`), `# ${dateStr}\n${dailyEntry}`);
    }

    // Append high-importance facts to MEMORY.md
    const highImportanceFacts = facts.filter(f => f.importance === 'high');
    if (highImportanceFacts.length > 0) {
      const memoryPath = join(getWorkspaceDir(), 'MEMORY.md');
      const memoryContent = highImportanceFacts.map(f => `- ${f.text}`).join('\n');
      const memoryEntry = `\n## ${dateStr} - High Priority\n${memoryContent}\n`;
      
      try {
        fs.appendFileSync(memoryPath, memoryEntry);
      } catch (err) {
        // Create file if it doesn't exist
        fs.writeFileSync(memoryPath, `# Long-Term Memory\n${memoryEntry}`);
      }
    }

    console.log(`[memory] Stored ${facts.length} memories (${highImportanceFacts.length} high-priority)`);
  } catch (err) {
    console.error('[memory] Failed to write memories:', err);
  }
}

/** Sanitize user input for FTS5 MATCH query */
function buildFtsQuery(raw: string): string | null {
  const tokens = raw
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map(t => t.trim())
    .filter(Boolean) ?? [];
  if (tokens.length === 0) return null;
  // Quote each token and join with OR for broader matching
  return tokens.slice(0, 8).map(t => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

/** Search memories using FTS5 with BM25 ranking */
export function searchMemories(db: Database.Database, query: string, limit: number = 12): StoredMemory[] {
  if (!query.trim()) return [];

  const ftsQuery = buildFtsQuery(query);

  // Try FTS5 search first
  if (ftsQuery) {
    try {
      const results = db.prepare(`
        SELECT m.content, m.category, m.importance, m.created_at,
               fts.rank
        FROM memories_fts fts
        JOIN memories m ON m.rowid = fts.rowid
        WHERE memories_fts MATCH ? AND m.superseded_by IS NULL
        ORDER BY fts.rank, m.created_at DESC
        LIMIT ?
      `).all(ftsQuery, limit) as Array<StoredMemory & { rank: number }>;

      if (results.length > 0) return results;
    } catch (err) {
      console.warn('[memory] FTS search failed:', err instanceof Error ? err.message : err);
    }
  }

  // Fallback to LIKE search
  const words = query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 4) ?? [];
  if (words.length === 0) return [];

  const likeClause = words.map(() => 'content LIKE ?').join(' OR ');
  const likeParams = words.map(w => `%${w}%`);
  
  try {
    return db.prepare(`
      SELECT content, category, importance, created_at
      FROM memories
      WHERE (${likeClause}) AND superseded_by IS NULL
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...likeParams, limit) as StoredMemory[];
  } catch {
    return [];
  }
}

/** 
 * Build per-turn memory context from FTS5 search results.
 * NOTE: Workspace files (SOUL.md, IDENTITY.md, USER.md) are already injected 
 * via buildAppendPrompt() in the system prompt. This function only adds 
 * search-based memory recall for the specific user message.
 */
export function buildSmartContext(db: Database.Database, userMessage: string): string {
  if (!userMessage || !userMessage.trim()) return '';

  try {
    const memories = searchMemories(db, userMessage, 12);
    if (memories.length === 0) return '';

    // Token budget for memory injection (4 chars ≈ 1 token, max 4000 tokens for search results)
    const MAX_CHARS = 16000;
    let used = 0;
    const lines: string[] = [];

    for (const m of memories) {
      const line = `- [${m.category}/${m.importance}] ${m.content}`;
      if (used + line.length > MAX_CHARS) break;
      lines.push(line);
      used += line.length;
    }

    if (lines.length === 0) return '';

    return `## Recalled Memories\nRelevant context from previous conversations:\n${lines.join('\n')}`;
  } catch (err) {
    console.warn('[memory] Failed to build smart context:', err);
    return '';
  }
}

/** Daily synthesis of memories */
export async function runDailySynthesis(db: Database.Database): Promise<void> {
  const lastSynthesis = db.prepare(
    "SELECT value FROM memory_meta WHERE key = 'last_synthesis_date'"
  ).get() as { value: string } | undefined;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  
  // Check if synthesis was already done today
  if (lastSynthesis?.value === today) {
    return;
  }

  // Check if more than 24 hours since last synthesis
  if (lastSynthesis?.value) {
    const lastDate = new Date(lastSynthesis.value);
    const hoursSince = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      return;
    }
  }

  console.log('[memory] Running daily synthesis...');

  try {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dailyLogPath = join(getMemoryDir(), `${yesterday}.md`);
    
    // Read yesterday's log if it exists
    let dailyContent = '';
    try {
      const fs = await import('fs');
      dailyContent = fs.readFileSync(dailyLogPath, 'utf-8');
    } catch {
      // No log from yesterday, skip synthesis
      db.prepare(
        "INSERT OR REPLACE INTO memory_meta (key, value, updated_at) VALUES ('last_synthesis_date', ?, datetime('now'))"
      ).run(today);
      return;
    }

    if (!dailyContent.trim()) {
      db.prepare(
        "INSERT OR REPLACE INTO memory_meta (key, value, updated_at) VALUES ('last_synthesis_date', ?, datetime('now'))"
      ).run(today);
      return;
    }

    // Use Haiku SDK session for daily synthesis
    const oauthToken = extractOAuthToken();
    if (!oauthToken) {
      console.warn('[memory] No OAuth token for daily synthesis');
      db.prepare(
        "INSERT OR REPLACE INTO memory_meta (key, value, updated_at) VALUES ('last_synthesis_date', ?, datetime('now'))"
      ).run(today);
      return;
    }

    // Get all memories from yesterday
    const yesterdayMemories = db.prepare(`
      SELECT content, category, importance FROM memories 
      WHERE source_file = ? AND superseded_by IS NULL
      ORDER BY importance DESC, created_at
    `).all(`memory/${yesterday}.md`) as Array<{ content: string; category: string; importance: string }>;

    const synthesisInput = yesterdayMemories.length > 0
      ? `Memories from ${yesterday}:\n${yesterdayMemories.map(m => `- [${m.category}/${m.importance}] ${m.content}`).join('\n')}`
      : `Daily log from ${yesterday}:\n${dailyContent.slice(0, 3000)}`;

    try {
      const synthResult = await callHaiku(
        oauthToken,
        'You are a memory curator. Analyze the provided memories and output a synthesis. Output ONLY these sections, nothing else:\nDURABLE_FACTS: (one per line, facts worth keeping long-term)\nCONTRADICTIONS: (one per line, any conflicting information)\nPREFERENCES: (one per line, user preferences or workflow changes)',
        `Synthesize yesterday's activity:\n\n${synthesisInput}`
      );

      // Parse and write synthesis results
      const fs = await import('fs');
      const sections = parseSynthesisSections(synthResult);

      if (sections.durableFacts.length > 0) {
        const memoryPath = join(getWorkspaceDir(), 'MEMORY.md');
        const entry = `\n## ${yesterday} - Daily Synthesis\n${sections.durableFacts.map(f => `- ${f}`).join('\n')}\n`;
        try { fs.appendFileSync(memoryPath, entry); } 
        catch { fs.writeFileSync(memoryPath, `# Long-Term Memory\n${entry}`); }
      }

      if (sections.contradictions.length > 0 || sections.preferences.length > 0) {
        const userPath = join(getWorkspaceDir(), 'USER.md');
        let userEntry = '';
        if (sections.contradictions.length > 0) {
          userEntry += `\n## ${yesterday} - Contradictions\n${sections.contradictions.map(c => `- ⚠️ ${c}`).join('\n')}\n`;
        }
        if (sections.preferences.length > 0) {
          userEntry += `\n## ${yesterday} - Preferences\n${sections.preferences.map(p => `- ${p}`).join('\n')}\n`;
        }
        try { fs.appendFileSync(userPath, userEntry); } catch { /* ok */ }
      }

      console.log(`[memory] Synthesis: ${sections.durableFacts.length} facts, ${sections.contradictions.length} contradictions, ${sections.preferences.length} preferences`);
    } catch (synthErr) {
      console.warn('[memory] Haiku synthesis failed:', synthErr instanceof Error ? synthErr.message : synthErr);
    }

    // Update synthesis date
    db.prepare(
      "INSERT OR REPLACE INTO memory_meta (key, value, updated_at) VALUES ('last_synthesis_date', ?, datetime('now'))"
    ).run(today);

    console.log('[memory] Daily synthesis completed');
  } catch (err) {
    console.error('[memory] Daily synthesis failed:', err);
  }
}

/** Process synthesis response and update files */
/** Parse synthesis sections from Haiku response */
function parseSynthesisSections(response: string): {
  durableFacts: string[];
  contradictions: string[];
  preferences: string[];
} {
  const result = { durableFacts: [] as string[], contradictions: [] as string[], preferences: [] as string[] };
  let currentSection: 'durableFacts' | 'contradictions' | 'preferences' | null = null;

  for (const line of response.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('DURABLE_FACTS:') || trimmed.startsWith('DURABLE FACTS:')) {
      currentSection = 'durableFacts';
      continue;
    } else if (trimmed.startsWith('CONTRADICTIONS:')) {
      currentSection = 'contradictions';
      continue;
    } else if (trimmed.startsWith('PREFERENCES:')) {
      currentSection = 'preferences';
      continue;
    }

    if (currentSection && trimmed.startsWith('- ') && trimmed.length > 4) {
      result[currentSection].push(trimmed.slice(2).trim());
    }
  }

  return result;
}