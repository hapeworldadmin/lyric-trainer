import { normalizeAnswer, wordCount } from "./text.js?v=6";

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
  /^[\[(]?\d{1,2}:\d{2}(?:[:.]\d{2})?[\])]?$/,
  /^source\s*:/i,
  /^songwriters?\b/i,
  /^writers?\s*:/i,
  /^released$/i,
  /^released\s*:/i,
  /^album$/i,
  /^album\s*:/i,
  /^listen$/i,
  /^people also search for\b/i,
  /^feedback$/i
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

const BLOCK_TAGS = new Set(["div", "p", "section", "article", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "tr", "header", "footer", "main", "pre"]);
const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "head"]);
const VOID_TAGS = new Set(["br", "hr", "img", "meta", "link", "input", "source", "wbr"]);

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(parseInt(digits, 16)));
}

function looksLikeHtml(source) {
  return /<(?:div|p|span|br|section|article|li)\b/i.test(String(source || ""));
}

function parseHtmlFragment(html) {
  const root = { name: "#root", children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([A-Za-z0-9]+)\s*>|<([A-Za-z0-9]+)([^>]*)>|([^<]+)/g;
  let match;
  while ((match = re.exec(String(html ?? "")))) {
    if (match[0].startsWith("<!--")) continue;
    if (match[1]) {
      const name = match[1].toLowerCase();
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].name === name) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    if (match[2]) {
      const name = match[2].toLowerCase();
      const node = { name, children: [], skip: SKIP_TAGS.has(name) };
      stack[stack.length - 1].children.push(node);
      const selfClosing = VOID_TAGS.has(name) || /\/\s*$/.test(match[3] || "");
      if (!selfClosing) stack.push(node);
      continue;
    }
    if (match[4]) stack[stack.length - 1].children.push({ name: "#text", text: match[4] });
  }
  return root;
}

function renderLyricNode(node) {
  if (!node || node.skip || SKIP_TAGS.has(node.name)) return "";
  if (node.name === "br") return "\n";
  if (node.name === "#text") return node.text;
  const items = [];
  let breaks = 0;
  const flushBreak = () => {
    if (breaks) items.push({ kind: "break", n: breaks });
    breaks = 0;
  };
  for (const child of node.children || []) {
    if (child.name === "br") {
      breaks += 1;
      continue;
    }
    if (child.name === "#text") {
      const text = decodeEntities(child.text).replace(/\u00a0/g, " ");
      if (!text.trim()) {
        if (/ {2,}/.test(text)) breaks = Math.max(breaks, 2);
        continue;
      }
      flushBreak();
      items.push({ kind: "text", text: text.replace(/\s+/g, " ").trim() });
      continue;
    }
    flushBreak();
    const inner = renderLyricNode(child).replace(/^\n+|\n+$/g, "");
    if (!inner.trim()) {
      items.push({ kind: "break", n: 2 });
      continue;
    }
    if (BLOCK_TAGS.has(child.name)) items.push({ kind: "block", text: inner, multi: inner.includes("\n") });
    else if (inner.trim()) items.push({ kind: "text", text: inner.replace(/\s+/g, " ").trim() });
  }
  flushBreak();
  let out = "";
  let prevMulti = false;
  for (const item of items) {
    if (item.kind === "break") {
      if (out) out = out.replace(/\n+$/, "") + (item.n >= 2 ? "\n\n" : "\n");
      prevMulti = item.n >= 2;
      continue;
    }
    const chunk = item.text.trim();
    if (!chunk) continue;
    if (!out) out = chunk;
    else if (item.kind === "block" && (item.multi || prevMulti)) out = `${out.replace(/\n+$/, "")}\n\n${chunk}`;
    else if (item.kind === "block" || out.endsWith("\n")) out = `${out.replace(/\n+$/, "")}\n${chunk}`;
    else out = `${out} ${chunk}`;
    prevMulti = item.kind === "block" && item.multi;
  }
  return out;
}

export function htmlToLyricText(html) {
  if (!looksLikeHtml(html)) return "";
  return renderLyricNode(parseHtmlFragment(html)).replace(/\n{3,}/g, "\n\n").trim();
}

