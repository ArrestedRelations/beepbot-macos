import { useEffect, useState, useCallback } from 'react';
import { Wallet, ArrowUpRight, ArrowDownLeft, RefreshCw, Copy, Check, TrendingUp, Coins } from 'lucide-react';
import { api } from '../../lib/api';

interface TokenBalance {
  botId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  lastUpdated: string;
}

interface EpochState {
  epoch: number;
  proofCount: number;
  nextEpochAt: number;
  inflationRate: number;
}

export function WalletView() {
  const [balance, setBalance] = useState<TokenBalance | null>(null);
  const [epoch, setEpoch] = useState<EpochState | null>(null);
  const [topBalances, setTopBalances] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [bal, ep, top] = await Promise.all([
        api<TokenBalance>('/network/wallet/balance'),
        api<EpochState>('/network/wallet/epoch'),
        api<TokenBalance[]>('/network/wallet/leaderboard'),
      ]);
      setBalance(bal);
      setEpoch(ep);
      setTopBalances(top);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 15_000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const exportKey = async () => {
    try {
      const res = await api<{ privateKey: string }>('/network/wallet/export-key');
      setPrivateKey(res.privateKey);
      setShowKey(true);
    } catch { /* ignore */ }
  };

  const copyKey = () => {
    if (privateKey) {
      navigator.clipboard.writeText(privateKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--bb-border)' }}>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--bb-accent-subtle)' }}
          >
            <Wallet size={20} style={{ color: 'var(--bb-accent)' }} />
          </div>
          <div>
            <div className="text-lg font-semibold" style={{ color: 'var(--bb-text-strong)' }}>
              Wallet
            </div>
            <div className="text-xs font-mono" style={{ color: 'var(--bb-text-faint)' }}>
              {balance?.botId ? `${balance.botId.slice(0, 24)}...` : '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 space-y-6">
        {/* Balance Card */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--bb-accent)', color: '#fff' }}
        >
          <div className="text-xs uppercase tracking-wider" style={{ opacity: 0.7 }}>Balance</div>
          <div className="text-3xl font-bold mt-1">
            {balance?.balance.toFixed(2) ?? '0.00'} <span className="text-lg font-normal">BT</span>
          </div>
          <div className="flex gap-6 mt-3 text-xs" style={{ opacity: 0.8 }}>
            <div className="flex items-center gap-1">
              <ArrowDownLeft size={12} />
              Earned: {balance?.totalEarned.toFixed(2) ?? '0.00'}
            </div>
            <div className="flex items-center gap-1">
              <ArrowUpRight size={12} />
              Spent: {balance?.totalSpent.toFixed(2) ?? '0.00'}
            </div>
          </div>
        </div>

        {/* Epoch Info */}
        {epoch && (
          <div
            className="rounded-xl p-4 flex items-center justify-between"
            style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)' }}
          >
            <div>
              <div className="text-xs" style={{ color: 'var(--bb-text-faint)' }}>Epoch {epoch.epoch}</div>
              <div className="text-sm font-semibold" style={{ color: 'var(--bb-text-strong)' }}>
                {epoch.proofCount.toLocaleString()} / {epoch.nextEpochAt.toLocaleString()} proofs
              </div>
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp size={14} style={{ color: 'var(--bb-accent)' }} />
              <div className="text-sm" style={{ color: 'var(--bb-text-muted)' }}>
                {(epoch.inflationRate * 100).toFixed(1)}% inflation
              </div>
            </div>
          </div>
        )}

        {/* Key Export */}
        <div
          className="rounded-xl p-4"
          style={{ background: 'var(--bb-bg-accent)', border: '1px solid var(--bb-border)' }}
        >
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold" style={{ color: 'var(--bb-text-strong)' }}>
              Private Key
            </div>
            {!showKey ? (
              <button
                onClick={exportKey}
                className="px-3 py-1 rounded-lg text-xs transition-colors"
                style={{ background: 'var(--bb-bg)', border: '1px solid var(--bb-border)', color: 'var(--bb-text-muted)' }}
              >
                Export Key
              </button>
            ) : (
              <button
                onClick={copyKey}
                className="px-3 py-1 rounded-lg text-xs flex items-center gap-1 transition-colors"
                style={{ background: 'var(--bb-bg)', border: '1px solid var(--bb-border)', color: 'var(--bb-text-muted)' }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          {showKey && privateKey && (
            <pre
              className="mt-2 p-3 rounded-lg text-[10px] font-mono break-all whitespace-pre-wrap"
              style={{ background: 'var(--bb-bg)', color: 'var(--bb-text-muted)', border: '1px solid var(--bb-border)' }}
            >
              {privateKey}
            </pre>
          )}
          <div className="text-[10px] mt-2" style={{ color: 'var(--bb-text-faint)' }}>
            Save this key securely. It cannot be recovered if lost. This key IS your wallet.
          </div>
        </div>

        {/* Leaderboard */}
        {topBalances.length > 0 && (
          <div>
            <div className="text-xs font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--bb-text-muted)' }}>
              <Coins size={12} /> Network Leaderboard
            </div>
            <div
              className="rounded-xl overflow-hidden"
              style={{ border: '1px solid var(--bb-border)' }}
            >
              {topBalances.slice(0, 10).map((tb, i) => (
                <div
                  key={tb.botId}
                  className="flex items-center justify-between px-4 py-2 text-sm"
                  style={{
                    borderBottom: i < topBalances.length - 1 ? '1px solid var(--bb-border)' : 'none',
                    background: i === 0 ? 'var(--bb-bg-accent)' : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-5 text-right" style={{ color: 'var(--bb-text-faint)' }}>{i + 1}</span>
                    <span className="font-mono text-xs" style={{ color: 'var(--bb-text)' }}>
                      {tb.botId.slice(0, 20)}...
                    </span>
                  </div>
                  <span className="font-semibold" style={{ color: 'var(--bb-text-strong)' }}>
                    {tb.balance.toFixed(2)} BT
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
