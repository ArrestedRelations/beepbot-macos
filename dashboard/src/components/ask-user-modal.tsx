import { useState, useEffect } from 'react';
import { useAppStore } from '../stores/app-store';
import { HelpCircle, X } from 'lucide-react';

interface AskUserModalProps {
  sendRaw: (data: Record<string, unknown>) => void;
}

export function AskUserModal({ sendRaw }: AskUserModalProps) {
  const activeAskUser = useAppStore((s) => s.activeAskUser);
  const setActiveAskUser = useAppStore((s) => s.setActiveAskUser);

  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (activeAskUser) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [activeAskUser]);

  if (!activeAskUser) return null;

  function handleSelect(questionText: string, label: string, multiSelect: boolean) {
    if (multiSelect) {
      setSelections((prev) => {
        const current = prev[questionText] || [];
        const next = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        return { ...prev, [questionText]: next };
      });
    } else {
      submit({ [questionText]: label });
    }
  }

  function submit(answers?: Record<string, string>) {
    if (!activeAskUser) return;
    const finalAnswers = answers || Object.fromEntries(
      Object.entries(selections).map(([q, labels]) => [q, labels.join(', ')])
    );
    sendRaw({
      type: 'ask_user_response',
      id: activeAskUser.id,
      answers: finalAnswers,
    });
    setSelections({});
    setActiveAskUser(null);
  }

  const hasMultiSelect = activeAskUser.questions.some((q) => q.multiSelect);
  const multiSelectReady = activeAskUser.questions
    .filter((q) => q.multiSelect)
    .every((q) => (selections[q.question]?.length ?? 0) > 0);

  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center">
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={() => {
          setSelections({});
          setActiveAskUser(null);
        }}
      />

      <div className={`relative w-full max-w-lg mx-4 mb-4 rounded-2xl bg-zinc-900 border border-zinc-700/50 shadow-2xl transition-transform duration-300 ease-out ${visible ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-700/60">
              <HelpCircle className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <span className="text-sm font-medium text-zinc-200">Question</span>
          </div>
          <button
            onClick={() => {
              setSelections({});
              setActiveAskUser(null);
            }}
            className="w-6 h-6 rounded-md hover:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {activeAskUser.questions.map((q, qi) => (
            <div key={qi}>
              <p className="text-sm text-zinc-100 mb-3">{q.question}</p>
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt) => {
                  const isSelected = q.multiSelect && selections[q.question]?.includes(opt.label);
                  return (
                    <button
                      key={opt.label}
                      onClick={() => handleSelect(q.question, opt.label, q.multiSelect)}
                      className={`px-3.5 py-2 rounded-xl text-xs transition-all border ${
                        isSelected
                          ? 'bg-amber-500/25 border-amber-500/40 text-amber-200'
                          : 'bg-zinc-800/80 border-zinc-700/50 text-zinc-300 hover:bg-zinc-700/80 hover:text-zinc-100 hover:border-zinc-600/50'
                      }`}
                      title={opt.description}
                    >
                      {q.multiSelect && (
                        <span className="mr-1.5">
                          {isSelected ? '\u2611' : '\u2610'}
                        </span>
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {hasMultiSelect && (
            <button
              onClick={() => submit()}
              disabled={!multiSelectReady}
              className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors ${
                multiSelectReady
                  ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              }`}
            >
              Submit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
