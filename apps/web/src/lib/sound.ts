/** Sonidos sintetizados con Web Audio (sin archivos ni CSP extra). Silenciables; respetan el gesto del usuario. */
const KEY = 'lz_sound';
let ctx: AudioContext | undefined;

export const soundEnabled = () => {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
};
export const setSoundEnabled = (on: boolean) => {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* sin almacenamiento */ }
};

type Tone = { f: number; at: number; dur: number; gain?: number };
const SOUNDS = {
  notify: [{ f: 880, at: 0, dur: 0.14 }, { f: 1318.5, at: 0.1, dur: 0.22 }],
  post: [{ f: 523.25, at: 0, dur: 0.12 }, { f: 659.25, at: 0.09, dur: 0.12 }, { f: 783.99, at: 0.18, dur: 0.2 }],
  success: [{ f: 659.25, at: 0, dur: 0.12 }, { f: 987.77, at: 0.1, dur: 0.24 }],
} satisfies Record<string, Tone[]>;
export type SoundName = keyof typeof SOUNDS;

export function playSound(name: SoundName, force = false) {
  if (!force && !soundEnabled()) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume(); // sin gesto previo el navegador lo mantiene en silencio: no es un error
    const t0 = ctx.currentTime + 0.01;
    for (const t of SOUNDS[name] as Tone[]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = t.f;
      const peak = t.gain ?? 0.07;
      g.gain.setValueAtTime(0.0001, t0 + t.at);
      g.gain.exponentialRampToValueAtTime(peak, t0 + t.at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + t.at + t.dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + t.at);
      osc.stop(t0 + t.at + t.dur + 0.02);
    }
  } catch { /* audio no disponible */ }
}

/** Los navegadores solo permiten audio tras un gesto: se «desbloquea» en la primera interacción. */
export function unlockAudioOnGesture() {
  const unlock = () => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) { ctx ??= new AC(); void ctx.resume(); }
    } catch { /* ignorar */ }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}
