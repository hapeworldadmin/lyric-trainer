export function ghostCumulative(times) {
  const marks = [];
  let sum = 0;
  for (const time of times || []) {
    sum += Math.max(0, Number(time) || 0);
    marks.push(sum);
  }
  return marks;
}

export function paceGap(elapsedMs, ghostMs) {
  if (ghostMs == null || !Number.isFinite(Number(ghostMs))) return null;
  return Math.round(Number(ghostMs) - Number(elapsedMs || 0));
}

export function paceLabel(gapMs) {
  if (gapMs == null || !Number.isFinite(gapMs)) return "";
  const seconds = Math.abs(gapMs) / 1000;
  const text = seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
  return gapMs >= 0 ? `Ahead ${text}` : `Behind ${text}`;
}

export function paceAt(times, ghostTimes) {
  const done = (times || []).filter((value) => value != null).length;
  if (!done || !ghostTimes?.length) return null;
  const index = Math.min(done, ghostTimes.length) - 1;
  const elapsed = (times || []).slice(0, index + 1).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return paceGap(elapsed, ghostCumulative(ghostTimes)[index]);
}
