import { Platform } from 'react-native';

let audio: AudioContext | undefined;
let muted = false;
export function muteCopySound(value: boolean) { muted = value; }
async function prepare() {
  if (muted || Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio ??= new Constructor();
    await audio.resume();
    return audio.state === 'running' ? audio : null;
  } catch { return null; }
}
export async function copyWithSound(value: string, write: (value: string) => Promise<unknown>) {
  // Unlock audio during the tap, before waiting for the clipboard promise.
  const ready = prepare();
  const copied = await write(value);
  if (copied === false) throw new Error('Could not copy. Please try again.');
  const context = await ready;
  if (!context || muted) return;
  try {
    const tone = context.createOscillator(), gain = context.createGain();
    tone.connect(gain); gain.connect(context.destination);
    tone.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
    tone.start(); tone.stop(context.currentTime + 0.14);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
  } catch { /* Clipboard success must not depend on audio support. */ }
}
