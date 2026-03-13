import { useEffect, useState, useCallback } from 'react';
import { Shield, Lock, Unlock, Plus, Eye, EyeOff, Trash2, CreditCard, Key, User, MapPin, FileText, Globe, RefreshCw, Star, Search } from 'lucide-react';
import { api } from '../../lib/api';

interface VaultStatus {
  hasPassword: boolean;
  isUnlocked: boolean;
  totalEntries: number;
  totalAccesses: number;
  monthlySpend: string;
}

interface VaultEntry {
  id: string;
  category: string;
  label: string;
  icon: string | null;
  favorite: number;
  created_at: string;
  updated_at: string;
}

interface VaultEntryDetail extends VaultEntry {
  data: Record<string, unknown>;
}

const CATEGORY_ICONS: Record<string, typeof CreditCard> = {
  payment_method: CreditCard,
  login: Key,
  identity: User,
  address: MapPin,
  personal_info: User,
  secure_note: FileText,
  api_key: Globe,
};

const CATEGORY_LABELS: Record<string, string> = {
  payment_method: 'Payment Method',
  login: 'Login',
  identity: 'Identity',
  address: 'Address',
  personal_info: 'Personal Info',
  secure_note: 'Secure Note',
  api_key: 'API Key',
};

export function VaultView() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<VaultEntryDetail | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());

  const fetchStatus = useCallback(async () => {
    try {
      const s = await api<VaultStatus>('/vault/status');
      setStatus(s);
      if (s.isUnlocked) {
        const res = await api<{ entries: VaultEntry[] }>(
          `/vault/entries?category=${categoryFilter}&search=${encodeURIComponent(search)}`
        );
        setEntries(res.entries || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [categoryFilter, search]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleSetPassword = async () => {
    setError('');
    const res = await api<{ ok: boolean; error?: string }>('/vault/set-password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setPassword('');
      fetchStatus();
    } else {
      setError(res.error || 'Failed to set password');
    }
  };

  const handleUnlock = async () => {
    setError('');
    const res = await api<{ ok: boolean; error?: string }>('/vault/unlock', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setPassword('');
      fetchStatus();
    } else {
      setError(res.error || 'Incorrect password');
    }
  };

  const handleLock = async () => {
    await api('/vault/lock', { method: 'POST' });
    setSelectedEntry(null);
    setEntries([]);
    fetchStatus();
  };

  const viewEntry = async (id: string) => {
    const res = await api<{ ok: boolean; entry: VaultEntryDetail }>(`/vault/entries/${id}`);
    if (res.ok) {
      setSelectedEntry(res.entry);
      setRevealedFields(new Set());
    }
  };

  const deleteEntry = async (id: string) => {
    if (!confirm('Delete this vault entry? This cannot be undone.')) return;
    await api(`/vault/entries/${id}`, { method: 'DELETE' });
    setSelectedEntry(null);
    fetchStatus();
  };

  const toggleField = (field: string) => {
    setRevealedFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field); else next.add(field);
      return next;
    });
  };

  const isSensitive = (key: string) =>
    /password|secret|cvv|cardnumber|key|token|ssn|idnumber/i.test(key);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--bb-text-faint)' }} />
      </div>
    );
  }

  // No password set yet
  if (status && !status.hasPassword) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-80 space-y-4 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto" style={{ background: 'var(--bb-accent-subtle)' }}>
            <Shield size={28} style={{ color: 'var(--bb-accent)' }} />
          </div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--bb-text-strong)' }}>Set Up Vault</h2>
          <p className="text-sm" style={{ color: 'var(--bb-text-muted)' }}>
            Create a master password to protect your credentials, payment methods, and secrets.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()}
            placeholder="Master password (min 4 chars)"
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)', color: 'var(--bb-text-strong)' }}
          />
          {error && <p className="text-xs" style={{ color: 'var(--bb-danger)' }}>{error}</p>}
          <button
            onClick={handleSetPassword}
            disabled={password.length < 4}
            className="w-full px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--bb-accent)', color: '#fff', opacity: password.length < 4 ? 0.5 : 1 }}
          >
            Create Vault
          </button>
        </div>
      </div>
    );
  }

  // Vault is locked
  if (status && !status.isUnlocked) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-80 space-y-4 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto" style={{ background: 'var(--bb-accent-subtle)' }}>
            <Lock size={28} style={{ color: 'var(--bb-accent)' }} />
          </div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--bb-text-strong)' }}>Vault Locked</h2>
          <p className="text-sm" style={{ color: 'var(--bb-text-muted)' }}>
            {status.totalEntries} entries stored. Enter your master password to unlock.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            placeholder="Master password"
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)', color: 'var(--bb-text-strong)' }}
            autoFocus
          />
          {error && <p className="text-xs" style={{ color: 'var(--bb-danger)' }}>{error}</p>}
          <button
            onClick={handleUnlock}
            disabled={!password}
            className="w-full px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--bb-accent)', color: '#fff', opacity: !password ? 0.5 : 1 }}
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  // Vault is unlocked — show entries
  return (
    <div className="flex h-full">
      {/* Entry list */}
      <div className="w-80 shrink-0 flex flex-col" style={{ borderRight: '1px solid var(--bb-border)' }}>
        {/* Controls */}
        <div className="px-4 py-3 space-y-2 shrink-0" style={{ borderBottom: '1px solid var(--bb-border)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Unlock size={14} style={{ color: 'var(--bb-ok)' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--bb-ok)' }}>Unlocked</span>
              <span className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>({status?.totalEntries ?? 0})</span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setShowCreateForm(true)}
                className="p-1.5 rounded-md"
                style={{ color: 'var(--bb-accent)' }}
                title="Add entry"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={handleLock}
                className="p-1.5 rounded-md"
                style={{ color: 'var(--bb-text-muted)' }}
                title="Lock vault"
              >
                <Lock size={14} />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2" style={{ color: 'var(--bb-text-faint)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-8 pr-3 py-1.5 rounded-md text-xs"
              style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)', color: 'var(--bb-text-strong)' }}
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full px-2 py-1 rounded-md text-xs"
            style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)', color: 'var(--bb-text-strong)' }}
          >
            <option value="all">All Categories</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--bb-text-faint)' }}>
              No entries found
            </div>
          ) : (
            entries.map((entry) => {
              const Icon = CATEGORY_ICONS[entry.category] || Key;
              const isActive = selectedEntry?.id === entry.id;
              return (
                <button
                  key={entry.id}
                  onClick={() => viewEntry(entry.id)}
                  className="w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors"
                  style={{
                    background: isActive ? 'var(--bb-accent-subtle)' : 'transparent',
                    borderBottom: '1px solid var(--bb-border)',
                  }}
                >
                  <Icon size={14} style={{ color: isActive ? 'var(--bb-accent)' : 'var(--bb-text-muted)', flexShrink: 0 }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--bb-text-strong)' }}>
                      {entry.favorite ? <Star size={10} className="inline mr-1" style={{ color: 'var(--bb-accent)' }} /> : null}
                      {entry.label}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--bb-text-faint)' }}>
                      {CATEGORY_LABELS[entry.category] || entry.category}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div className="flex-1 overflow-y-auto">
        {showCreateForm ? (
          <CreateEntryForm
            onCreated={() => { setShowCreateForm(false); fetchStatus(); }}
            onCancel={() => setShowCreateForm(false)}
          />
        ) : selectedEntry ? (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--bb-text-strong)' }}>{selectedEntry.label}</h3>
                <span className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>
                  {CATEGORY_LABELS[selectedEntry.category] || selectedEntry.category}
                </span>
              </div>
              <button
                onClick={() => deleteEntry(selectedEntry.id)}
                className="p-2 rounded-lg"
                style={{ color: 'var(--bb-danger)' }}
                title="Delete entry"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="space-y-2">
              {Object.entries(selectedEntry.data).map(([key, value]) => {
                const sensitive = isSensitive(key);
                const revealed = revealedFields.has(key);
                const displayValue = sensitive && !revealed
                  ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'
                  : String(value ?? '');
                return (
                  <div key={key} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: 'var(--bb-bg-accent)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-medium uppercase" style={{ color: 'var(--bb-text-faint)' }}>
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                      </div>
                      <div className="text-xs font-mono break-all" style={{ color: 'var(--bb-text-strong)' }}>
                        {displayValue}
                      </div>
                    </div>
                    {sensitive && (
                      <button onClick={() => toggleField(key)} className="p-1 shrink-0" style={{ color: 'var(--bb-text-muted)' }}>
                        {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] space-y-0.5" style={{ color: 'var(--bb-text-faint)' }}>
              <div>Created: {new Date(selectedEntry.created_at).toLocaleString()}</div>
              <div>Updated: {new Date(selectedEntry.updated_at).toLocaleString()}</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>Select an entry to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Create Entry Form =====

function CreateEntryForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [category, setCategory] = useState('login');
  const [label, setLabel] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const FIELD_SCHEMAS: Record<string, string[]> = {
    payment_method: ['cardholderName', 'cardNumber', 'expirationMonth', 'expirationYear', 'cvv', 'cardType', 'billingAddress', 'billingZip'],
    login: ['username', 'password', 'url'],
    identity: ['fullName', 'dateOfBirth', 'idType', 'idNumber', 'issuingAuthority', 'expirationDate'],
    address: ['street', 'street2', 'city', 'state', 'zip', 'country'],
    personal_info: ['fieldName', 'value', 'notes'],
    secure_note: ['content'],
    api_key: ['service', 'key', 'secret', 'baseUrl', 'notes'],
  };

  const currentFields = FIELD_SCHEMAS[category] || [];

  const handleSave = async () => {
    if (!label.trim()) { setError('Label is required'); return; }
    setSaving(true);
    setError('');
    const data: Record<string, string> = {};
    for (const f of currentFields) {
      if (fields[f]) data[f] = fields[f];
    }
    const res = await api<{ ok: boolean; error?: string }>('/vault/entries', {
      method: 'POST',
      body: JSON.stringify({ category, label: label.trim(), data }),
    });
    setSaving(false);
    if (res.ok) {
      onCreated();
    } else {
      setError(res.error || 'Failed to save');
    }
  };

  const isSensitiveField = (key: string) =>
    /password|secret|cvv|cardnumber|key|idnumber/i.test(key);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold" style={{ color: 'var(--bb-text-strong)' }}>New Entry</h3>
        <button onClick={onCancel} className="text-xs px-3 py-1 rounded-md" style={{ color: 'var(--bb-text-muted)', border: '1px solid var(--bb-border)' }}>
          Cancel
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-[10px] font-medium uppercase block mb-1" style={{ color: 'var(--bb-text-faint)' }}>Category</label>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setFields({}); }}
            className="w-full px-3 py-1.5 rounded-lg text-xs"
            style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)', color: 'var(--bb-text-strong)' }}
          >
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-medium uppercase block mb-1" style={{ color: 'var(--bb-text-faint)' }}>Label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. My Visa Card, GitHub Login"
            className="w-full px-3 py-1.5 rounded-lg text-xs"
            style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)', color: 'var(--bb-text-strong)' }}
          />
        </div>

        {currentFields.map((field) => (
          <div key={field}>
            <label className="text-[10px] font-medium uppercase block mb-1" style={{ color: 'var(--bb-text-faint)' }}>
              {field.replace(/([A-Z])/g, ' $1').trim()}
            </label>
            {field === 'content' || field === 'notes' ? (
              <textarea
                value={fields[field] || ''}
                onChange={(e) => setFields(f => ({ ...f, [field]: e.target.value }))}
                rows={4}
                className="w-full px-3 py-1.5 rounded-lg text-xs resize-none"
                style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)', color: 'var(--bb-text-strong)' }}
              />
            ) : (
              <input
                type={isSensitiveField(field) ? 'password' : 'text'}
                value={fields[field] || ''}
                onChange={(e) => setFields(f => ({ ...f, [field]: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg text-xs"
                style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)', color: 'var(--bb-text-strong)' }}
              />
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-xs" style={{ color: 'var(--bb-danger)' }}>{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving || !label.trim()}
        className="w-full px-4 py-2 rounded-lg text-sm font-medium"
        style={{ background: 'var(--bb-accent)', color: '#fff', opacity: saving || !label.trim() ? 0.5 : 1 }}
      >
        {saving ? 'Saving...' : 'Save Entry'}
      </button>
    </div>
  );
}
