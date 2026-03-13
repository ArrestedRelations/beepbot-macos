import { motion } from 'framer-motion';
import type { EyeState } from '../stores/app-store';

interface EyeConfig {
  outerScale: number[];
  outerOpacity: number[];
  midScale: number[];
  midOpacity: number[];
  irisScale: number[];
  irisShadow: string[];
  duration: number;
  color: string;
}

const config: Record<EyeState, EyeConfig> = {
  idle: {
    outerScale: [1, 1.02, 1],
    outerOpacity: [0.15, 0.25, 0.15],
    midScale: [1, 1.01, 1],
    midOpacity: [0.2, 0.3, 0.2],
    irisScale: [1, 1.01, 1],
    irisShadow: [
      "0 0 20px hsl(0 0% 35% / 0.3), 0 0 40px hsl(0 0% 35% / 0.15)",
      "0 0 30px hsl(0 0% 35% / 0.4), 0 0 60px hsl(0 0% 35% / 0.2)",
      "0 0 20px hsl(0 0% 35% / 0.3), 0 0 40px hsl(0 0% 35% / 0.15)",
    ],
    duration: 4,
    color: "hsl(0 0% 35%)",
  },
  connecting: {
    outerScale: [1, 1.03, 1],
    outerOpacity: [0.2, 0.4, 0.2],
    midScale: [1, 1.02, 1],
    midOpacity: [0.3, 0.5, 0.3],
    irisScale: [1, 0.98, 1],
    irisShadow: [
      "0 0 30px hsl(0 85% 45% / 0.4), 0 0 60px hsl(0 85% 45% / 0.2)",
      "0 0 40px hsl(0 85% 45% / 0.5), 0 0 80px hsl(0 85% 45% / 0.3)",
      "0 0 30px hsl(0 85% 45% / 0.4), 0 0 60px hsl(0 85% 45% / 0.2)",
    ],
    duration: 1.5,
    color: "hsl(0 85% 45%)",
  },
  listening: {
    outerScale: [1, 1.08, 1],
    outerOpacity: [0.4, 0.7, 0.4],
    midScale: [1, 1.06, 1],
    midOpacity: [0.5, 0.8, 0.5],
    irisScale: [1, 1.05, 1],
    irisShadow: [
      "0 0 50px hsl(140 80% 45% / 0.7), 0 0 100px hsl(140 80% 45% / 0.35)",
      "0 0 70px hsl(140 80% 45% / 0.9), 0 0 140px hsl(140 80% 45% / 0.5)",
      "0 0 50px hsl(140 80% 45% / 0.7), 0 0 100px hsl(140 80% 45% / 0.35)",
    ],
    duration: 1.8,
    color: "hsl(140 80% 45%)",
  },
  thinking: {
    outerScale: [1, 1.1, 1],
    outerOpacity: [0.4, 0.7, 0.4],
    midScale: [1, 1.08, 1],
    midOpacity: [0.5, 0.8, 0.5],
    irisScale: [1, 1.06, 1],
    irisShadow: [
      "0 0 50px hsl(25 95% 50% / 0.7), 0 0 100px hsl(25 95% 50% / 0.35)",
      "0 0 80px hsl(25 95% 50% / 0.9), 0 0 160px hsl(25 95% 50% / 0.5)",
      "0 0 50px hsl(25 95% 50% / 0.7), 0 0 100px hsl(25 95% 50% / 0.35)",
    ],
    duration: 1,
    color: "hsl(25 95% 50%)",
  },
  tool_use: {
    outerScale: [1, 1.1, 1],
    outerOpacity: [0.4, 0.7, 0.4],
    midScale: [1, 1.08, 1],
    midOpacity: [0.5, 0.8, 0.5],
    irisScale: [1, 1.06, 1],
    irisShadow: [
      "0 0 50px hsl(270 70% 55% / 0.7), 0 0 100px hsl(270 70% 55% / 0.35)",
      "0 0 80px hsl(270 70% 55% / 0.9), 0 0 160px hsl(270 70% 55% / 0.5)",
      "0 0 50px hsl(270 70% 55% / 0.7), 0 0 100px hsl(270 70% 55% / 0.35)",
    ],
    duration: 1.2,
    color: "hsl(270 70% 55%)",
  },
  speaking: {
    outerScale: [1, 1.12, 1],
    outerOpacity: [0.5, 0.85, 0.5],
    midScale: [1, 1.1, 1],
    midOpacity: [0.6, 0.9, 0.6],
    irisScale: [1, 1.08, 1],
    irisShadow: [
      "0 0 60px hsl(140 80% 45% / 0.8), 0 0 120px hsl(140 80% 45% / 0.4)",
      "0 0 90px hsl(140 80% 45% / 1), 0 0 180px hsl(140 80% 45% / 0.6)",
      "0 0 60px hsl(140 80% 45% / 0.8), 0 0 120px hsl(140 80% 45% / 0.4)",
    ],
    duration: 0.8,
    color: "hsl(140 80% 45%)",
  },
  active: {
    outerScale: [1, 1.1, 1],
    outerOpacity: [0.4, 0.7, 0.4],
    midScale: [1, 1.08, 1],
    midOpacity: [0.5, 0.8, 0.5],
    irisScale: [1, 1.06, 1],
    irisShadow: [
      "0 0 50px hsl(0 85% 50% / 0.7), 0 0 100px hsl(0 85% 50% / 0.35)",
      "0 0 80px hsl(0 85% 50% / 0.9), 0 0 160px hsl(0 85% 50% / 0.5)",
      "0 0 50px hsl(0 85% 50% / 0.7), 0 0 100px hsl(0 85% 50% / 0.35)",
    ],
    duration: 1.2,
    color: "hsl(0 85% 50%)",
  },
  awake: {
    outerScale: [1, 1.1, 1],
    outerOpacity: [0.4, 0.7, 0.4],
    midScale: [1, 1.08, 1],
    midOpacity: [0.5, 0.8, 0.5],
    irisScale: [1, 1.06, 1],
    irisShadow: [
      "0 0 50px hsl(140 80% 45% / 0.7), 0 0 100px hsl(140 80% 45% / 0.35)",
      "0 0 70px hsl(140 80% 45% / 0.9), 0 0 140px hsl(140 80% 45% / 0.5)",
      "0 0 50px hsl(140 80% 45% / 0.7), 0 0 100px hsl(140 80% 45% / 0.35)",
    ],
    duration: 1.5,
    color: "hsl(140 80% 45%)",
  },
};

