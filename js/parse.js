import { normalizeAnswer, wordCount } from "./text.js?v=4";

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

export function sectionName(line) {
  const text = String(line ?? "").trim();
  if (!isSectionLine(text)) return "";
  if (/^\(?\s*(?:x\s?\d+|\d+\s?x|repeat|repeats)\s*\)?$/i.test(text)) return "";
  const name = text
    .replace(/^[\[(]\s*/, "")
    .replace(/\s*[\])]$/, "")
    .replace(/:$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return name.slice(0, 40);
}

export function draftLyrics(lines, sections) {
  const out = [];
  let current = "";
  (lines || []).forEach((line, index) => {
    const section = String(sections?.[index] || "").trim();
    if (section && section !== current) {
      out.push(`[${section}]`);
      current = section;
    }
    out.push(line);
  });
  return out.join("\n");
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

function tidyLine(line) {
  return String(line ?? "").replace(/\t/g, " ").replace(/[ ]+/g, " ").trim();
}

const CHROME_LINE = [
  /^(home|menu|search|share|follow|subscribe|login|log in|sign in|sign up|register)$/i,
  /^(cookies?|privacy policy|terms( of use)?)$/i,
  /^(advertisement|advert|sponsored|promoted)$/i,
  /^related\b/i,
  /^(comments?|leave a comment)$/i,
  /^(facebook|instagram|tiktok|youtube|twitter)$/i,
  /^share on\b/i,
  /^all rights reserved\b/i,
  /^copyright\b/i,
  /^©/,
  /^(written|produced|composed) by\b/i,
  /^\d+\s+(views|likes|comments|shares)$/i,
  /^(buy|get) tickets$/i,
  /^add to (playlist|library)$/i,
  /^more (songs|from)\b/i
];

function isChromeLine(line) {
  const text = tidyLine(line);
  if (!text || isSectionLine(text)) return false;
  if (isJunkLine(text)) return true;
  if (CHROME_LINE.some((pattern) => pattern.test(text))) return true;
  if (text.length > 100 || wordCount(text) > 18) return true;
  if (wordCount(text) === 1 && text.length < 16) return true;
  return false;
}

function isLyricLike(line) {
  const text = tidyLine(line);
  if (!text || isSectionLine(text) || isChromeLine(text)) return false;
  const words = wordCount(text);
  return words >= 2 && words <= 16 && text.length <= 90;
}

export function longestLyricBlock(raw) {
  const lines = decodePaste(raw).split("\n").map(tidyLine);
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.some((line) => isLyricLike(line))) blocks.push(current);
    current = [];
  };
  for (const line of lines) {
    if (!line) {
      if (current.length) current.push("");
      continue;
    }
    if (isChromeLine(line)) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  if (!blocks.length) return "";
  const ranked = blocks.map((block) => {
    const lyric = block.filter((line) => isLyricLike(line));
    return { block, score: lyric.length * 1000 + lyric.join("").length };
  }).sort((a, b) => b.score - a.score);
  const chosen = [...ranked[0].block];
  while (chosen[0] === "") chosen.shift();
  while (chosen[chosen.length - 1] === "") chosen.pop();
  return chosen.join("\n");
}

function dropKnownHeader(parsed, title, artist) {
  if (!title || !artist) return parsed;
  const headers = new Set([
    normalizeAnswer(title),
    normalizeAnswer(artist),
    normalizeAnswer(`${title} ${artist}`),
    normalizeAnswer(`${title} - ${artist}`)
  ]);
  const lines = [...parsed.lines];
  const sections = [...parsed.sections];
  while (lines.length && headers.has(normalizeAnswer(lines[0]))) {
    lines.shift();
    sections.shift();
  }
  return { ...parsed, lines, sections };
}

export function cleanPastedPage(raw, { detectTitle = true, title = "", artist = "" } = {}) {
  const block = longestLyricBlock(raw);
  const parsed = analyzePaste(block, { detectTitle });
  return dropKnownHeader(parsed, title, artist);
}

export function analyzePaste(raw, { detectTitle = true } = {}) {
  const physical = decodePaste(raw).split("\n");
  let sawTag = false;
  for (const original of physical) {
    const tidy = tidyLine(original);
    if (!tidy || isJunkLine(tidy)) continue;
    if (isSectionLine(tidy) && sectionName(tidy)) {
      sawTag = true;
      break;
    }
    const stripped = stripTimestamp(stripInlineSections(tidy).replace(/[ ]+/g, " ").trim());
    if (stripped && isSectionLine(stripped) && sectionName(stripped)) {
      sawTag = true;
      break;
    }
  }

  const items = [];
  let section = "";
  let removedJunk = 0;
  let removedBlank = 0;
  let pendingBreak = false;

  for (const original of physical) {
    const tidy = tidyLine(original);
    if (!tidy) {
      removedBlank += 1;
      if (items.length) pendingBreak = true;
      continue;
    }
    if (isSectionLine(tidy)) {
      const name = sectionName(tidy);
      if (name) section = name;
      removedJunk += 1;
      continue;
    }
    if (isJunkLine(tidy)) {
      removedJunk += 1;
      continue;
    }
    const stripped = stripTimestamp(stripInlineSections(tidy).replace(/[ ]+/g, " ").trim());
    if (!stripped || isJunkLine(stripped) || isSectionLine(stripped)) {
      const name = sectionName(stripped);
      if (name) section = name;
      removedJunk += 1;
      continue;
    }
    items.push({
      text: stripped,
      section: sawTag ? section : "",
      breakBefore: !sawTag && pendingBreak
    });
    pendingBreak = false;
  }

  let title = null;
  let artist = null;
  let detected = false;
  if (detectTitle && items.length) {
    const hit = detectTitleArtist(items[0].text);
    if (hit) {
      title = hit.title;
      artist = hit.artist;
      detected = true;
      items.shift();
      if (items[0] && normalizeAnswer(items[0].text) === normalizeAnswer(artist)) items.shift();
      if (items[0] && normalizeAnswer(items[0].text) === normalizeAnswer(title)) items.shift();
    }
  }

  if (!sawTag) {
    let part = 0;
    let open = false;
    for (const item of items) {
      if (!open || item.breakBefore) {
        part += 1;
        open = true;
      }
      item.section = `Part ${part}`;
    }
  }

  return {
    title,
    artist,
    detected,
    lines: items.map((item) => item.text).slice(0, 400),
    sections: items.map((item) => item.section).slice(0, 400),
    removedJunk,
    removedBlank
  };
}

export function searchLyricsUrl(title, artist) {
  const query = `${String(title ?? "").trim()} ${String(artist ?? "").trim()} lyrics`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
