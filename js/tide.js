import { wordCount } from "./text.js?v=16";

const SCALE = [0.72, 0.86, 1, 1.22, 1.38];

export function tideBudget(line, level = 0, correctStreak = 0, { slowdown = true } = {}) {
  const words = wordCount(line);
  const scale = SCALE[Math.max(0, Math.min(4, level))] || 1;
  const base = Math.min(22000, Math.max(4000, (2.2 + words * 0.55) * 1000 * scale));
  if (!slowdown) return base;
  const shrunk = base * (0.96 ** Math.max(0, correctStreak));
  return Math.max(base * 0.6, shrunk);
}

export function createTideClock(budgetMs, now) {
  return { budgetMs, started: now, pausedFor: 0, pausedAt: 0 };
}

export function pauseTide(clock, now) {
  if (!clock || clock.pausedAt) return clock;
  return { ...clock, pausedAt: now };
}

export function resumeTide(clock, now) {
  if (!clock?.pausedAt) return clock;
  return { ...clock, pausedFor: clock.pausedFor + (now - clock.pausedAt), pausedAt: 0 };
}

export function tideLeft(clock, now) {
  if (!clock) return 0;
  const frozen = clock.pausedAt ? now - clock.pausedAt : 0;
  return clock.budgetMs - (now - clock.started - clock.pausedFor - frozen);
}