interface HalEyeProps {
  eyeState: EyeState;
}

export function HalEye({ eyeState }: HalEyeProps) {
  const cfg = config[eyeState];

  return (
    <div className="relative flex items-center justify-center">
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 260,
          height: 260,
          background: `radial-gradient(circle, transparent 30%, ${cfg.color} 70%, transparent 100%)`,
        }}
        animate={{ scale: cfg.outerScale, opacity: cfg.outerOpacity }}
        transition={{ duration: cfg.duration, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 150,
          height: 150,
          background: `radial-gradient(circle, transparent 20%, ${cfg.color} 60%, transparent 90%)`,
        }}
        animate={{ scale: cfg.midScale, opacity: cfg.midOpacity }}
        transition={{ duration: cfg.duration * 0.8, repeat: Infinity, ease: "easeInOut", delay: cfg.duration * 0.15 }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{ width: 70, height: 70, backgroundColor: cfg.color }}
        animate={{ scale: cfg.irisScale, boxShadow: cfg.irisShadow }}
        transition={{ duration: cfg.duration * 0.7, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{ width: 20, height: 20, backgroundColor: "hsl(0 0% 100% / 0.15)" }}
        animate={{ opacity: [0.15, 0.3, 0.15], scale: [1, 1.1, 1] }}
        transition={{ duration: cfg.duration * 1.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <div
        className="absolute rounded-full blur-[1px]"
        style={{ width: 14, height: 7, backgroundColor: "hsl(0 0% 100% / 0.2)", transform: "translate(-12px, -18px)" }}
      />
    </div>
  );
}
