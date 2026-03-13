import { useRef, useCallback, useState } from 'react';
import { useAppStore } from '../stores/app-store';

const SERVER_WS = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION_MS = 1500;

interface UseSpeechOptions {
  onResult: (text: string) => void;
  onInterim?: (text: string) => void;
}

// Check for native Web Speech API (Chrome, Safari, Edge)
const SpeechRecognition = (window as unknown as Record<string, unknown>).SpeechRecognition ??
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

interface RecordingState {
  mediaRecorder: MediaRecorder;
  analyser: AnalyserNode;
  audioCtx: AudioContext;
  stream: MediaStream;
  ws: WebSocket;
  silenceTimer: ReturnType<typeof setTimeout> | null;
  hasSound: boolean;
  recognition: unknown | null;
  nativeTranscript: string;
}

export function useSpeech({ onResult, onInterim }: UseSpeechOptions) {
  const [isListening, setIsListening] = useState(false);
  const stateRef = useRef<RecordingState | null>(null);
  const setEyeState = useAppStore((s) => s.setEyeState);

  const stop = useCallback(() => {
    const s = stateRef.current;
    if (s) {
      if (s.silenceTimer) clearTimeout(s.silenceTimer);
      try { s.mediaRecorder.stop(); } catch { /* already stopped */ }
      s.stream.getTracks().forEach(t => t.stop());
      s.audioCtx.close();
      try { s.ws.close(); } catch { /* already closed */ }
      if (s.recognition) {
        try { (s.recognition as { stop: () => void }).stop(); } catch { /* already stopped */ }
      }
      stateRef.current = null;
    }
    setIsListening(false);
  }, []);

  const start = useCallback(async () => {
    stop();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const ws = new WebSocket(SERVER_WS);

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('WS connect failed'));
        setTimeout(() => reject(new Error('WS timeout')), 5000);
      });

      // Set up native Web Speech API if available
      let recognition: unknown = null;
      if (SpeechRecognition) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rec = new (SpeechRecognition as any)() as any;
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onresult = (event: any) => {
          const s = stateRef.current;
          if (!s) return;

          let interim = '';
          let final = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              final += transcript;
            } else {
              interim += transcript;
            }
          }

          if (final) {
            s.nativeTranscript = (s.nativeTranscript + ' ' + final).trim();
          }
          if (interim) {
            onInterim?.(interim);
          }
        };

        rec.onerror = () => { /* fall through to server-side STT */ };
        rec.onend = () => {
          // Restart if still in voice mode
          const s = stateRef.current;
          if (s && useAppStore.getState().voiceMode) {
            try { rec.start(); } catch { /* already started */ }
          }
        };

        try {
          rec.start();
        } catch { /* not supported */ }
        recognition = rec;
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const s = stateRef.current;
        if (chunks.length === 0 || !s?.hasSound) {
          chunks.length = 0;
          if (useAppStore.getState().voiceMode && s) {
            setEyeState('listening');
            onInterim?.('');
            try { mediaRecorder.start(); } catch { /* stream ended */ }
          }
          return;
        }

        // Check if native Web Speech API got a transcript
        if (s.nativeTranscript.trim()) {
          const text = s.nativeTranscript.trim();
          s.nativeTranscript = '';
          chunks.length = 0;
          onInterim?.('');
          onResult(text);
          if (useAppStore.getState().voiceMode && stateRef.current) {
            setEyeState('listening');
            stateRef.current.hasSound = false;
            try { mediaRecorder.start(); } catch { /* stream ended */ }
            startSilenceDetection();
          }
          return;
        }

        // Fallback: send to server for ElevenLabs STT
        onInterim?.('Transcribing...');
        setEyeState('thinking');

        const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
        chunks.length = 0;

        const arrayBuf = await blob.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuf).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stt_audio', data: base64 }));
        }

        const origOnMessage = ws.onmessage;
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'stt_result') {
              onInterim?.('');
              if (msg.data) onResult(msg.data);
              ws.onmessage = origOnMessage;
              if (useAppStore.getState().voiceMode && stateRef.current) {
                setEyeState('listening');
                stateRef.current.hasSound = false;
                stateRef.current.nativeTranscript = '';
                try { mediaRecorder.start(); } catch { /* stream ended */ }
                startSilenceDetection();
              }
            } else if (msg.type === 'stt_error') {
              console.warn('STT error:', msg.data);
              onInterim?.('');
              ws.onmessage = origOnMessage;
              if (useAppStore.getState().voiceMode && stateRef.current) {
                setEyeState('listening');
                stateRef.current.hasSound = false;
                stateRef.current.nativeTranscript = '';
                try { mediaRecorder.start(); } catch { /* stream ended */ }
                startSilenceDetection();
              }
            }
          } catch { /* ignore */ }
        };
      };

      const state: RecordingState = {
        mediaRecorder,
        analyser,
        audioCtx,
        stream,
        ws,
        silenceTimer: null,
        hasSound: false,
        recognition,
        nativeTranscript: '',
      };
      stateRef.current = state;

      const dataArray = new Float32Array(analyser.frequencyBinCount);

      function startSilenceDetection() {
        const s = stateRef.current;
        if (!s) return;

        function checkLevel() {
          const s = stateRef.current;
          if (!s || s.mediaRecorder.state !== 'recording') return;

          s.analyser.getFloatTimeDomainData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
          }
          const rms = Math.sqrt(sum / dataArray.length);

          if (rms > SILENCE_THRESHOLD) {
            s.hasSound = true;
            if (s.silenceTimer) {
              clearTimeout(s.silenceTimer);
              s.silenceTimer = null;
            }
          } else if (s.hasSound && !s.silenceTimer) {
            s.silenceTimer = setTimeout(() => {
              if (s.mediaRecorder.state === 'recording') {
                s.mediaRecorder.stop();
              }
            }, SILENCE_DURATION_MS);
          }

          requestAnimationFrame(checkLevel);
        }

        requestAnimationFrame(checkLevel);
      }

      mediaRecorder.start();
      setIsListening(true);
      setEyeState('listening');
      startSilenceDetection();

    } catch (err) {
      console.error('Microphone access failed:', err);
      setEyeState('idle');
    }
  }, [stop, onResult, onInterim, setEyeState]);

  return { isListening, start, stop };
}
