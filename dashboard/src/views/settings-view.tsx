import { useEffect, useState } from 'react';
import { Key, Volume2, Shield, RefreshCw, Loader2, LogIn, LogOut, X, Cpu, Bot, GitBranch, GitCommit, GitPullRequest, GitMerge, Terminal, UploadCloud } from 'lucide-react';
import { useAppStore } from '../stores/app-store';

const SIDECAR = 'http://127.0.0.1:3004';

interface SettingsViewProps {
  sendRaw: (data: Record<string, unknown>) => void;
}

export function SettingsViewPage({ sendRaw }: SettingsViewProps) {
  const authStatus = useAppStore((s) => s.authStatus);
  const authMethod = useAppStore((s) => s.authMethod);
  const loginStatus = useAppStore((s) => s.loginStatus);
  const sandboxEnabled = useAppStore((s) => s.sandboxEnabled);
  const agentMode = useAppStore((s) => s.agentMode);
  const permissionMode = useAppStore((s) => s.permissionMode);

  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsStatus, setElevenLabsStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [voiceId, setVoiceId] = useState('');
  const [voiceIdStatus, setVoiceIdStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // GitHub state
  interface GitStatus {
    branch: string;
    clean: boolean;
    remoteUrl: string;
    lastCommit: { hash: string; message: string; date: string } | null;
  }
  const [githubRepoUrl, setGithubRepoUrl] = useState('https://github.com/ArrestedRelations/beepbot-macos.git');
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitOutput, setGitOutput] = useState('');
  const [gitLoading, setGitLoading] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [gitStatusLoading, setGitStatusLoading] = useState(false);

  useEffect(() => {
    if (authStatus === 'loading') {
      fetch(`${SIDECAR}/api/auth/status`)
        .then(r => r.json())
        .then(data => {
          useAppStore.getState().setAuth(
            data.authenticated ? 'authenticated' : 'unauthenticated',
            data.method
          );
        })
        .catch(() => useAppStore.getState().setAuth('unauthenticated', 'none'));
    }

    fetch(`${SIDECAR}/api/keys`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const el = data.find((k: { slug: string }) => k.slug === 'elevenlabs');
          if (el?.masked) setElevenLabsKey(el.masked);
        }
      })
      .catch(() => {});

    fetch(`${SIDECAR}/api/settings/elevenlabs_voice_id`)
      .then(r => r.json())
      .then(data => { if (data.value) setVoiceId(data.value); })
      .catch(() => {});

    void fetchGitStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  async function saveElevenLabsKey() {
    if (!elevenLabsKey.trim()) return;
    setElevenLabsStatus('saving');
    try {
      await fetch(`${SIDECAR}/api/keys/elevenlabs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: elevenLabsKey.trim() }),
      });
      setElevenLabsStatus('saved');
      setTimeout(() => setElevenLabsStatus('idle'), 2000);
    } catch {
      setElevenLabsStatus('idle');
    }
  }

  async function saveVoiceId() {
    if (!voiceId.trim()) return;
    setVoiceIdStatus('saving');
    try {
      await fetch(`${SIDECAR}/api/settings/elevenlabs_voice_id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: voiceId.trim() }),
      });
      setVoiceIdStatus('saved');
      setTimeout(() => setVoiceIdStatus('idle'), 2000);
    } catch {
      setVoiceIdStatus('idle');
    }
  }

  async function refreshAuth() {
    setRefreshing(true);
    try {
      const res = await fetch(`${SIDECAR}/api/auth/refresh`, { method: 'POST' });
      const data = await res.json();
      useAppStore.getState().setAuth(
        data.authenticated ? 'authenticated' : 'unauthenticated',
        data.method
      );
    } catch { /* ignore */ }
    setRefreshing(false);
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch(`${SIDECAR}/api/auth/logout`, { method: 'POST' });
      useAppStore.getState().setAuth('unauthenticated', 'none');
    } catch { /* ignore */ }
    setLoggingOut(false);
  }

  function setMode(mode: string) {
    fetch(`${SIDECAR}/api/agent/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).catch(() => {});
  }

  function setPermMode(mode: string) {
    fetch(`${SIDECAR}/api/agent/permission-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).catch(() => {});
  }

  async function fetchGitStatus() {
    setGitStatusLoading(true);
    try {
      const res = await fetch(`${SIDECAR}/api/github/status`);
      const data = await res.json() as GitStatus & { ok: boolean; error?: string };
      if (data.ok) setGitStatus(data);
      else setGitOutput(`Error: ${data.error || 'Unknown error'}`);
    } catch {
      setGitOutput('Failed to connect to sidecar');
    }
    setGitStatusLoading(false);
  }

  async function gitAction(action: string, body?: Record<string, unknown>) {
    setGitLoading(action);
    setGitOutput('');
    try {
      const res = await fetch(`${SIDECAR}/api/github/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json() as { ok: boolean; output?: string; error?: string };
      setGitOutput(data.output || data.error || (data.ok ? 'Done.' : 'Unknown error'));
      if (data.ok) void fetchGitStatus();
    } catch {
      setGitOutput('Request failed');
    }
    setGitLoading(null);
  }

  async function saveRemoteUrl() {
    setGitLoading('remote');
    setGitOutput('');
    try {
      const res = await fetch(`${SIDECAR}/api/github/remote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: githubRepoUrl.trim() }),
      });
      const data = await res.json() as { ok: boolean; url?: string; error?: string };
      setGitOutput(data.ok ? `Remote set to: ${data.url}` : `Error: ${data.error}`);
      if (data.ok) void fetchGitStatus();
    } catch {
      setGitOutput('Request failed');
    }
    setGitLoading(null);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 bg-zinc-950 sticky top-0 z-10" data-tauri-drag-region>
        <span className="text-sm font-semibold text-zinc-300 select-none" data-tauri-drag-region>Settings</span>
        <div className="w-7" />
      </header>

      <div className="px-5 py-4 space-y-6">
        {/* Auth Status */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Key size={14} className="text-zinc-500" />
              <h3 className="text-sm font-medium text-zinc-300">Claude (Anthropic)</h3>
            </div>
            <button
              onClick={refreshAuth}
              disabled={refreshing}
              className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4 space-y-3">
            {authStatus === 'loading' && (
              <div className="flex items-center gap-3">
                <Loader2 size={16} className="text-zinc-400 animate-spin" />
                <span className="text-sm text-zinc-400">Checking...</span>
              </div>
            )}

            {authStatus === 'authenticated' && (
              <>
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-emerald-300">
                      {authMethod === 'oauth' ? 'Logged in via Claude Code' : 'API key configured'}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {authMethod === 'oauth'
                        ? 'Using OAuth token from macOS Keychain'
                        : 'Using ANTHROPIC_API_KEY environment variable'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex items-center gap-2 text-xs text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-50"
                >
                  {loggingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                  {loggingOut ? 'Logging out...' : 'Log out'}
                </button>
              </>
            )}

            {authStatus === 'unauthenticated' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-300">Not authenticated</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Sign in with Claude to get started</p>
                  </div>
                </div>
                <button
                  onClick={() => sendRaw({ type: 'login' })}
                  disabled={loginStatus === 'in_progress'}
                  className="flex items-center justify-center gap-2 w-full bg-blue-500 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-400 transition-colors disabled:opacity-50"
                >
                  {loginStatus === 'in_progress' ? (
                    <><Loader2 size={16} className="animate-spin" />Waiting for login...</>
                  ) : (
                    <><LogIn size={16} />Sign in with Claude</>
                  )}
                </button>
                {loginStatus === 'in_progress' && (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-xs text-zinc-400 text-center">Complete sign-in in your browser to continue.</p>
                    <button
                      onClick={() => sendRaw({ type: 'login_cancel' })}
                      className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <X size={12} />
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Agent Mode */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Bot size={14} className="text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-300">Agent Mode</h3>
          </div>
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4">
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
                          : 'bg-zinc-700/50 border-zinc-600/30 text-zinc-400'
                      : 'border-zinc-700/50 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {mode === 'autonomous' ? 'Auto' : mode}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-500 mt-2">
              {agentMode === 'autonomous' ? 'Full agent — executes actions autonomously'
                : agentMode === 'ask' ? 'Brainstorm only — no file edits or commands'
                : 'Agent disabled — no responses'}
            </p>
          </div>
        </section>

        {/* Permission Mode */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Cpu size={14} className="text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-300">Permission Mode</h3>
          </div>
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4">
            <div className="flex gap-2">
              {(['default', 'acceptEdits', 'bypassPermissions'] as const).map((mode) => {
                const labels: Record<string, string> = {
                  default: 'Default',
                  acceptEdits: 'Accept Edits',
                  bypassPermissions: 'Full Auto',
                };
                return (
                  <button
                    key={mode}
                    onClick={() => setPermMode(mode)}
                    className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${
                      permissionMode === mode
                        ? mode === 'default'
                          ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                          : mode === 'acceptEdits'
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
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

        {/* Voice Settings */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Volume2 size={14} className="text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-300">Voice (ElevenLabs)</h3>
          </div>
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4 space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-500">API Key</label>
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
              <label className="text-xs text-zinc-500">Voice ID</label>
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
        </section>

        {/* Sandbox */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Shield size={14} className="text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-300">Security</h3>
          </div>
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-zinc-300">Sandbox Mode</div>
                <div className="text-xs text-zinc-500 mt-0.5">Restrict agent to current working directory</div>
              </div>
              <button
                onClick={() => {
                  const next = !sandboxEnabled;
                  fetch(`${SIDECAR}/api/agent/sandbox`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: next }),
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
        </section>

        {/* GitHub Repository */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <GitBranch size={14} className="text-zinc-500" />
              <h3 className="text-sm font-medium text-zinc-300">GitHub Repository</h3>
            </div>
            <button
              onClick={fetchGitStatus}
              disabled={gitStatusLoading}
              className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={gitStatusLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-4 space-y-4">

            {/* Repo URL */}
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-500">Remote URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={githubRepoUrl}
                  onChange={(e) => setGithubRepoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveRemoteUrl()}
                  placeholder="https://github.com/..."
                  className="flex-1 bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
                />
                <button
                  onClick={saveRemoteUrl}
                  disabled={!githubRepoUrl.trim() || gitLoading === 'remote'}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors"
                >
                  {gitLoading === 'remote' ? <Loader2 size={12} className="animate-spin" /> : 'Set'}
                </button>
              </div>
            </div>

            {/* Status info */}
            {gitStatus && (
              <div className="space-y-2">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <GitBranch size={12} className="text-zinc-500" />
                    <span className="text-xs text-zinc-300 font-mono">{gitStatus.branch}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${gitStatus.clean ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    <span className={`text-xs ${gitStatus.clean ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {gitStatus.clean ? 'Clean' : 'Uncommitted changes'}
                    </span>
                  </div>
                </div>
                {gitStatus.lastCommit && (
                  <div className="bg-zinc-800/60 rounded-lg px-3 py-2 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <GitCommit size={11} className="text-zinc-500 shrink-0" />
                      <span className="text-xs text-zinc-200 truncate">{gitStatus.lastCommit.message}</span>
                    </div>
                    <div className="flex items-center gap-3 pl-[19px]">
                      <span className="text-[10px] text-zinc-500 font-mono">{gitStatus.lastCommit.hash.slice(0, 8)}</span>
                      <span className="text-[10px] text-zinc-500">{new Date(gitStatus.lastCommit.date).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => gitAction('pull')}
                disabled={!!gitLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors border border-zinc-700/50"
              >
                {gitLoading === 'pull' ? <Loader2 size={12} className="animate-spin" /> : <GitPullRequest size={12} />}
                Pull
              </button>
              <button
                onClick={() => gitAction('push')}
                disabled={!!gitLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors border border-zinc-700/50"
              >
                {gitLoading === 'push' ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                Push
              </button>
              <button
                onClick={fetchGitStatus}
                disabled={!!gitLoading || gitStatusLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors border border-zinc-700/50"
              >
                {gitStatusLoading ? <Loader2 size={12} className="animate-spin" /> : <Terminal size={12} />}
                View Status
              </button>
            </div>

            {/* Commit */}
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-500">Commit message</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && commitMessage.trim()) {
                      void gitAction('commit', { message: commitMessage });
                      setCommitMessage('');
                    }
                  }}
                  placeholder="Stage all and commit..."
                  className="flex-1 bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
                />
                <button
                  onClick={() => {
                    if (commitMessage.trim()) {
                      void gitAction('commit', { message: commitMessage });
                      setCommitMessage('');
                    }
                  }}
                  disabled={!commitMessage.trim() || !!gitLoading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors"
                >
                  {gitLoading === 'commit' ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
                  Commit
                </button>
              </div>
            </div>

            {/* Output area */}
            {gitOutput && (
              <div className="bg-zinc-950 rounded-lg border border-zinc-800/50 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Terminal size={11} className="text-zinc-500" />
                  <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wide">Output</span>
                </div>
                <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap break-all leading-relaxed max-h-40 overflow-y-auto">{gitOutput}</pre>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
