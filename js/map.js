import { canonicalSections, identitiesForSong } from "./identity.js?v=16";
import { askedLevel } from "./memory.js?v=16";
import { tideBudget } from "./tide.js?v=16";

const MINUTE = 60 * 1000;

function uniqueRows(song) {
  return identitiesForSong(song).filter((row) => !row.repeat);
}

export function dueRows(song, recall, now = Date.now()) {
  return uniqueRows(song).filter((row) => {
    const record = recall?.[row.id];
    return record && record.due > 0 && record.due <= now;
  });
}

export function songMap(song, recall = {}, sections = {}, now = Date.now()) {
  const rows = uniqueRows(song);
  const numbers = [...new Set(rows.map((row) => row.sectionNumber))];
  return numbers.map((sectionNumber) => {
    const lines = rows.filter((row) => row.sectionNumber === sectionNumber);
    const records = lines.map((row) => recall?.[row.id]).filter(Boolean);
    const average = lines.length
      ? records.reduce((sum, record) => sum + (record.level || 0), 0) / lines.length
      : 0;
    const due = lines.filter((row) => {
      const record = recall?.[row.id];
      return record && record.due > 0 && record.due <= now;
    }).length;
    const learned = lines.length > 0 && lines.every((row) => recall?.[row.id]?.learned);
    const seen = records.some((record) => record.lastPass || record.misses);
    const slot = sections?.[String(sectionNumber)] || {};
    let state = "New";
    if (learned || slot.learned) state = "Learned";
    else if (slot.boss) state = "Boss cleared";
    else if (seen || slot.runs || slot.warmed) state = "Learning";
    return {
      sectionNumber,
      label: lines[0]?.label || `Section ${sectionNumber}`,
      state,
      average: Math.round(average * 10) / 10,
      due,
      learned: state === "Learned",
      boss: Boolean(slot.boss),
      runs: slot.runs || 0,
      warmed: Boolean(slot.warmed),
      seen,
      lineCount: lines.length
    };
  });
}

export function nextAction(blocks, dueCount = 0) {
  if (dueCount > 0) return { kind: "daily", label: "Daily review", due: dueCount };
  const next = (blocks || []).find((block) => block.state === "New" || block.state === "Learning");
  if (!next) return { kind: "full", label: "Full run" };
  if (next.state === "New") return { kind: "warmup", section: next.sectionNumber, label: "Warm-up" };
  if (!next.runs) return { kind: "run", section: next.sectionNumber, label: "Run" };
  return { kind: "boss", section: next.sectionNumber, label: "Boss" };
}

export function actionHref(songId, action) {
  const id = encodeURIComponent(songId);
  if (!action) return `#/song/${id}`;
  if (action.kind === "daily") return `#/play/${id}/daily`;
  if (action.kind === "full") return `#/play/${id}/full`;
  return `#/play/${id}/${action.kind}?section=${action.section || 1}`;
}

export function linesForSection(song, sectionNumber) {
  return uniqueRows(song).filter((row) => row.sectionNumber === sectionNumber);
}

function weakness(record) {
  return (record?.level || 0) * 100 - (record?.misses || 0);
}

export function dailySteps(song, recall, now = Date.now()) {
  const due = dueRows(song, recall, now);
  const bySection = new Map();
  for (const row of due) {
    if (!bySection.has(row.sectionNumber)) bySection.set(row.sectionNumber, []);
    bySection.get(row.sectionNumber).push(row);
  }
  const groups = [...bySection.values()].map((group) => group.sort((a, b) => weakness(recall[a.id]) - weakness(recall[b.id])));
  groups.sort((a, b) => weakness(recall[a[0].id]) - weakness(recall[b[0].id]));
  const ordered = groups.flat();
  const steps = [];
  let budget = 0;
  let lastSection = 0;
  for (const row of ordered) {
    const level = recall?.[row.id]?.level || 0;
    const cost = tideBudget(song.lines[row.index], level, 0);
    if (steps.length && budget + cost > 5 * MINUTE) break;
    steps.push({
      index: row.index,
      identity: row.id,
      level,
      sectionNumber: row.sectionNumber,
      sectionStart: row.sectionNumber !== lastSection
    });
    lastSection = row.sectionNumber;
    budget += cost;
    if (budget >= 3 * MINUTE) break;
  }
  return steps;
}

export function bossSteps(song, sectionNumber, recall = {}) {
  return linesForSection(song, sectionNumber).map((row) => ({
    index: row.index,
    identity: row.id,
    level: Math.max(3, Math.min(4, recall?.[row.id]?.level || 3)),
    sectionNumber,
    sectionStart: row.lineNumber === 1
  }));
}

export function fullSteps(song, recall = {}) {
  const spans = canonicalSections(song?.lines || [], song?.sections || []);
  const steps = [];
  for (const span of spans) {
    const origin = spans.find((item) => item.sectionNumber === span.sectionNumber && !item.repeat) || span;
    for (let index = span.start; index < span.end; index += 1) {
      const offset = index - span.start;
      const source = origin.start + offset;
      const ident = identitiesForSong(song).find((row) => row.index === source && !row.repeat);
      const record = ident ? recall?.[ident.id] : null;
      steps.push({
        index,
        identity: ident?.id || "",
        level: offset === 0 ? 4 : askedLevel(record, false),
        sectionNumber: span.sectionNumber,
        sectionStart: offset === 0,
        coldOpen: offset === 0
      });
    }
  }
  return steps;
}

export function sectionLearned(song, sectionNumber, recall = {}) {
  const lines = linesForSection(song, sectionNumber);
  return lines.length > 0 && lines.every((row) => recall?.[row.id]?.learned);
}
