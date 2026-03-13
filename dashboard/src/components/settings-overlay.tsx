import { useEffect, useState } from 'react';
import {
  ArrowLeft, Key, Volume2, Shield, Bot, Cpu,
  RefreshCw, Loader2, LogIn, LogOut, X, ChevronRight,
} from 'lucide-react';
import { useAppStore } from '../stores/app-store';

const SERVER_URL = `${window.location.protocol}//${window.location.host}`;

interface SettingsOverlayProps {
  sendRaw: (data: Record<string, unknown>) => void;
}

// Main settings menu items
const MENU_ITEMS = [
  { id: 'auth' as const, icon: Key, title: 'OAuth & Keys', subtitle: 'Claude authentication & API keys' },
  { id: 'agent' as const, icon: Bot, title: 'Agent Mode', subtitle: 'Running, paused, or stopped' },
  { id: 'security' as const, icon: Shield, title: 'Security', subtitle: 'Sandbox & permissions' },
  { id: 'voice' as const, icon: Volume2, title: 'Voice', subtitle: 'ElevenLabs TTS configuration' },
];

export function SettingsOverlay({ sendRaw }: SettingsOverlayProps) {
  const settingsPage = useAppStore((s) => s.settingsPage);
  const setSettingsPage = useAppStore((s) => s.setSettingsPage);

  if (!settingsPage) return null;

  return (
    <div className="absolute inset-0 z-40 flex flex-col" style={{ background: 'var(--bb-bg)' }}>
      {settingsPage === 'main' && (
        <SettingsMain onClose={() => setSettingsPage(null)} onNavigate={setSettingsPage} />
      )}
      {settingsPage === 'auth' && (
        <AuthPage onBack={() => setSettingsPage('main')} sendRaw={sendRaw} />
      )}
      {settingsPage === 'agent' && (
        <AgentModePage onBack={() => setSettingsPage('main')} />
      )}
      {settingsPage === 'security' && (
        <SecurityPage onBack={() => setSettingsPage('main')} />
      )}
      {settingsPage === 'voice' && (
        <VoicePage onBack={() => setSettingsPage('main')} />
      )}
    </div>
  );
}

// --- Page header with back arrow ---
function PageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header
      className="flex items-center justify-between px-4 shrink-0"
      style={{ height: 'var(--bb-topbar-h)', borderBottom: '1px solid var(--bb-border)', background: 'var(--bb-bg)' }}
         >
      <button
        onClick={onBack}
        className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
        style={{ color: 'var(--bb-text-muted)' }}
      >
        <ArrowLeft size={15} />
      </button>
      <span className="text-sm font-semibold select-none" style={{ color: 'var(--bb-text)' }} data-tauri-drag-region>
        {title}
      </span>
      <div className="w-7" />
    </header>
  );
}

// --- Main settings list ---
function SettingsMain({ onClose, onNavigate }: {
  onClose: () => void;
  onNavigate: (page: 'auth' | 'agent' | 'security' | 'voice') => void;
}) {
  return (
    <>
      <PageHeader title="Settings" onBack={onClose} />
      <div className="flex-1 overflow-y-auto py-2">
        {MENU_ITEMS.map(({ id, icon: Icon, title, subtitle }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className="w-full flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-800/50"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-zinc-800/80">
              <Icon size={15} style={{ color: 'var(--bb-text-muted)' }} />
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-medium" style={{ color: 'var(--bb-text)' }}>{title}</div>
              <div className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>{subtitle}</div>
            </div>
            <ChevronRight size={14} style={{ color: 'var(--bb-text-faint)' }} />
          </button>
        ))}
      </div>
    </>
  );
}

