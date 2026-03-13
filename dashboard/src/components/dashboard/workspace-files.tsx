import { useState, useEffect, useCallback } from 'react';
import { FileText, ChevronRight, Save, Plus, ArrowLeft } from 'lucide-react';

const SIDECAR = 'http://127.0.0.1:3004';

interface WorkspaceFile {
  name: string;
  exists: boolean;
  size: number;
  modified: string | null;
  description: string;
}

export function WorkspaceFilesPanel() {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`${SIDECAR}/api/workspace`);
      const data = await res.json();
      setFiles(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  async function loadFile(filename: string) {
    try {
      const res = await fetch(`${SIDECAR}/api/workspace/${encodeURIComponent(filename)}`);
      const data = await res.json();
      setContent(data.content || '');
      setSelectedFile(filename);
    } catch { /* ignore */ }
  }

  async function saveFile() {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await fetch(`${SIDECAR}/api/workspace/${encodeURIComponent(selectedFile)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      fetchFiles();
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function createFile(filename: string) {
    try {
      await fetch(`${SIDECAR}/api/workspace/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `# ${filename.replace('.md', '')}\n\n` }),
      });
      fetchFiles();
      loadFile(filename);
    } catch { /* ignore */ }
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
            Workspace Files
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
          className="w-full h-52 rounded-lg p-3 text-[13px] font-mono resize-none outline-none transition-colors"
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
      <div className="bb-card-title">Workspace Files</div>
      <p className="text-[12px] mb-3" style={{ color: 'var(--bb-text-faint)', marginTop: '-8px' }}>
        Files injected into agent context. Edit to customize behavior.
      </p>
      <div className="space-y-0.5">
        {files.map((file) => (
          <button
            key={file.name}
            onClick={() => file.exists ? loadFile(file.name) : createFile(file.name)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors group"
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bb-bg-card-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <FileText
              size={14}
              style={{ color: file.exists ? 'var(--bb-ok)' : 'var(--bb-text-faint)', flexShrink: 0 }}
            />
            <div className="flex-1 min-w-0">
              <span className="text-[13px]" style={{ color: file.exists ? 'var(--bb-text)' : 'var(--bb-text-muted)' }}>
                {file.name}
              </span>
              <span className="text-[11px] ml-2" style={{ color: 'var(--bb-text-faint)' }}>{file.description}</span>
            </div>
            {file.exists ? (
              <span className="text-[11px] font-mono" style={{ color: 'var(--bb-text-faint)' }}>{file.size}B</span>
            ) : (
              <span
                className="flex items-center gap-0.5 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: 'var(--bb-text-faint)' }}
              >
                <Plus size={10} /> Create
              </span>
            )}
            <ChevronRight
              size={12}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: 'var(--bb-text-faint)' }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
