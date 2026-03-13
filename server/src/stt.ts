import type Database from 'better-sqlite3';
import { getProviderKey } from './crypto.js';

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

export async function transcribeAudio(
  db: Database.Database,
  audioBase64: string
): Promise<string | null> {
  const apiKey = getProviderKey(db, 'elevenlabs');
  if (!apiKey) return null;

  const audioBuffer = Buffer.from(audioBase64, 'base64');

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm');
  form.append('model_id', 'scribe_v2');
  form.append('language_code', 'en');
  form.append('tag_audio_events', 'false');

  const res = await fetch(ELEVENLABS_STT_URL, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs STT ${res.status}: ${errText}`);
  }

  const data = await res.json() as { text?: string };
  return data.text?.trim() || null;
}
