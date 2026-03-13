import { useEffect, useState } from 'react';
import { useAgentStore } from '../../stores/agent-store';
import { useAppStore } from '../../stores/app-store';
import { Wrench, Server, FolderOpen, RefreshCw, Volume2 } from 'lucide-react';

const SERVER_URL = `${window.location.protocol}//${window.location.host}`;

const MODEL_INFO: Record<string, string> = {
  haiku: 'Fastest, lowest cost — 200K context',
  sonnet: 'Balanced speed + intelligence — 1M context',
  opus: 'Most capable, complex reasoning — 1M context',
};

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  haiku: 'Claude 4.5 Haiku',
  sonnet: 'Claude Sonnet 4.6',
  opus: 'Claude Opus 4.6',
};

const MODEL_ORDER = ['haiku', 'sonnet', 'opus'];

function sortModels(models: string[]): string[] {
  return [...models].sort((a, b) => {
    const ai = MODEL_ORDER.indexOf(a);
    const bi = MODEL_ORDER.indexOf(b);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });
}

function ModelSelector({ label, description, value, onChange, models }: { label: string; description?: string; value: string; onChange: (v: string) => void; models: string[] }) {
  const sorted = sortModels(models);
  return (
    <div>
      <div className="bb-stat-label">{label}</div>
      {description && (
        <div className="text-[10px] mt-0.5 mb-1.5" style={{ color: 'var(--bb-text-faint)' }}>{description}</div>
      )}
      <div className="flex gap-2 mt-1">
        {sorted.map((m) => (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={`flex-1 text-xs py-2.5 rounded-lg border transition-colors capitalize ${
              value === m
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                : 'border-zinc-700/50 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentView() {
  const { tools, workspaceFiles, mcpServers, agentStatus, loading, fetchAll } = useAgentStore();
  const agentMode = useAppStore((s) => s.agentMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const sandboxEnabled = useAppStore((s) => s.sandboxEnabled);
  const activeModel = useAppStore((s) => s.activeModel);

  const [subAgentModels, setSubAgentModels] = useState<{ coder: string; executor: string }>({ coder: 'sonnet', executor: 'haiku' });
  const [memoryExtractionModel, setMemoryExtractionModel] = useState('haiku');
  const [compactionModel, setCompactionModel] = useState('haiku');
  const [dailySynthesisModel, setDailySynthesisModel] = useState('haiku');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [apiModels, setApiModels] = useState<Array<{ id: string; displayName: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // ElevenLabs state
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsStatus, setElevenLabsStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [voiceId, setVoiceId] = useState('');
  const [voiceIdStatus, setVoiceIdStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Fetch sub-agent models + memory model
  useEffect(() => {
    fetch(`${SERVER_URL}/api/agent/sub-agent-models`)
      .then(r => r.json())
      .then(data => { if (data.models) setSubAgentModels(data.models); })
      .catch(() => {});
    fetch(`${SERVER_URL}/api/settings/memory_extraction_model`)
      .then(r => r.json())
      .then(data => { if (data.value) setMemoryExtractionModel(data.value); })
      .catch(() => {});
    fetch(`${SERVER_URL}/api/settings/compaction_model`)
      .then(r => r.json())
      .then(data => { if (data.value) setCompactionModel(data.value); })
      .catch(() => {});
    fetch(`${SERVER_URL}/api/settings/daily_synthesis_model`)
      .then(r => r.json())
      .then(data => { if (data.value) setDailySynthesisModel(data.value); })
      .catch(() => {});
  }, []);

  // Fetch available models
  useEffect(() => { fetchModels(); }, []);

  // Fetch ElevenLabs config
  useEffect(() => {
    fetch(`${SERVER_URL}/api/keys`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const el = data.find((k: { slug: string }) => k.slug === 'elevenlabs');
          if (el?.masked) setElevenLabsKey(el.masked);
        }
      })
      .catch(() => {});

    fetch(`${SERVER_URL}/api/settings/elevenlabs_voice_id`)
      .then(r => r.json())
      .then(data => { if (data.value) setVoiceId(data.value); })
      .catch(() => {});
  }, []);

  function fetchModels() {
    setModelsLoading(true);
    fetch(`${SERVER_URL}/api/agent/models`)
      .then(r => r.json())
      .then(data => {
        if (data.models) setAvailableModels(data.models);
        if (data.apiModels) setApiModels(data.apiModels);
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }

  function setChatModel(model: string) {
    fetch(`${SERVER_URL}/api/agent/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    }).catch(() => {});
  }

  function setSubAgentModel(role: 'coder' | 'executor', model: string) {
    const updated = { ...subAgentModels, [role]: model };
    setSubAgentModels(updated);
    fetch(`${SERVER_URL}/api/agent/sub-agent-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: updated }),
    }).catch(() => {});
  }

  function saveProcessModel(key: string, setter: (m: string) => void) {
    return (model: string) => {
      setter(model);
      fetch(`${SERVER_URL}/api/settings/${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: model }),
      }).catch(() => {});
    };
  }

  const modelList = availableModels.length > 0 ? availableModels : MODEL_ORDER;

  async function saveElevenLabsKey() {
    if (!elevenLabsKey.trim()) return;
    setElevenLabsStatus('saving');
    try {
      await fetch(`${SERVER_URL}/api/keys/elevenlabs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: elevenLabsKey.trim() }),
      });
      setElevenLabsStatus('saved');
      setTimeout(() => setElevenLabsStatus('idle'), 2000);
    } catch { setElevenLabsStatus('idle'); }
  }

  async function saveVoiceId() {
    if (!voiceId.trim()) return;
    setVoiceIdStatus('saving');
    try {
      await fetch(`${SERVER_URL}/api/settings/elevenlabs_voice_id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: voiceId.trim() }),
      });
      setVoiceIdStatus('saved');
      setTimeout(() => setVoiceIdStatus('idle'), 2000);
    } catch { setVoiceIdStatus('idle'); }
  }

  return (
    <div className="p-6 space-y-6">
      {loading && <p className="text-sm" style={{ color: 'var(--bb-text-muted)' }}>Loading...</p>}

      {/* Agent identity + status */}
      <div className="bb-card bb-rise bb-stagger-1">
        <div className="bb-card-title">Agent Status</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="bb-stat-label">Mode</div>
            <div className="text-lg font-bold" style={{
              color: agentMode === 'autonomous' ? 'var(--bb-ok)'
                : agentMode === 'ask' ? 'var(--bb-warn)'
                : 'var(--bb-danger)',
            }}>
              {agentMode === 'autonomous' ? 'Running' : agentMode === 'ask' ? 'Paused' : 'Stopped'}
            </div>
          </div>
          <div>
            <div className="bb-stat-label">Permission</div>
            <div className="text-lg font-bold" style={{
              color: permissionMode === 'bypassPermissions' ? 'var(--bb-ok)'
                : permissionMode === 'acceptEdits' ? 'var(--bb-warn)'
                : 'var(--bb-accent)',
            }}>
              {permissionMode === 'bypassPermissions' ? 'Autonomous' : permissionMode === 'acceptEdits' ? 'Supervised' : 'Plan'}
            </div>
          </div>
          <div>
            <div className="bb-stat-label">Sandbox</div>
            <div className="text-lg font-bold" style={{ color: sandboxEnabled ? 'var(--bb-ok)' : 'var(--bb-warn)' }}>
              {sandboxEnabled ? 'On' : 'Off'}
            </div>
          </div>
          <div>
            <div className="bb-stat-label">Chat Running</div>
            <div className="text-lg font-bold" style={{ color: agentStatus?.chatRunning ? 'var(--bb-ok)' : 'var(--bb-text-muted)' }}>
              {agentStatus?.chatRunning ? 'Yes' : 'No'}
            </div>
          </div>
        </div>
      </div>

      {/* Permission Modes */}
      <div className="bb-card bb-rise bb-stagger-2">
        <div className="bb-card-title">Permission Modes</div>
        <div className="space-y-3">
          {([
            {
              mode: 'bypassPermissions' as const,
              label: 'Autonomous',
              color: 'var(--bb-ok)',
              desc: 'All tools auto-approved. The agent executes file edits, bash commands, and writes without asking. Maximum autonomy.',
            },
            {
              mode: 'acceptEdits' as const,
              label: 'Supervised',
              color: 'var(--bb-warn)',
              desc: 'Read-only operations auto-approved. File edits and filesystem changes require your review before executing.',
            },
            {
              mode: 'plan' as const,
              label: 'Plan',
              color: 'var(--bb-accent)',
              desc: 'No tool execution allowed. The agent can only analyze code and propose plans. Use for code review or when you need approval before any changes.',
            },
          ]).map(({ mode, label, color, desc }) => (
            <button
              key={mode}
              onClick={() => {
                fetch(`${SERVER_URL}/api/agent/permission-mode`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ mode }),
                }).catch(() => {});
              }}
              className="rounded-lg p-3 transition-colors text-left w-full cursor-pointer"
              style={{
                background: permissionMode === mode ? 'var(--bb-bg-accent)' : 'var(--bb-bg)',
                border: `1px solid ${permissionMode === mode ? color : 'var(--bb-border)'}`,
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="text-xs font-semibold" style={{ color: permissionMode === mode ? color : 'var(--bb-text)' }}>
                  {label}
                  {permissionMode === mode && <span className="ml-1.5 text-[10px] font-normal" style={{ color: 'var(--bb-text-faint)' }}>(active)</span>}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed pl-4" style={{ color: 'var(--bb-text-muted)' }}>{desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Model Configuration */}
      <div className="bb-card bb-rise bb-stagger-3">
        <div className="bb-card-title">Model Configuration</div>
        <div className="space-y-4">
          <div>
            <div className="bb-stat-label">Active Model</div>
            <div className="text-lg font-bold capitalize" style={{ color: 'var(--bb-accent)' }}>
              {activeModel}
            </div>
          </div>
          <ModelSelector label="Chat Model" description="Primary model for conversations. Handles reasoning, responses, and tool use." value={activeModel} onChange={setChatModel} models={modelList} />
          <ModelSelector label="Coding Sub-Agent" description="Spawned for writing and modifying code, building features, and refactoring." value={subAgentModels.coder} onChange={(v) => setSubAgentModel('coder', v)} models={modelList} />
          <ModelSelector label="Executor Sub-Agent" description="Spawned for shell commands, web searches, and quick operational tasks." value={subAgentModels.executor} onChange={(v) => setSubAgentModel('executor', v)} models={modelList} />
          <ModelSelector label="Memory Extraction" description="Extracts durable facts and preferences from each conversation turn." value={memoryExtractionModel} onChange={saveProcessModel('memory_extraction_model', setMemoryExtractionModel)} models={modelList} />
          <ModelSelector label="Session Compaction" description="Summarizes long conversations to stay within context window limits." value={compactionModel} onChange={saveProcessModel('compaction_model', setCompactionModel)} models={modelList} />
          <ModelSelector label="Daily Synthesis" description="Consolidates daily memories, resolves contradictions, and identifies patterns." value={dailySynthesisModel} onChange={saveProcessModel('daily_synthesis_model', setDailySynthesisModel)} models={modelList} />
        </div>
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--bb-border)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="bb-stat-label">Available Models</div>
            <button
              onClick={fetchModels}
              disabled={modelsLoading}
              className="text-xs flex items-center gap-1 transition-colors disabled:opacity-50"
              style={{ color: 'var(--bb-text-muted)' }}
            >
              <RefreshCw size={12} className={modelsLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          <div className="space-y-1.5">
            {sortModels(modelList).map((m) => {
              const apiMatch = apiModels.find(a => a.id.includes(m));
              return (
                <div key={m} className="py-1.5 px-2 rounded" style={{
                  background: m === activeModel ? 'var(--bb-accent-subtle)' : 'transparent',
                }}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono capitalize" style={{
                      color: m === activeModel ? 'var(--bb-accent)' : 'var(--bb-text-muted)',
                    }}>{apiMatch?.displayName || MODEL_DISPLAY_NAMES[m] || m}</span>
                  </div>
                  {apiMatch && (
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--bb-text-faint)' }}>
                      {apiMatch.id}
                    </div>
                  )}
                  {MODEL_INFO[m] && (
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--bb-text-faint)' }}>
                      {MODEL_INFO[m]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ElevenLabs */}
      <div className="bb-card bb-rise bb-stagger-4">
        <div className="bb-card-title flex items-center gap-2"><Volume2 size={13} /> Voice (ElevenLabs)</div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>API Key</label>
            <div className="flex gap-2">
              <input
                type="password"
                value={elevenLabsKey}
                onChange={(e) => setElevenLabsKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveElevenLabsKey()}
                placeholder="xi-..."
                className="flex-1 bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
              />
              <button
                onClick={saveElevenLabsKey}
                disabled={!elevenLabsKey.trim() || elevenLabsStatus === 'saving'}
                className="px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors"
              >
                {elevenLabsStatus === 'saved' ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>Voice ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveVoiceId()}
                placeholder="Voice ID from ElevenLabs"
                className="flex-1 bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
              />
              <button
                onClick={saveVoiceId}
                disabled={!voiceId.trim() || voiceIdStatus === 'saving'}
                className="px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors"
              >
                {voiceIdStatus === 'saved' ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tools */}
      <div className="bb-card bb-rise bb-stagger-4">
        <div className="bb-card-title flex items-center gap-2"><Wrench size={13} /> Available Tools</div>
        <div className="space-y-1.5">
          {tools.map((t) => (
            <div key={t.name} className="flex items-center justify-between py-1">
              <span className="text-sm font-medium font-mono" style={{ color: 'var(--bb-text)' }}>{t.name}</span>
              <span className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>{t.description}</span>
            </div>
          ))}
          {tools.length === 0 && <p className="bb-empty">No tools loaded</p>}
        </div>
      </div>

      {/* Workspace files */}
      <div className="bb-card bb-rise bb-stagger-5">
        <div className="bb-card-title flex items-center gap-2"><FolderOpen size={13} /> Workspace Files</div>
        <div className="space-y-1.5">
          {workspaceFiles.map((f) => (
            <div key={f.name} className="flex items-center justify-between py-1">
              <span className="text-sm font-mono" style={{ color: f.exists ? 'var(--bb-text)' : 'var(--bb-text-faint)' }}>
                {f.name}
              </span>
              <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
                {f.exists && <span>{(f.size / 1024).toFixed(1)} KB</span>}
                {!f.exists && <span className="text-zinc-600">missing</span>}
              </div>
            </div>
          ))}
          {workspaceFiles.length === 0 && <p className="bb-empty">No workspace files</p>}
        </div>
      </div>

      {/* MCP Servers */}
      <div className="bb-card bb-rise bb-stagger-6">
        <div className="bb-card-title flex items-center gap-2"><Server size={13} /> MCP Servers</div>
        {mcpServers.length === 0 ? (
          <p className="bb-empty">No MCP servers configured</p>
        ) : (
          <div className="space-y-2">
            {mcpServers.map((s) => (
              <div key={s.name} className="p-3 rounded-lg" style={{ background: 'var(--bb-bg)' }}>
                <div className="text-sm font-medium font-mono" style={{ color: 'var(--bb-text)' }}>{s.name}</div>
                {s.command && (
                  <div className="text-[10px] font-mono mt-1" style={{ color: 'var(--bb-text-faint)' }}>
                    {s.command} {s.args?.join(' ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
