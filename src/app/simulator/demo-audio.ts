/**
 * A short synthetic "voice note" (clearly labelled as demo, no speech) so reviewers can exercise
 * the voice-note steps without a microphone. 16 kHz mono 16-bit WAV.
 */
export function demoVoiceNote(seconds = 2.4): Blob {
  const rate = 16000;
  const n = Math.floor(rate * seconds);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // Syllable-like bursts of a soft voiced tone.
    const env = Math.max(0, Math.sin(Math.PI * ((t * 3.1) % 1))) ** 2 * Math.min(1, t * 8, (seconds - t) * 8);
    const pitch = 150 + 25 * Math.sin(t * 2.3);
    const s = 0.5 * Math.sin(2 * Math.PI * pitch * t) + 0.25 * Math.sin(4 * Math.PI * pitch * t) + 0.1 * Math.sin(6 * Math.PI * pitch * t);
    v.setInt16(44 + i * 2, Math.round(s * env * 0.35 * 32767), true);
  }
  return new Blob([buf], { type: "audio/wav" });
}
