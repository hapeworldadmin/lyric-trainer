export const DAY_MS = 24 * 60 * 60 * 1000;
export const INTERVALS_MS = [10 * 60 * 1000, DAY_MS, 3 * DAY_MS, 7 * DAY_MS, 21 * DAY_MS];

const WEIGHT = [1, 1.2, 1.4, 1.7, 2];

export function blankRecall() {
  return { level: 0, due: 0, misses: 0, lastPass: 0, ladder: 0, learned: false, hardPass: 0 };
}

export function askedLevel(record, sectionFresh) {
  const level = Math.max(0, Math.min(4, Math.round(Number(record?.level) || 0)));
  return sectionFresh ? Math.min(level, 1) : level;
}

export function applyPass(record, { levelAsked = 0, now = Date.now() } = {}) {
  const row = { ...blankRecall(), ...(record || {}) };
  const asked = Math.max(0, Math.min(4, Math.round(Number(levelAsked) || 0)));
  row.level = Math.min(4, (Math.round(Number(record?.level) || 0)) + 1);
  const step = Math.min(Math.max(0, row.ladder || 0), INTERVALS_MS.length - 1);
  row.due = now + INTERVALS_MS[step];
  row.ladder = Math.min(INTERVALS_MS.length - 1, step + 1);
  if (asked >= 3) {
    if (row.hardPass && now - row.hardPass >= DAY_MS) row.learned = true;
    else if (!row.hardPass) row.hardPass = now;
  }
  row.lastPass = now;
  return row;
}

export function applyMiss(record, now = Date.now()) {
  const row = { ...blankRecall(), ...(record || {}) };
  row.level = Math.max(0, (Math.round(Number(row.level) || 0)) - 1);
  row.misses = (row.misses || 0) + 1;
  row.due = now + INTERVALS_MS[0];
  row.ladder = 0;
  return row;
}

export function recallXp({ level = 0, sung = false } = {}) {
  const weight = WEIGHT[Math.max(0, Math.min(4, level))] || 1;
  return Math.max(1, Math.round(10 * weight * (sung ? 1.25 : 1)));
}
