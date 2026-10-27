export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

export function clip(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizeAnswer(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b\u2032`´]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u00ab\u00bb]/g, '"')
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Singing and typing cannot carry punctuation. Apostrophes, curly quotes, and
// commas are removed, and contractions that are not real words collapse so
// "you're", "youre", and "you are" are the same line.
const GLUED_CONTRACTIONS = [
  [/\byoure\b/g, "you are"],
  [/\btheyre\b/g, "they are"],
  [/\bim\b/g, "i am"],
  [/\bdont\b/g, "do not"],
  [/\bdoesnt\b/g, "does not"],
  [/\bdidnt\b/g, "did not"],
  [/\bcant\b/g, "cannot"],
  [/\bwont\b/g, "will not"],
  [/\bisnt\b/g, "is not"],
  [/\barent\b/g, "are not"],
  [/\bwasnt\b/g, "was not"],
  [/\bwerent\b/g, "were not"],
  [/\bcouldnt\b/g, "could not"],
  [/\bshouldnt\b/g, "should not"],
  [/\bwouldnt\b/g, "would not"],
  [/\bhasnt\b/g, "has not"],
  [/\bhavent\b/g, "have not"],
  [/\bhadnt\b/g, "had not"],
  [/\bive\b/g, "i have"],
  [/\byouve\b/g, "you have"],
  [/\bweve\b/g, "we have"],
  [/\btheyve\b/g, "they have"],
  [/\byoull\b/g, "you will"],
  [/\btheyll\b/g, "they will"],
  [/\bgonna\b/g, "going to"],
  [/\bwanna\b/g, "want to"],
  [/\bgotta\b/g, "got to"]
];

export function normalizeSing(value) {
  let text = String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b\u2032`´]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u00ab\u00bb]/g, " ");
  // Drop apostrophes instead of turning them into spaces, so "you're" and
  // "youre" collapse before contraction expansion.
  text = text.replace(/'/g, "");
  text = text.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of GLUED_CONTRACTIONS) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, " ").trim();
}

export function contentKey(parts) {
  const text = (parts || []).map((part) => normalizeAnswer(part)).join("|");
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function songKey(title, artist) {
  return `${normalizeAnswer(title)}|${normalizeAnswer(artist)}`;
}

// Identity for linking a pasted song to a setlist slot. Case, punctuation, and
// a parenthetical tag are ignored, so "ILYSB" matches "ILYSB (Stripped)" and
// "Cause You Have To" matches "'Cause You Have To". Extra words still count,
// so "Good" does not match "Good Girls".
export function normalizeTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function songsMatch(titleA, artistA, titleB, artistB) {
  const title = normalizeTitle(titleA);
  const artist = normalizeTitle(artistA);
  return Boolean(title && artist)
    && title === normalizeTitle(titleB)
    && artist === normalizeTitle(artistB);
}

export function lineKey(line) {
  const text = normalizeAnswer(line);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function wordCount(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

export function slug(value) {
  const text = normalizeAnswer(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return text.slice(0, 80) || "concert";
}

export function safeConcertId(id) {
  const value = String(id ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(value)) {
    throw new Error("Concert id is not usable.");
  }
  return value;
}

export function tokenize(line) {
  return String(line ?? "").trim().split(/\s+/).filter(Boolean);
}

export function displayToken(token) {
  const cleaned = String(token ?? "").replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
  return cleaned || String(token ?? "");
}

export function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftDateKey(key, days) {
  const [year, month, day] = String(key).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return todayKey(date);
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function shuffle(items, rng = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