// --- Auth page ---
function AuthPage({ onBack, sendRaw }: { onBack: () => void; sendRaw: (data: Record<string, unknown>) => void }) {
  const authStatus = useAppStore((s) => s.authStatus);
  const authMethod = useAppStore((s) => s.authMethod);
  const loginStatus = useAppStore((s) => s.loginStatus);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (authStatus === 'loading') {
      fetch(`${SERVER_URL}/api/auth/status`)
        .then(r => r.json())
        .then(data => {
          useAppStore.getState().setAuth(
            data.authenticated ? 'authenticated' : 'unauthenticated',
            data.method
          );
        })
        .catch(() => useAppStore.getState().setAuth('unauthenticated', 'none'));
    }
  }, [authStatus]);

  async function refreshAuth() {
    setRefreshing(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/auth/refresh`, { method: 'POST' });
      const data = await res.json();
      useAppStore.getState().setAuth(data.authenticated ? 'authenticated' : 'unauthenticated', data.method);
    } catch { /* ignore */ }
    setRefreshing(false);
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch(`${SERVER_URL}/api/auth/logout`, { method: 'POST' });
      useAppStore.getState().setAuth('unauthenticated', 'none');
    } catch { /* ignore */ }
    setLoggingOut(false);
  }

  return (
    <>
      <PageHeader title="OAuth & Keys" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium" style={{ color: 'var(--bb-text)' }}>Claude (Anthropic)</h3>
            <button
              onClick={refreshAuth}
              disabled={refreshing}
              className="text-xs flex items-center gap-1 transition-colors disabled:opacity-50"
              style={{ color: 'var(--bb-text-muted)' }}
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          <div className="bb-card space-y-3">
            {authStatus === 'loading' && (
              <div className="flex items-center gap-3">
                <Loader2 size={16} className="animate-spin" style={{ color: 'var(--bb-text-muted)' }} />
                <span className="text-sm" style={{ color: 'var(--bb-text-muted)' }}>Checking...</span>
              </div>
            )}
            {authStatus === 'authenticated' && (
              <>
                <div className="flex items-center gap-3">
                  <span className="bb-dot bb-dot-ok" style={{ width: 8, height: 8 }} />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-emerald-300">
                      {authMethod === 'oauth' ? 'Logged in via Claude Code' : 'API key configured'}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--bb-text-faint)' }}>
                      {authMethod === 'oauth' ? 'Using OAuth token from macOS Keychain' : 'Using ANTHROPIC_API_KEY'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex items-center gap-2 text-xs transition-colors disabled:opacity-50 hover:text-red-400"
                  style={{ color: 'var(--bb-text-muted)' }}
                >
                  {loggingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                  {loggingOut ? 'Logging out...' : 'Log out'}
                </button>
              </>
            )}
            {authStatus === 'unauthenticated' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="bb-dot bb-dot-danger" style={{ width: 8, height: 8 }} />
                  <div>
                    <p className="text-sm font-medium text-red-300">Not authenticated</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--bb-text-faint)' }}>Sign in with Claude to get started</p>
                  </div>
                </div>
                <button
                  onClick={() => sendRaw({ type: 'login' })}
                  disabled={loginStatus === 'in_progress'}
                  className="flex items-center justify-center gap-2 w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                  style={{ background: 'var(--bb-accent)', color: '#fff' }}
                >
                  {loginStatus === 'in_progress' ? (
                    <><Loader2 size={16} className="animate-spin" />Waiting for login...</>
                  ) : (
                    <><LogIn size={16} />Sign in with Claude</>
                  )}
                </button>
                {loginStatus === 'in_progress' && (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-xs text-center" style={{ color: 'var(--bb-text-muted)' }}>Complete sign-in in your browser.</p>
                    <button
                      onClick={() => sendRaw({ type: 'login_cancel' })}
                      className="flex items-center gap-1 text-xs transition-colors"
                      style={{ color: 'var(--bb-text-faint)' }}
                    >
                      <X size={12} /> Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

// --- Agent Mode page ---
function AgentModePage({ onBack }: { onBack: () => void }) {
  const agentMode = useAppStore((s) => s.agentMode);
  const permissionMode = useAppStore((s) => s.permissionMode);

  function setMode(mode: string) {
    fetch(`${SERVER_URL}/api/agent/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).catch(() => {});
  }

  function setPermMode(mode: string) {
    fetch(`${SERVER_URL}/api/agent/permission-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).catch(() => {});
  }

  return (
    <>
      <PageHeader title="Agent Mode" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--bb-text-faint)' }}>Mode</h3>
          <div className="bb-card">
            <div className="flex gap-2">
              {(['autonomous', 'ask', 'stop'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setMode(mode)}
                  className={`flex-1 text-xs py-2 rounded-lg border transition-colors capitalize ${
                    agentMode === mode
                      ? mode === 'autonomous'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : mode === 'ask'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                          : 'bg-red-500/10 border-red-500/30 text-red-400'
                      : 'border-zinc-700/50 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {mode === 'autonomous' ? 'Running' : mode === 'ask' ? 'Paused' : 'Stopped'}
                </button>
              ))}
            </div>
            <p className="text-[10px] mt-2" style={{ color: 'var(--bb-text-faint)' }}>
              {agentMode === 'autonomous' ? 'Running — executes actions autonomously'
                : agentMode === 'ask' ? 'Paused — no operations execute'
                : 'Stopped — agent completely disabled'}
            </p>
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--bb-text-faint)' }}>
            <div className="flex items-center gap-2"><Cpu size={12} /> Permission Mode</div>
          </h3>
          <div className="bb-card">
            <div className="flex gap-2">
              {(['bypassPermissions', 'acceptEdits', 'plan'] as const).map((mode) => {
                const labels: Record<string, string> = {
                  bypassPermissions: 'Autonomous',
                  acceptEdits: 'Supervised',
                  plan: 'Plan',
                };
                return (
                  <button
                    key={mode}
                    onClick={() => setPermMode(mode)}
                    className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${
                      permissionMode === mode
                        ? mode === 'bypassPermissions'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : mode === 'acceptEdits'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                            : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                        : 'border-zinc-700/50 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {labels[mode]}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

// --- Security page ---
function SecurityPage({ onBack }: { onBack: () => void }) {
  const sandboxEnabled = useAppStore((s) => s.sandboxEnabled);

  return (
    <>
      <PageHeader title="Security" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <div className="bb-card">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm" style={{ color: 'var(--bb-text)' }}>Sandbox Mode</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--bb-text-faint)' }}>Restrict agent to current working directory</div>
            </div>
            <button
              onClick={() => {
                fetch(`${SERVER_URL}/api/agent/sandbox`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ enabled: !sandboxEnabled }),
                }).catch(() => {});
              }}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                sandboxEnabled ? 'bg-emerald-500' : 'bg-zinc-700'
              }`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                sandboxEnabled ? 'translate-x-5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// --- Voice page ---
function VoicePage({ onBack }: { onBack: () => void }) {
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsStatus, setElevenLabsStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [voiceId, setVoiceId] = useState('');
  const [voiceIdStatus, setVoiceIdStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

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

  async function saveKey() {
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
    <>
      <PageHeader title="Voice" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <div className="bb-card space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>ElevenLabs API Key</label>
            <div className="flex gap-2">
              <input
                type="password"
                value={elevenLabsKey}
                onChange={(e) => setElevenLabsKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                placeholder="xi-..."
                className="flex-1 bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
              />
              <button
                onClick={saveKey}
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
    </>
  );
}
