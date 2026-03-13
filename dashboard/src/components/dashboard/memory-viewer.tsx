import { useState } from 'react';
import { FileText, ChevronRight, Save, ArrowLeft } from 'lucide-react';
import type { MemoryFile } from '../../stores/dashboard-store';

const SIDECAR = 'http://127.0.0.1:3004';

function formatSize(bytes: number): string {
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

export function MemoryViewer({ files }: { files: MemoryFile[] }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadFile(filename: string) {
    try {
      const res = await fetch(`${SIDECAR}/api/memory/${encodeURIComponent(filename)}`);
      const data = await res.json();
      setContent(data.content || '');
      setSelectedFile(filename);
    } catch { /* ignore */ }
  }

  async function saveFile() {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await fetch(`${SIDECAR}/api/memory/${encodeURIComponent(selectedFile)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    } catch { /* ignore */ }
    setSaving(false);
  }

  if (selectedFile) {
    return (
      <div className="bb-card bb-rise bb-stagger-10">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setSelectedFile(null)}
            className="flex items-center gap-1.5 text-[12px] font-medium transition-colors"
            style={{ color: 'var(--bb-text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bb-text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bb-text-muted)'; }}
          >
            <ArrowLeft size={12} />
            Memory Files
          </button>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono" style={{ color: 'var(--bb-text-faint)' }}>{selectedFile}</span>
            <button
              onClick={saveFile}
              disabled={saving}
              className="flex items-center gap-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
              style={{ color: 'var(--bb-accent)' }}
            >
              <Save size={12} />
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full h-44 rounded-lg p-3 text-[13px] font-mono resize-none outline-none transition-colors"
          style={{
            background: 'var(--bb-bg-elevated)',
            border: '1px solid var(--bb-border)',
            color: 'var(--bb-text)',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--bb-border-strong)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--bb-border)'; }}
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div className="bb-card bb-rise bb-stagger-10">
      <div className="bb-card-title">Memory Files</div>
      {files.length === 0 ? (
        <div className="bb-empty">No memory files</div>
      ) : (
        <div className="space-y-0.5">
          {files.map((file) => (
            <button
              key={file.path}
              onClick={() => loadFile(file.path)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors group"
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bb-bg-card-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <FileText size={14} style={{ color: 'var(--bb-text-faint)', flexShrink: 0 }} />
              <span className="text-[13px] flex-1 truncate" style={{ color: 'var(--bb-text)' }}>{file.name}</span>
              <span className="text-[11px] font-mono" style={{ color: 'var(--bb-text-faint)' }}>{formatSize(file.size)}</span>
              <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--bb-text-faint)' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
