export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const normalized = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const diff = Date.now() - new Date(normalized).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function timeUntil(dateStr: string | null): string {
  if (!dateStr) return '-';
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) return 'overdue';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  ok: { dot: 'var(--bb-ok)', label: 'OK' },
  error: { dot: 'var(--bb-danger, #ef4444)', label: 'Error' },
  skipped: { dot: 'var(--bb-text-faint)', label: 'Skipped' },
};

export function intervalToCron(amount: number, unit: 'minutes' | 'hours' | 'days'): string {
  if (unit === 'minutes') {
    if (amount <= 0 || amount > 59) return '* * * * *';
    return `*/${amount} * * * *`;
  }
  if (unit === 'hours') {
    if (amount <= 0 || amount > 23) return '0 * * * *';
    return `0 */${amount} * * *`;
  }
  // days
  if (amount <= 0 || amount > 31) return '0 0 * * *';
  return `0 0 */${amount} * *`;
}
