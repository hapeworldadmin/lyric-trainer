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
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
