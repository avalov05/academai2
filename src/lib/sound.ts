// ── Tiny WebAudio synth: radar pings, confirms, alarms. No assets. ───────
let ctx: AudioContext | null = null;
let enabled = true;

export function setSound(on: boolean) { enabled = on; }
export function soundOn() { return enabled; }

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, glideTo?: number) {
  const c = ac(); if (!c || !enabled) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

export const sfx = {
  ping: () => tone(1180, 0.22, 'sine', 0.045, 0, 640),           // radar sweep contact
  tick: () => tone(2400, 0.03, 'square', 0.02),                   // keyboard nav
  confirm: () => { tone(520, 0.09, 'sine', 0.05); tone(780, 0.14, 'sine', 0.05, 0.07); },
  ghost: () => tone(340, 0.18, 'triangle', 0.04, 0, 480),
  alarm: () => { for (let i = 0; i < 3; i++) tone(880, 0.07, 'square', 0.05, i * 0.11, 660); },
  crash: () => tone(190, 0.5, 'sawtooth', 0.06, 0, 55),
  boot: () => { tone(420, 0.06, 'sine', 0.04); tone(630, 0.06, 'sine', 0.04, 0.08); tone(840, 0.1, 'sine', 0.045, 0.16); },
};
