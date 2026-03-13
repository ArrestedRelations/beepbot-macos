import { useState } from 'react';
import {
  LayoutDashboard, MessageSquare, BarChart3, Clock,
  Bot, Sparkles, Settings, Bug, FileText, Mountain, RotateCw, Github,
} from 'lucide-react';
import { useAppStore } from '../stores/app-store';
import { OverviewView } from './dashboard/overview';
import { SessionsView } from './dashboard/sessions';
import { UsageView } from './dashboard/usage';
import { CronView } from './dashboard/cron';
import { AgentView } from './dashboard/agent';
import { SkillsView } from './dashboard/skills';
import { ConfigView } from './dashboard/config';
import { DebugView } from './dashboard/debug';
import { LogsView } from './dashboard/logs';
import { HillView } from './dashboard/hill';
import { GithubView } from './dashboard/github';

type DashboardPage = 'overview' | 'sessions' | 'usage' | 'cron' | 'agent' | 'skills' | 'config' | 'debug' | 'logs' | 'hill' | 'github';

interface NavItem {
  id: DashboardPage;
  icon: typeof LayoutDashboard;
  label: string;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'CONTROL',
    items: [
      { id: 'overview', icon: LayoutDashboard, label: 'Overview' },
      { id: 'sessions', icon: MessageSquare, label: 'Sessions' },
      { id: 'usage', icon: BarChart3, label: 'Usage' },
      { id: 'cron', icon: Clock, label: 'Cron Jobs' },
    ],
  },
  {
    title: 'NETWORK',
    items: [
      { id: 'hill', icon: Mountain, label: 'The Hill' },
      { id: 'github', icon: Github, label: 'GitHub' },
    ],
  },
  {
    title: 'AGENT',
    items: [
      { id: 'agent', icon: Bot, label: 'Agent Config' },
      { id: 'skills', icon: Sparkles, label: 'Skills' },
    ],
  },
  {
    title: 'SETTINGS',
    items: [
      { id: 'config', icon: Settings, label: 'Config' },
      { id: 'debug', icon: Bug, label: 'Debug' },
      { id: 'logs', icon: FileText, label: 'Logs' },
    ],
  },
];

const PAGE_TITLES: Record<DashboardPage, { title: string; subtitle: string }> = {
  overview: { title: 'Overview', subtitle: 'System status and activity' },
  sessions: { title: 'Sessions', subtitle: 'Conversation history and details' },
  usage: { title: 'Usage', subtitle: 'Token usage and cost estimates' },
  cron: { title: 'Cron Jobs', subtitle: 'Scheduled tasks and automation' },
  agent: { title: 'Agent Config', subtitle: 'Model, permissions, and workspace' },
  skills: { title: 'Skills', subtitle: 'Available agent capabilities' },
  config: { title: 'Config', subtitle: 'All settings in one place' },
  debug: { title: 'Debug', subtitle: 'WebSocket events and agent state' },
  logs: { title: 'Logs', subtitle: 'Live log stream from sidecar' },
  hill: { title: 'The Hill', subtitle: 'Inter-bot communication hub' },
  github: { title: 'GitHub', subtitle: 'Repository connection and git operations' },
};

interface DashboardShellProps {
  sendRaw: (data: Record<string, unknown>) => void;
}

export function DashboardShell({ sendRaw }: DashboardShellProps) {
  const [page, setPage] = useState<DashboardPage>('overview');
  const status = useAppStore((s) => s.status);
  const agentMode = useAppStore((s) => s.agentMode);

  const pageInfo = PAGE_TITLES[page];

  return (
    <div className="h-screen flex" style={{ background: 'var(--bb-bg)' }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col shrink-0 border-r"
        style={{
          width: 'var(--bb-sidebar-w)',
          background: 'var(--bb-bg-accent)',
          borderColor: 'var(--bb-border)',
        }}
      >
        {/* Brand */}
        <div
          className="flex items-center gap-2.5 px-4 shrink-0"
          style={{ height: 'var(--bb-topbar-h)', borderBottom: '1px solid var(--bb-border)' }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--bb-accent-subtle)' }}
          >
            <Bot size={16} style={{ color: 'var(--bb-accent)' }} />
          </div>
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--bb-text-strong)', letterSpacing: '-0.02em' }}>
              BeepBot
            </div>
            <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>Dashboard</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="bb-section-title mb-2">{group.title}</div>
              <div className="space-y-0.5">
                {group.items.map(({ id, icon: Icon, label }) => {
                  const isActive = page === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setPage(id)}
                      className={`bb-nav-item ${isActive ? 'bb-nav-item-active' : ''}`}
                    >
                      <Icon size={16} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom status */}
        <div className="px-3 py-3 shrink-0" style={{ borderTop: '1px solid var(--bb-border)' }}>
          <div className="flex items-center gap-2">
            <span className={`bb-dot ${
              agentMode === 'stop' ? 'bb-dot-muted'
                : status === 'error' ? 'bb-dot-danger'
                : (status === 'thinking' || status === 'tool_call') ? 'bb-dot-ok'
                : 'bb-dot-muted'
            }`} style={{ width: 6, height: 6 }} />
            <span className="text-[11px] font-medium" style={{ color: 'var(--bb-text-muted)' }}>
              {agentMode === 'stop' ? 'Stopped'
                : status === 'thinking' ? 'Thinking...'
                : status === 'tool_call' ? 'Working...'
                : status === 'error' ? 'Error'
                : 'Idle'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bb-bg)' }}>
        {/* Top bar */}
        <header
          className="flex items-center justify-between px-6 shrink-0"
          style={{
            height: 'var(--bb-topbar-h)',
            borderBottom: '1px solid var(--bb-border)',
            background: 'var(--bb-bg)',
          }}
        >
          <div>
            <h1 className="bb-page-title">{pageInfo.title}</h1>
            <p className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>
              {pageInfo.subtitle}
            </p>
          </div>
          <button
            onClick={async () => {
              if (!confirm('Restart BeepBot? The agent session will be preserved.')) return;
              try {
                await fetch('http://localhost:3004/api/system/restart', { method: 'POST' });
              } catch { /* server is shutting down */ }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: 'var(--bb-bg-accent)',
              color: 'var(--bb-text-muted)',
              border: '1px solid var(--bb-border)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--bb-accent)';
              e.currentTarget.style.borderColor = 'var(--bb-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--bb-text-muted)';
              e.currentTarget.style.borderColor = 'var(--bb-border)';
            }}
            title="Restart BeepBot (agent session preserved)"
          >
            <RotateCw size={13} />
            Restart
          </button>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto">
          {page === 'overview' && <OverviewView />}
          {page === 'sessions' && <SessionsView />}
          {page === 'usage' && <UsageView />}
          {page === 'cron' && <CronView />}
          {page === 'agent' && <AgentView />}
          {page === 'skills' && <SkillsView />}
          {page === 'config' && <ConfigView sendRaw={sendRaw} />}
          {page === 'debug' && <DebugView />}
          {page === 'logs' && <LogsView />}
          {page === 'hill' && <HillView />}
          {page === 'github' && <GithubView />}
        </div>
      </main>
    </div>
  );
}
