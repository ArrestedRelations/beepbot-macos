import { useEffect, useState, useCallback } from 'react';
import { GitBranch, GitCommit, RefreshCw, Download, Upload, CheckSquare, AlertCircle, CheckCircle2, Save, KeyRound, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';

interface GitStatus {
  ok: boolean;
  branch?: string;
  clean?: boolean;
  remoteUrl?: string;
  lastCommit?: {
    hash: string;
    message: string;
    date: string;
  } | null;
  error?: string;
}

interface GitLogResponse {
  ok: boolean;
  commits?: GitCommitEntry[];
  error?: string;
}

interface GitCommitEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

interface GitOpResponse {
  ok: boolean;
  output?: string;
  error?: string;
}

type OpStatus = { type: 'idle' } | { type: 'loading' } | { type: 'ok'; message: string } | { type: 'error'; message: string };

function OpBadge({ status }: { status: OpStatus }) {
  if (status.type === 'idle') return null;
  if (status.type === 'loading') {
    return (
      <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--bb-text-faint)' }}>
        <RefreshCw size={11} className="animate-spin" /> Working...
      </span>
    );
  }
  if (status.type === 'ok') {
    return (
      <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--bb-ok)' }}>
        <CheckCircle2 size={11} /> {status.message}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--bb-danger)' }}>
      <AlertCircle size={11} /> {status.message}
    </span>
  );
}

interface PatStatusResponse {
  ok: boolean;
  configured: boolean;
}

