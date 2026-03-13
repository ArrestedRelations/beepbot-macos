import { useRef, useCallback } from 'react';
import { useAppStore } from '../stores/app-store';

export function useTts() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const setEyeState = useAppStore((s) => s.setEyeState);

  const play = useCallback((base64Mp3: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setEyeState('speaking');

    const audio = new Audio(`data:audio/mpeg;base64,${base64Mp3}`);
    audioRef.current = audio;

    audio.onended = () => {
      audioRef.current = null;
      if (useAppStore.getState().voiceMode) {
        setEyeState('listening');
      }
    };

    audio.onerror = () => {
      audioRef.current = null;
      if (useAppStore.getState().voiceMode) {
        setEyeState('listening');
      }
    };

    audio.play().catch(() => {
      audioRef.current = null;
      if (useAppStore.getState().voiceMode) {
        setEyeState('listening');
      }
    });
  }, [setEyeState]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  return { play, stop };
}
