import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { HalEye } from './hal-eye';
import { HalActivityFeed } from './hal-activity-feed';
import { useAppStore } from '../stores/app-store';

interface VoiceOverlayProps {
  onClose: () => void;
  transcript: string;
}

const STATE_LABELS: Record<string, string> = {
  connecting: 'Connecting...',
  listening: 'Listening...',
  thinking: 'Thinking...',
  tool_use: 'Working...',
  speaking: 'Speaking...',
  active: 'Processing...',
};

export function VoiceOverlay({ onClose, transcript }: VoiceOverlayProps) {
  const eyeState = useAppStore((s) => s.eyeState);

  return (
    <div className="h-screen w-full bg-black flex flex-col items-center justify-center relative overflow-hidden">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-20 w-8 h-8 rounded-lg hover:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <X size={20} />
      </button>

      {/* Activity feed — full background behind the eye */}
      <div className="absolute inset-0 z-0">
        <HalActivityFeed eyeState={eyeState} />
      </div>

      {/* Opaque backdrop — blocks feed text from showing through eye */}
      <div
        className="absolute z-[5] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
        style={{
          width: 240,
          height: 240,
          background: 'radial-gradient(circle, black 30%, transparent 70%)',
        }}
      />

      {/* Eye — foreground */}
      <div className="relative z-10 pointer-events-none">
        <HalEye eyeState={eyeState} />
      </div>

      {/* Voice transcript overlay */}
      <AnimatePresence>
        {transcript && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className="absolute z-20 bottom-32 left-1/2 max-w-md -translate-x-1/2 rounded-lg bg-white/10 px-5 py-3 text-center font-mono text-sm text-white/80 backdrop-blur-sm"
          >
            {transcript}
          </motion.div>
        )}
      </AnimatePresence>

      {/* State label */}
      <div className="absolute z-20 bottom-10 text-xs text-zinc-600 uppercase tracking-wider">
        {STATE_LABELS[eyeState] || ''}
      </div>
    </div>
  );
}
