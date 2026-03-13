import fs from 'fs';
import path from 'path';
import { getDataDir } from './db.js';

const SKILLS_DIR = path.join(getDataDir(), 'skills');

export interface Skill {
  name: string;
  description: string;
  content: string;
  path: string;
}

const MAX_SKILL_BYTES = 256_000;
const MAX_SKILLS = 100;

function ensureSkillsDir(): void {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

/** Parse frontmatter from SKILL.md content */
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  if (!content.startsWith('---')) return { meta, body: content };
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return { meta, body: content };
  const front = content.slice(3, endIdx).trim();
  for (const line of front.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) meta[key] = value;
  }
  return { meta, body: content.slice(endIdx + 3).trim() };
}

/**
 * Load skills from the skills directory.
 * Each skill is a subdirectory containing SKILL.md.
 */
export function loadSkills(): Skill[] {
  ensureSkillsDir();
  const skills: Skill[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(SKILLS_DIR);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (skills.length >= MAX_SKILLS) break;

    const dirPath = path.join(SKILLS_DIR, entry);
    try {
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const skillPath = path.join(dirPath, 'SKILL.md');
    try {
      const stat = fs.statSync(skillPath);
      if (stat.size > MAX_SKILL_BYTES) continue;

      const raw = fs.readFileSync(skillPath, 'utf-8');
      const { meta, body } = parseFrontmatter(raw);

      skills.push({
        name: meta.name || entry,
        description: meta.description || body.split('\n')[0]?.slice(0, 200) || entry,
        content: body,
        path: skillPath,
      });
    } catch {
      // SKILL.md missing or unreadable
    }
  }

  return skills;
}

/** Build skills context string for agent prompt injection */
export function buildSkillsContext(): string {
  const skills = loadSkills();
  if (skills.length === 0) return '';

  const lines = skills.map(s => {
    const truncated = s.content.length > 4000
      ? s.content.slice(0, 4000) + '\n...(truncated)'
      : s.content;
    return `### ${s.name}\n${truncated}`;
  });

  return '\n\n## Available Skills\nThe following skills are loaded from ~/.beepbot-v2/skills/. Each skill is a directory with a SKILL.md file.\n\n' + lines.join('\n\n');
}

/** List skills with metadata */
export function listSkills(): Array<{ name: string; description: string; path: string }> {
  return loadSkills().map(s => ({ name: s.name, description: s.description, path: s.path }));
}

export function getSkillsDir(): string {
  ensureSkillsDir();
  return SKILLS_DIR;
}
