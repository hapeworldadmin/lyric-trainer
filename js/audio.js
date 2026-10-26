let context;

export function blip(kind, enabled) {
  if (!enabled || typeof window === "undefined") return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    context ||= new AudioCtx();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.type = "sine";
    oscillator.frequency.value = kind === "ok" ? 620 : 196;
    gain.gain.value = 0.035;
    const now = context.currentTime;
    oscillator.frequency.exponentialRampToValueAtTime(kind === "ok" ? 880 : 120, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  } catch {
    // Audio is optional.
  }
}
