import { lineKey, normalizeAnswer, songKey } from "./text.js?v=16";

// 16-bit checksum of the normalized line. Used only to notice edits.
// The value is not a full hash and the line text is not stored in it.
export function lineChecksum(text) {
  const norm = normalizeAnswer(text);
  let hash = 0x811c;
  for (let index = 0; index < norm.length; index += 1) {
    hash ^= norm.charCodeAt(index);
    hash = Math.imul(hash, 0x0101) & 0xffff;
  }
  return hash & 0xffff;
}

export function checksumHex(text) {
  return lineChecksum(text).toString(16).padStart(4, "0");
}

export function lineIdentity(title, artist, sectionNumber, lineNumber, text) {
  return `${songKey(title, artist)}#${sectionNumber}.${lineNumber}.${checksumHex(text)}`;
}

const IDENTITY_RE = /^[\p{L}\p{N}| ]{1,180}#\d{1,4}\.\d{1,4}\.[0-9a-f]{4}$/u;

export function isLineIdentity(value) {
  return typeof value === "string" && IDENTITY_RE.test(value);
}

function labelAt(sections, index) {
  const label = String(sections?.[index] || "").trim();
  return label || "Part 1";
}

export function sectionSpans(lines, sections = []) {
  const list = lines || [];
  const spans = [];
  let start = 0;
  for (let index = 1; index <= list.length; index += 1) {
    if (index === list.length || labelAt(sections, index) !== labelAt(sections, start)) {
      spans.push({ start, end: index, label: labelAt(sections, start) });
      start = index;
    }
  }
  return spans;
}

function spanSignature(lines, span) {
  const body = [];
  for (let index = span.start; index < span.end; index += 1) body.push(normalizeAnswer(lines[index]));
  const base = span.label.replace(/\s+\d+$/, "").trim().toLowerCase();
  return `${base}|${body.join("\n")}`;
}

// A repeated chorus is one section. Later copies point at the first section number.
export function canonicalSections(lines, sections = []) {
  const spans = sectionSpans(lines, sections);
  const seen = new Map();
  let next = 1;
  return spans.map((span) => {
    const signature = spanSignature(lines, span);
    let sectionNumber = seen.get(signature);
    let repeat = true;
    if (!sectionNumber) {
      sectionNumber = next;
      next += 1;
      seen.set(signature, sectionNumber);
      repeat = false;
    }
    return { ...span, sectionNumber, repeat };
  });
}

export function identitiesForSong(song) {
  const lines = song?.lines || [];
  const spans = canonicalSections(lines, song?.sections || []);
  const rows = [];
  for (const span of spans) {
    const origin = spans.find((item) => item.sectionNumber === span.sectionNumber && !item.repeat) || span;
    for (let index = span.start; index < span.end; index += 1) {
      const offset = index - span.start;
      const lineNumber = offset + 1;
      const source = lines[origin.start + offset] ?? lines[index];
      rows.push({
        index,
        sectionNumber: span.sectionNumber,
        lineNumber,
        label: span.label,
        repeat: span.repeat,
        id: lineIdentity(song.title, song.artist, span.sectionNumber, lineNumber, source)
      });
    }
  }
  return rows;
}

export function editSummary(beforeSong, afterSong) {
  const before = identitiesForSong(beforeSong).filter((item) => !item.repeat);
  const after = identitiesForSong(afterSong).filter((item) => !item.repeat);
  const keptIds = [];
  const resetIds = [];
  for (let index = 0; index < after.length; index += 1) {
    if (before[index] && before[index].id === after[index].id) keptIds.push(after[index].id);
    else resetIds.push(after[index].id);
  }
  const bySection = new Map();
  for (const item of after) {
    if (!bySection.has(item.sectionNumber)) bySection.set(item.sectionNumber, []);
    bySection.get(item.sectionNumber).push(item.id);
  }
  const lostSections = [];
  for (const [number, ids] of bySection) {
    if (ids.length && ids.every((id) => !keptIds.includes(id))) lostSections.push(number);
  }
  return { kept: keptIds.length, reset: resetIds.length, keptIds, resetIds, lostSections };
}

export function remapRecallKeys(recall, oldTitle, oldArtist, newTitle, newArtist) {
  const oldPrefix = `${songKey(oldTitle, oldArtist)}#`;
  const nextPrefix = `${songKey(newTitle, newArtist)}#`;
  if (oldPrefix === nextPrefix) return recall || {};
  const next = {};
  for (const [id, stat] of Object.entries(recall || {})) {
    const key = id.startsWith(oldPrefix) ? nextPrefix + id.slice(oldPrefix.length) : id;
    next[key] = stat;
  }
  return next;
}

export function recallKeyForLine(song, index) {
  return identitiesForSong(song).find((item) => item.index === index && !item.repeat)?.id
    || identitiesForSong(song).find((item) => item.index === index)?.id
    || "";
}

export function droppedLineKeys(beforeLines, afterLines, keptIndexes) {
  const keep = new Set();
  for (const index of keptIndexes) {
    const line = afterLines[index];
    if (line) keep.add(lineKey(line));
  }
  const dropped = [];
  for (const line of beforeLines || []) {
    const key = lineKey(line);
    if (!keep.has(key)) dropped.push(key);
  }
  return dropped;
}
