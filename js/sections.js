import { canonicalSections } from "./identity.js?v=16";
import { normalizeAnswer } from "./text.js?v=16";

export const SECTION_PRESETS = ["Verse", "Chorus", "Pre-Chorus", "Bridge", "Intro", "Outro", "Hook", "Part"];

export function relabelBlock(sections, index, label) {
  const next = (sections || []).slice();
  if (!next.length || index < 0 || index >= next.length) return next;
  const current = next[index];
  let end = index;
  while (end + 1 < next.length && next[end + 1] === current) end += 1;
  const name = String(label || "").trim().slice(0, 40) || current;
  for (let cursor = index; cursor <= end; cursor += 1) next[cursor] = name;
  return next;
}

export function mergeWithNext(sections, index) {
  const next = (sections || []).slice();
  if (index < 0 || index >= next.length) return next;
  const current = next[index];
  let end = index;
  while (end + 1 < next.length && next[end + 1] === current) end += 1;
  if (end + 1 >= next.length) return next;
  const target = next[end + 1];
  for (let cursor = end + 1; cursor < next.length && next[cursor] === target; cursor += 1) next[cursor] = current;
  return next;
}

export function splitAtLine(sections, index) {
  const next = (sections || []).slice();
  if (index <= 0 || index >= next.length) return next;
  const label = next[index];
  const base = String(label || "Part").replace(/\s+\d+$/, "").trim() || "Part";
  const used = new Set(next);
  let number = 2;
  let fresh = `${base} ${number}`;
  while (used.has(fresh)) {
    number += 1;
    fresh = `${base} ${number}`;
  }
  for (let cursor = index; cursor < next.length && next[cursor] === label; cursor += 1) next[cursor] = fresh;
  return next;
}

function blockRepeats(lines, sections) {
  const spans = canonicalSections(lines, sections);
  return spans.some((span) => span.repeat);
}

export function completenessWarnings(lines, sections = []) {
  const hints = [];
  const list = lines || [];
  if (list.length > 0 && list.length < 8) hints.push("Fewer than 8 lines.");
  const chorusSpans = canonicalSections(list, sections).filter((span) => /^chorus\b/i.test(span.label) && !span.repeat);
  if (list.length >= 16 && !blockRepeats(list, sections) && chorusSpans.length < 2) hints.push("No repeated chorus.");
  return hints;
}

export function renameBlock(sections, index, choice) {
  const name = String(choice || "").trim();
  if (!name) return (sections || []).slice();
  if (/^verse$/i.test(name)) {
    const current = sections?.[index] || "";
    if (/^verse\s+\d+$/i.test(current)) return (sections || []).slice();
    const used = new Set(sections || []);
    let number = 1;
    while (used.has(`Verse ${number}`)) number += 1;
    return relabelBlock(sections, index, `Verse ${number}`);
  }
  return relabelBlock(sections, index, name);
}

export function splitSection(sections, index) {
  const next = (sections || []).slice();
  if (!next.length || index < 0 || index >= next.length) return next;
  const label = next[index];
  let start = index;
  while (start > 0 && next[start - 1] === label) start -= 1;
  let end = index;
  while (end + 1 < next.length && next[end + 1] === label) end += 1;
  if (end - start < 1) return next;
  const at = start + Math.ceil((end - start + 1) / 2);
  return splitAtLine(next, at);
}

export function stripLrcTimestamps(raw) {
  return String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/^(?:\[[0-9]{1,2}:[0-9]{2}(?:[.:][0-9]{1,3})?\])+\s*/, ""))
    .join("\n");
}

export function prepareImportedText(name, raw) {
  const text = String(raw ?? "");
  if (/\.lrc$/i.test(String(name || ""))) return stripLrcTimestamps(text);
  return text;
}

export function presetFor(label) {
  const base = String(label || "").replace(/\s+\d+$/, "").trim();
  const hit = SECTION_PRESETS.find((preset) => preset.toLowerCase() === base.toLowerCase());
  return hit || base || "Part";
}

export function sameLyrics(left, right) {
  const a = (left || []).map((line) => normalizeAnswer(line)).join("\n");
  const b = (right || []).map((line) => normalizeAnswer(line)).join("\n");
  return a === b;
}