function distinguishBreaks(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const bareR = (text.match(/\r(?!\n)/g) || []).length;
  const bareN = (text.match(/(?<!\r)\n/g) || []).length;
  if (crlf && bareN && crlf !== bareN) {
    if (crlf < bareN) return text.replace(/\r\n/g, "\n\n").replace(/\r/g, "\n");
    return text.replace(/(?<!\r)\n/g, "\n\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }
  if (bareR && crlf && bareR !== crlf) {
    if (crlf < bareR) return text.replace(/\r\n/g, "\n\n").replace(/\r/g, "\n");
    return text.replace(/\r(?!\n)/g, "\n\n").replace(/\r\n/g, "\n");
  }
  if (bareR && bareN && !crlf && bareR !== bareN) {
    if (bareR < bareN) return text.replace(/\r/g, "\n\n").replace(/\n/g, "\n");
    return text.replace(/\n/g, "\n\n").replace(/\r/g, "\n");
  }
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function normalizePasteBreaks(raw) {
  let text = String(raw ?? "").replace(/^\uFEFF/, "");
  text = text.replace(/\u2029/g, "\n\n");
  text = text.replace(/\u2028{2,}/g, "\n\n").replace(/\u2028/g, "\n");
  text = distinguishBreaks(text);
  return text.split("\n").map((line) => {
    if (!/ {2,}/.test(line)) return line;
    const parts = line.split(/ {2,}/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2 || parts.some((part) => wordCount(part) < 2)) return line;
    return parts.join("\n\n");
  }).join("\n");
}

function decodeMarkup(raw) {
  return String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "");
}

export function preparePastedText(raw) {
  const source = String(raw ?? "");
  if (looksLikeHtml(source)) return normalizePasteBreaks(htmlToLyricText(source));
  return normalizePasteBreaks(decodeMarkup(source));
}

export function choosePasteSource(html, plain) {
  const fromHtml = looksLikeHtml(html) ? preparePastedText(html) : "";
  const count = (value) => String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).length;
  if (count(fromHtml) >= 2) return fromHtml;
  return String(plain || fromHtml || "");
}

function isParenEcho(line) {
  return /^\([^)]*\)$/.test(String(line ?? "").trim());
}

function nearLyricKey(line) {
  if (isParenEcho(line)) return "";
  const stripped = String(line ?? "").replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  return normalizeAnswer(stripped);
}

function chunkSizes(total) {
  if (total <= 8) return [total];
  const sizes = [];
  let left = total;
  while (left > 4) {
    if (left - 4 === 1) {
      sizes.push(5);
      left = 0;
      break;
    }
    sizes.push(4);
    left -= 4;
  }
  if (left) sizes.push(left);
  return sizes;
}

function findChorusSpans(lines) {
  const keys = lines.map((line) => nearLyricKey(line));
  const compact = [];
  keys.forEach((key, index) => {
    if (key) compact.push({ index, key });
  });
  let best = null;
  const maxLen = Math.min(8, compact.length);
  for (let len = maxLen; len >= 2; len -= 1) {
    const groups = new Map();
    for (let start = 0; start + len <= compact.length; start += 1) {
      const sig = compact.slice(start, start + len).map((item) => item.key).join("\n");
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push(start);
    }
    for (const starts of groups.values()) {
      const picked = [];
      for (const start of starts) {
        const from = compact[start].index;
        const to = compact[start + len - 1].index;
        if (picked.some((span) => from <= span.end && to >= span.start)) continue;
        picked.push({ start: from, end: to });
      }
      if (picked.length < 2) continue;
      const score = len * 100 + picked.length;
      if (!best || score > best.score) best = { score, spans: picked };
    }
  }
  if (!best) return [];
  const ordered = [...best.spans].sort((a, b) => a.start - b.start);
  return ordered.map((span, index) => {
    let end = span.end;
    const next = ordered[index + 1]?.start ?? lines.length;
    while (end + 1 < next && keys[end + 1] === "") end += 1;
    return { start: span.start, end };
  });
}

function paintGaps(lines, sections, gaps) {
  const opening = gaps.find((gap) => gap.start === 0);
  const openingLength = opening ? opening.end - opening.start : 0;
  let verse = 0;
  for (const gap of gaps) {
    const length = gap.end - gap.start;
    const afterChorus = gap.start > 0 && sections[gap.start - 1] === "Chorus";
    if (afterChorus && openingLength > 0 && length < openingLength && length <= 8) {
      for (let index = gap.start; index < gap.end; index += 1) sections[index] = "Bridge";
      continue;
    }
    let offset = 0;
    for (const size of chunkSizes(length)) {
      verse += 1;
      for (let step = 0; step < size; step += 1) sections[gap.start + offset + step] = `Verse ${verse}`;
      offset += size;
    }
  }
  return sections.map((label) => label || "Part 1");
}

