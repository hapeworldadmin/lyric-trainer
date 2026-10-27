import { normalizeSing } from "./text.js?v=11";

const VOICE_COVERAGE = 0.6;
const VOICE_SIMILARITY = 0.8;
const NUMBER_WORDS = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
  "10": "ten",
  "11": "eleven",
  "12": "twelve",
  "13": "thirteen",
  "14": "fourteen",
  "15": "fifteen",
  "16": "sixteen",
  "17": "seventeen",
  "18": "eighteen",
  "19": "nineteen",
  "20": "twenty"
};

export function hintWords(...parts) {
  const seen = new Set();
  const words = [];
  for (const part of parts) {
    const text = Array.isArray(part) ? part.join("\n") : String(part ?? "");
    for (const token of text.match(/[\p{L}\p{N}']+/gu) || []) {
      const clean = token.replace(/^'+|'+$/g, "").toLowerCase();
      if (clean.length < 2 || seen.has(clean)) continue;
      seen.add(clean);
      words.push(clean);
      if (words.length >= 80) return words;
    }
  }
  return words;
}

export function voiceMatch(expected, given, vocabulary = []) {
  return interpretHearing(expected, [given], vocabulary).pass;
}

export function interpretHearing(expected, hypotheses, vocabulary = []) {
  const options = [];
  const seen = new Set();
  for (const item of hypotheses || []) {
    const text = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    options.push(text);
  }
  if (!options.length) return { raw: "", display: "", pass: false, coverage: 0, similarity: 0 };
  if (!normalizeSing(expected)) {
    return { raw: options[0], display: options[0], pass: false, coverage: 0, similarity: 0 };
  }
  let best = null;
  for (const raw of options) {
    const scored = scoreHearing(expected, raw, vocabulary);
    if (!best || scored.rank > best.rank) best = { raw, ...scored };
  }
  return best;
}

function scoreHearing(expected, raw, vocabulary) {
  const surfaces = lyricSurfaces(expected);
  const expectedWords = normalizeSing(expected).split(" ").filter(Boolean);
  const heardWords = normalizeVoice(raw).split(" ").filter(Boolean);
  const vocab = lyricSurfaces(Array.isArray(vocabulary) ? vocabulary.join("\n") : vocabulary);
  const snapped = snapWords(heardWords, surfaces, vocab);
  const snappedWords = snapped.flatMap((word) => normalizeSing(word).split(" ").filter(Boolean));
  const coverage = inOrderCoverage(expectedWords, snappedWords);
  const similarity = Math.max(
    charSimilarity(normalizeSing(expected), normalizeVoice(raw)),
    charSimilarity(flatten(expected), flatten(raw))
  );
  const display = snapped.join(" ");
  const pass = expectedWords.length > 0 && (coverage + 1e-9 >= VOICE_COVERAGE || similarity + 1e-9 >= VOICE_SIMILARITY);
  return { display, pass, coverage, similarity, rank: coverage + similarity * 0.01 };
}

function normalizeVoice(value) {
  return normalizeSing(value).split(" ").map((word) => NUMBER_WORDS[word] || word).filter(Boolean).join(" ");
}

function flatten(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b\u2032`´']/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lyricSurfaces(text) {
  const tokens = String(text ?? "").match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
  return tokens.map((surface) => {
    const normalized = normalizeSing(surface);
    return { surface, flat: flatten(surface), parts: normalized.split(" ").filter(Boolean) };
  });
}

function snapWords(heardWords, surfaces, vocab) {
  const used = new Set();
  const snapped = [];
  for (let index = 0; index < heardWords.length; index += 1) {
    const multi = matchPhrase(heardWords, index, surfaces, used);
    if (multi) {
      snapped.push(multi.surface);
      used.add(multi.index);
      index += multi.consumed - 1;
      continue;
    }
    const word = heardWords[index];
    const lineHit = snapToken(word, surfaces, used);
    if (lineHit) snapped.push(lineHit);
    else snapped.push(snapToken(word, vocab, new Set()) || word);
  }
  return snapped;
}

function matchPhrase(heardWords, start, surfaces, used) {
  for (let index = 0; index < surfaces.length; index += 1) {
    if (used.has(index)) continue;
    const parts = surfaces[index].parts;
    if (parts.length < 2 || start + parts.length > heardWords.length) continue;
    const slice = heardWords.slice(start, start + parts.length);
    if (slice.every((word, offset) => wordsClose(NUMBER_WORDS[word] || word, parts[offset]))) {
      return { surface: surfaces[index].surface, index, consumed: parts.length };
    }
  }
  return null;
}

function snapToken(word, surfaces, used) {
  const folded = NUMBER_WORDS[word] || word;
  for (let index = 0; index < surfaces.length; index += 1) {
    if (used.has(index)) continue;
    const item = surfaces[index];
    if (item.flat === folded || item.flat === word || (item.parts.length === 1 && item.parts[0] === folded)) {
      used.add(index);
      return item.surface;
    }
  }
  let bestIndex = -1;
  let bestDist = Infinity;
  for (let index = 0; index < surfaces.length; index += 1) {
    if (used.has(index)) continue;
    const item = surfaces[index];
    const candidates = [...new Set([item.flat, ...item.parts].filter(Boolean))];
    for (const candidate of candidates) {
      if (!wordsClose(folded, candidate)) continue;
      const dist = editDistance(folded, candidate);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = index;
      }
    }
  }
  if (bestIndex < 0) return "";
  used.add(bestIndex);
  return surfaces[bestIndex].surface;
}

function inOrderCoverage(expectedWords, heardWords) {
  if (!expectedWords.length || !heardWords.length) return 0;
  let cursor = 0;
  let matched = 0;
  for (const word of heardWords) {
    for (let index = cursor; index < expectedWords.length; index += 1) {
      if (!wordsClose(word, expectedWords[index])) continue;
      matched += 1;
      cursor = index + 1;
      break;
    }
  }
  return matched / expectedWords.length;
}

function wordsClose(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const left = NUMBER_WORDS[a] || a;
  const right = NUMBER_WORDS[b] || b;
  if (left === right) return true;
  const min = Math.min(left.length, right.length);
  const max = Math.max(left.length, right.length);
  if (min <= 2) return false;
  const dist = editDistance(left, right);
  if (max <= 5 && dist <= 1) return true;
  if (dist <= 2 && dist / max <= 0.34) return true;
  const pa = phoneticKey(left);
  const pb = phoneticKey(right);
  return pa.length >= 2 && pa === pb;
}

function phoneticKey(word) {
  let text = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!text) return "";
  text = text.replace(/^kn/, "n").replace(/^wr/, "r").replace(/^ph/, "f").replace(/^th/, "d").replace(/th/g, "t");
  const rest = text.slice(1).replace(/[aeiouy]/g, "");
  return (text[0] + rest).replace(/(.)\1+/g, "$1");
}

function charSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = editDistance(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

function editDistance(a, b) {
  if (a === b) return 0;
  const left = String(a);
  const right = String(b);
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const row = new Array(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) row[j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const temp = row[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return row[right.length];
}
