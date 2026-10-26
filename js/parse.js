import { normalizeAnswer, wordCount } from "./text.js";

const SECTION_WORD = "(?:verse|chorus|pre-?chorus|bridge|intro|outro|hook|refrain|interlude|instrumental|breakdown|drop|spoken|ad-?libs?|part|ending|coda)";
const SECTION_RE = new RegExp(SECTION_WORD, "i");
const BARE_SECTION = new RegExp(`^${SECTION_WORD}(?:\\s+\\d+)?\\s*:?$`, "i");

const JUNK_LINE = [
  /^embed$/i,
  /^you might also like\b.*$/i,
  /^contributors?$/i,
  /^\d+\s+contributors?$/i,
  /^translations?$/i,
  /^lyrics$/i,
  /^read more$/i,
  /^(sign up|log in|submit( corrections)?)(\b.*)?$/i,
  /^see .+ live$/i,
  /^get tickets$/i,
  /^(source|album|copyright)\b.*$/i,
  /^(written|produced|composer|composers|writer|writers)\b.*$/i,
  /^https?:\/\/\S+$/i,
  /^[\[(]?\d{1,2}:\d{2}(?:[:.]\d{2})?[\])]?$/
];

function decodePaste(raw) {
  return String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\r\n?/g, "\n");
}

function stripTimestamp(line) {
  return line.replace(/^[\[(]?\d{1,2}:\d{2}(?:[:.]\d{2})?[\])]?\s+/, "").trim();
}

function stripInlineSections(line) {
  return line.replace(new RegExp(`\\[\\s*${SECTION_WORD}\\b[^\\]]*\\]`, "gi"), " ");
}

export function isSectionLine(line) {
  const text = line.trim();
  if (/^\(?\s*(?:x\s?\d+|\d+\s?x|repeat|repeats)\s*\)?$/i.test(text)) return true;
  if (/^\[[^\]]+\]$/.test(text) || /^\([^)]+\)$/.test(text)) return SECTION_RE.test(text);
  return BARE_SECTION.test(text);
}

export function isJunkLine(line) {
  const text = line.trim();
  if (!text) return true;
  if (!/[\p{L}\p{N}]/u.test(text)) return true;
  return JUNK_LINE.some((pattern) => pattern.test(text));
}

export function detectTitleArtist(line) {
  const text = String(line ?? "").trim();
  if (!text || /[.!?]$/.test(text)) return null;
  const match = text.match(/^(.{1,70}?)\s[-–—]\s(.{1,70})$/);
  if (!match) return null;
  const title = match[1].trim();
  const artist = match[2].trim();
  const titleWords = wordCount(title);
  const artistWords = wordCount(artist);
  if (titleWords < 1 || artistWords < 1 || titleWords > 8 || artistWords > 5) return null;
  if (title.length > 60 || artist.length > 60) return null;
  return { title, artist };
}

export function analyzePaste(raw, { detectTitle = true } = {}) {
  const lines = decodePaste(raw).split("\n");
  const kept = [];
  let removedJunk = 0;
  let removedBlank = 0;

  for (const original of lines) {
    const tidy = original.replace(/\t/g, " ").replace(/[ ]+/g, " ").trim();
    if (!tidy) {
      removedBlank += 1;
      continue;
    }
    if (isJunkLine(tidy) || isSectionLine(tidy)) {
      removedJunk += 1;
      continue;
    }
    const stripped = stripTimestamp(stripInlineSections(tidy).replace(/[ ]+/g, " ").trim());
    if (!stripped || isJunkLine(stripped) || isSectionLine(stripped)) {
      removedJunk += 1;
      continue;
    }
    kept.push(stripped);
  }

  let title = null;
  let artist = null;
  let detected = false;
  if (detectTitle && kept.length) {
    const hit = detectTitleArtist(kept[0]);
    if (hit) {
      title = hit.title;
      artist = hit.artist;
      detected = true;
      kept.shift();
      if (kept[0] && normalizeAnswer(kept[0]) === normalizeAnswer(artist)) kept.shift();
      if (kept[0] && normalizeAnswer(kept[0]) === normalizeAnswer(title)) kept.shift();
    }
  }

  return {
    title,
    artist,
    detected,
    lines: kept.slice(0, 400),
    removedJunk,
    removedBlank
  };
}

export function searchLyricsUrl(title, artist) {
  const query = `${String(title ?? "").trim()} ${String(artist ?? "").trim()} lyrics`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