function labelFromChorus(lines, spans) {
  const sections = new Array(lines.length).fill("");
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (const span of sorted) {
    for (let index = span.start; index <= span.end && index < lines.length; index += 1) sections[index] = "Chorus";
  }
  const gaps = [];
  let cursor = 0;
  for (const span of sorted) {
    if (cursor < span.start) gaps.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end + 1);
  }
  if (cursor < lines.length) gaps.push({ start: cursor, end: lines.length });
  return paintGaps(lines, sections, gaps);
}

function repeatedStartIndexes(lines) {
  const keys = lines.map((line) => nearLyricKey(line));
  const breaks = new Set();
  const starts = [0];
  for (let cursor = 0; cursor < starts.length; cursor += 1) {
    const start = starts[cursor];
    const key = keys[start];
    if (!key) continue;
    for (let index = start + 2; index < lines.length; index += 1) {
      if (breaks.has(index) || keys[index] !== key || keys[index] === keys[index - 1]) continue;
      breaks.add(index);
      starts.push(index);
    }
  }
  return breaks;
}

function labelsFromBreaks(lines, breaks) {
  const sections = [];
  let part = 1;
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0 && breaks.has(index)) part += 1;
    sections.push(`Part ${part}`);
  }
  return sections;
}

function fixedPartLabels(lines) {
  const sections = [];
  chunkSizes(lines.length).forEach((size, index) => {
    for (let step = 0; step < size; step += 1) sections.push(`Part ${index + 1}`);
  });
  return sections;
}

function autoStructure(lines) {
  if (!lines.length) return [];
  const spans = findChorusSpans(lines);
  if (spans.length >= 2) return labelFromChorus(lines, spans);
  const breaks = repeatedStartIndexes(lines);
  if (breaks.size) return labelsFromBreaks(lines, breaks);
  if (lines.length > 8) return fixedPartLabels(lines);
  return lines.map(() => "Part 1");
}

function stanzaSignature(lines, range) {
  const keys = [];
  for (let index = range.start; index < range.end; index += 1) {
    const key = nearLyricKey(lines[index]);
    if (key) keys.push(key);
  }
  return keys.join("\n");
}

function labelStanzaRanges(lines, ranges) {
  const sigs = ranges.map((range) => stanzaSignature(lines, range));
  const counts = new Map();
  for (const sig of sigs) {
    if (sig.includes("\n")) counts.set(sig, (counts.get(sig) || 0) + 1);
  }
  const repeated = new Set([...counts].filter(([, count]) => count >= 2).map(([sig]) => sig));
  if (!repeated.size) {
    const sections = new Array(lines.length).fill("");
    ranges.forEach((range, index) => {
      for (let cursor = range.start; cursor < range.end; cursor += 1) sections[cursor] = `Part ${index + 1}`;
    });
    return sections.map((label) => label || "Part 1");
  }
  const sections = new Array(lines.length).fill("");
  const gaps = [];
  ranges.forEach((range, index) => {
    if (repeated.has(sigs[index])) {
      for (let cursor = range.start; cursor < range.end; cursor += 1) sections[cursor] = "Chorus";
    } else gaps.push(range);
  });
  return paintGaps(lines, sections, gaps);
}

function rangesFromBreaks(count, breakBefore) {
  const ranges = [];
  let start = 0;
  for (let index = 1; index < count; index += 1) {
    if (breakBefore[index]) {
      ranges.push({ start, end: index });
      start = index;
    }
  }
  ranges.push({ start, end: count });
  return ranges;
}

function isFlatPart(labels) {
  const names = new Set(labels);
  if (names.size > 1) return false;
  const only = [...names][0] || "";
  return only === "" || /^part\s+\d+$/i.test(only);
}

export function inferSections(lines, sections = []) {
  const list = [...(lines || [])];
  const labels = list.map((_, index) => String(sections?.[index] || "").trim());
  if (!isFlatPart(labels)) return labels;
  return autoStructure(list);
}

export function cleanPastedPage(raw, { detectTitle = true, title = "", artist = "" } = {}) {
  const block = longestLyricBlock(preparePastedText(raw));
  const parsed = analyzePaste(block, { detectTitle });
  return dropKnownHeader(parsed, title, artist);
}

export function analyzePaste(raw, { detectTitle = true } = {}) {
  const physical = preparePastedText(raw).split("\n");
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
    const texts = items.map((item) => item.text);
    const breakBefore = items.map((item) => item.breakBefore);
    const labels = breakBefore.some(Boolean)
      ? labelStanzaRanges(texts, rangesFromBreaks(texts.length, breakBefore))
      : autoStructure(texts);
    items.forEach((item, index) => {
      item.section = labels[index] || "Part 1";
    });
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