export function GithubView() {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [commitMsg, setCommitMsg] = useState('');

  // Editable repo settings
  const [remoteUrl, setRemoteUrl] = useState('https://github.com/ArrestedRelations/beepbot-macos.git');
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('arrestedrelations@gmail.com');
  const [remoteStatus, setRemoteStatus] = useState<OpStatus>({ type: 'idle' });

  const [pullStatus, setPullStatus] = useState<OpStatus>({ type: 'idle' });
  const [pushStatus, setPushStatus] = useState<OpStatus>({ type: 'idle' });
  const [commitStatus, setCommitStatus] = useState<OpStatus>({ type: 'idle' });

  // PAT state
  const [patConfigured, setPatConfigured] = useState(false);
  const [patInput, setPatInput] = useState('');
  const [patStatus, setPatStatus] = useState<OpStatus>({ type: 'idle' });

  const fetchAll = useCallback(async () => {
    try {
      const [s, logRes, patRes] = await Promise.all([
        api<GitStatus>('/github/status'),
        api<GitLogResponse>('/github/log'),
        api<PatStatusResponse>('/github/pat'),
      ]);
      setStatus(s);
      if (s.remoteUrl) setRemoteUrl(s.remoteUrl);
      if (logRes.ok && logRes.commits) setCommits(logRes.commits);
      if (patRes.ok) setPatConfigured(patRes.configured);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  const runOp = async (
    setter: (s: OpStatus) => void,
    fn: () => Promise<GitOpResponse>,
  ) => {
    setter({ type: 'loading' });
    try {
      const res = await fn();
      if (res.ok) {
        setter({ type: 'ok', message: res.output?.trim().slice(0, 80) || 'Done' });
      } else {
        setter({ type: 'error', message: res.error?.slice(0, 80) || 'Failed' });
      }
    } catch (e) {
      setter({ type: 'error', message: String(e).slice(0, 80) });
    }
    await fetchAll();
    setTimeout(() => setter({ type: 'idle' }), 5000);
  };

  const doPull = () =>
    runOp(setPullStatus, () =>
      api<GitOpResponse>('/github/pull', { method: 'POST' }),
    );

  const doPush = () =>
    runOp(setPushStatus, () =>
      api<GitOpResponse>('/github/push', { method: 'POST' }),
    );

  const doCommit = () => {
    if (!commitMsg.trim()) return;
    runOp(setCommitStatus, () =>
      api<GitOpResponse>('/github/commit', {
        method: 'POST',
        body: JSON.stringify({ message: commitMsg.trim() }),
      }),
    ).then(() => setCommitMsg(''));
  };

  const doSaveRemote = () =>
    runOp(setRemoteStatus, () =>
      api<GitOpResponse>('/github/remote', {
        method: 'POST',
        body: JSON.stringify({ url: remoteUrl.trim() }),
      }),
    );

  const doSavePat = async () => {
    if (!patInput.trim()) return;
    setPatStatus({ type: 'loading' });
    try {
      const res = await api<{ ok: boolean; error?: string }>('/github/pat', {
        method: 'POST',
        body: JSON.stringify({ token: patInput.trim() }),
      });
      if (res.ok) {
        setPatConfigured(true);
        setPatInput('');
        setPatStatus({ type: 'ok', message: 'PAT saved' });
      } else {
        setPatStatus({ type: 'error', message: res.error?.slice(0, 80) || 'Failed to save PAT' });
      }
    } catch (e) {
      setPatStatus({ type: 'error', message: String(e).slice(0, 80) });
    }
    setTimeout(() => setPatStatus({ type: 'idle' }), 5000);
  };

  const doRemovePat = async () => {
    setPatStatus({ type: 'loading' });
    try {
      await api<{ ok: boolean }>('/github/pat', { method: 'DELETE' });
      setPatConfigured(false);
      setPatInput('');
      setPatStatus({ type: 'ok', message: 'PAT removed' });
    } catch (e) {
      setPatStatus({ type: 'error', message: String(e).slice(0, 80) });
    }
    setTimeout(() => setPatStatus({ type: 'idle' }), 5000);
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--bb-text-faint)' }} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl">

      {/* Repo Settings */}
      <div
        className="rounded-xl p-4 space-y-4"
        style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)' }}
      >
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--bb-text-faint)' }}>
            Repository
          </div>
          <button
            onClick={fetchAll}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: 'var(--bb-text-muted)' }}
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[11px]" style={{ color: 'var(--bb-text-faint)' }}>Repository URL</label>
            <input
              type="text"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://github.com/user/repo.git"
              className="w-full px-3 py-2 rounded-lg text-sm font-mono outline-none"
              style={{
                background: 'var(--bb-bg)',
                border: '1px solid var(--bb-border)',
                color: 'var(--bb-text)',
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px]" style={{ color: 'var(--bb-text-faint)' }}>Author name</label>
            <input
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                background: 'var(--bb-bg)',
                border: '1px solid var(--bb-border)',
                color: 'var(--bb-text)',
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px]" style={{ color: 'var(--bb-text-faint)' }}>Author email</label>
            <input
              type="email"
              value={authorEmail}
              onChange={(e) => setAuthorEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                background: 'var(--bb-bg)',
                border: '1px solid var(--bb-border)',
                color: 'var(--bb-text)',
              }}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={doSaveRemote}
              disabled={remoteStatus.type === 'loading' || !remoteUrl.trim()}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
              style={{
                background: 'var(--bb-bg)',
                border: '1px solid var(--bb-border)',
                color: 'var(--bb-text)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--bb-accent)'; e.currentTarget.style.color = 'var(--bb-accent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--bb-border)'; e.currentTarget.style.color = 'var(--bb-text)'; }}
            >
              <Save size={12} />
              Save remote
            </button>
            <OpBadge status={remoteStatus} />
          </div>

          {/* PAT section */}
          <div className="space-y-2 pt-3" style={{ borderTop: '1px solid var(--bb-border)' }}>
            <div className="flex items-center justify-between">
              <label className="text-[11px]" style={{ color: 'var(--bb-text-faint)' }}>Personal Access Token</label>
              <span
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: patConfigured
                    ? 'var(--bb-ok-subtle, rgba(34,197,94,0.1))'
                    : 'var(--bb-warn-subtle, rgba(234,179,8,0.1))',
                  color: patConfigured ? 'var(--bb-ok)' : 'var(--bb-warn, #eab308)',
                }}
              >
                <KeyRound size={10} />
                {patConfigured ? 'PAT configured' : 'No PAT configured'}
              </span>
            </div>
            <input
              type="password"
              value={patInput}
              onChange={(e) => setPatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void doSavePat(); }}
              placeholder={patConfigured ? 'Enter new token to replace...' : 'ghp_...'}
              className="w-full px-3 py-2 rounded-lg text-sm font-mono outline-none"
              style={{
                background: 'var(--bb-bg)',
                border: '1px solid var(--bb-border)',
                color: 'var(--bb-text)',
              }}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => void doSavePat()}
                disabled={patStatus.type === 'loading' || !patInput.trim()}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                style={{
                  background: 'var(--bb-bg)',
                  border: '1px solid var(--bb-border)',
                  color: 'var(--bb-text)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--bb-accent)'; e.currentTarget.style.color = 'var(--bb-accent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--bb-border)'; e.currentTarget.style.color = 'var(--bb-text)'; }}
              >
                <Save size={12} />
                Save PAT
              </button>
              {patConfigured && (
                <button
                  onClick={() => void doRemovePat()}
                  disabled={patStatus.type === 'loading'}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                  style={{
                    background: 'var(--bb-bg)',
                    border: '1px solid var(--bb-border)',
                    color: 'var(--bb-danger, #ef4444)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--bb-danger, #ef4444)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--bb-border)'; }}
                >
                  <Trash2 size={12} />
                  Remove
                </button>
              )}
              <OpBadge status={patStatus} />
            </div>
            <p className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
              Required for private repositories. Token is encrypted at rest.
            </p>
          </div>
        </div>
      </div>

      {/* Git Status */}
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)' }}
      >
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--bb-text-faint)' }}>
          Status
        </div>

        {status?.ok ? (
          <div className="space-y-2">
            {/* Branch + clean/dirty */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <GitBranch size={13} style={{ color: 'var(--bb-accent)' }} />
                <span className="text-sm font-mono font-semibold" style={{ color: 'var(--bb-text-strong)' }}>
                  {status.branch ?? 'unknown'}
                </span>
              </div>
              <span
                className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: status.clean
                    ? 'var(--bb-ok-subtle, rgba(34,197,94,0.1))'
                    : 'var(--bb-warn-subtle, rgba(234,179,8,0.1))',
                  color: status.clean ? 'var(--bb-ok)' : 'var(--bb-warn, #eab308)',
                }}
              >
                {status.clean ? 'clean' : 'dirty'}
              </span>
            </div>

            {/* Last commit */}
            {status.lastCommit && (
              <div
                className="flex items-start gap-2 pt-2 mt-2"
                style={{ borderTop: '1px solid var(--bb-border)' }}
              >
                <GitCommit size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--bb-text-faint)' }} />
                <div className="min-w-0">
                  <div className="text-[11px] font-mono text-ellipsis overflow-hidden" style={{ color: 'var(--bb-text)' }}>
                    {status.lastCommit.message}
                  </div>
                  <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--bb-text-faint)' }}>
                    {status.lastCommit.hash.slice(0, 7)} · {formatDate(status.lastCommit.date)}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm" style={{ color: 'var(--bb-text-faint)' }}>
            {status?.error ?? 'Unable to load git status.'}
          </div>
        )}
      </div>

      {/* Operations */}
      <div
        className="rounded-xl p-4 space-y-4"
        style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)' }}
      >
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--bb-text-faint)' }}>
          Operations
        </div>

        {/* Pull / Push */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={doPull}
            disabled={pullStatus.type === 'loading'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
            style={{
              background: 'var(--bb-bg)',
              border: '1px solid var(--bb-border)',
              color: 'var(--bb-text)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--bb-accent)'; e.currentTarget.style.color = 'var(--bb-accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--bb-border)'; e.currentTarget.style.color = 'var(--bb-text)'; }}
          >
            <Download size={14} />
            Pull
          </button>
          <OpBadge status={pullStatus} />

          <button
            onClick={doPush}
            disabled={pushStatus.type === 'loading'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
            style={{
              background: 'var(--bb-bg)',
              border: '1px solid var(--bb-border)',
              color: 'var(--bb-text)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--bb-accent)'; e.currentTarget.style.color = 'var(--bb-accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--bb-border)'; e.currentTarget.style.color = 'var(--bb-text)'; }}
          >
            <Upload size={14} />
            Push
          </button>
          <OpBadge status={pushStatus} />
        </div>

        {/* Commit */}
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <input
              type="text"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doCommit(); }}
              placeholder="Commit message..."
              className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                background: 'var(--bb-bg)',
                border: '1px solid var(--bb-border)',
                color: 'var(--bb-text)',
              }}
            />
            <button
              onClick={doCommit}
              disabled={!commitMsg.trim() || commitStatus.type === 'loading'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
              style={{ background: 'var(--bb-accent)', color: '#fff' }}
            >
              <CheckSquare size={14} />
              Commit
            </button>
          </div>
          <OpBadge status={commitStatus} />
        </div>
      </div>

      {/* Commit Log */}
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)' }}
      >
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--bb-text-faint)' }}>
          Recent Commits
        </div>

        {commits.length === 0 ? (
          <div className="text-sm" style={{ color: 'var(--bb-text-faint)' }}>No commit history available.</div>
        ) : (
          <div className="space-y-0">
            {commits.map((c, i) => (
              <div
                key={c.hash}
                className="flex items-start gap-3 py-2.5"
                style={{ borderBottom: i < commits.length - 1 ? '1px solid var(--bb-border)' : 'none' }}
              >
                <div
                  className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: 'var(--bb-accent)' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ellipsis overflow-hidden whitespace-nowrap" style={{ color: 'var(--bb-text)' }}>
                    {c.message}
                  </div>
                  <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--bb-text-faint)' }}>
                    {c.hash.slice(0, 7)} · {c.author} · {formatDate(c.date)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
