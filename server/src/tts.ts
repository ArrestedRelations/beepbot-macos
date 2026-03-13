import type Database from 'better-sqlite3';
import { getProviderKey } from './crypto.js';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

export async function synthesizeSpeech(
  db: Database.Database,
  text: string
): Promise<string | null> {
  const apiKey = getProviderKey(db, 'elevenlabs');
  if (!apiKey) return null;

  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('elevenlabs_voice_id') as { value: string } | undefined;
  const voiceId = row?.value;
  if (!voiceId) return null;

  const res = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${errText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer.toString('base64');
}
