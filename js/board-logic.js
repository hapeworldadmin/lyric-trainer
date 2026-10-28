import { songKey } from "./text.js";

export const BOARD_LIMITS = {
  nameMin: 2,
  nameMax: 16,
  maxSongScore: 2000000,
  maxSongXp: 1000000,
  maxSongs: 80,
  top: 20,
  postPerDevice: 30,
  postPerIp: 120,
  getPerDevice: 300,
  getPerIp: 600,
  windowMs: 60 * 60 * 1000,
  maxPlayers: 1000,
  codeLength: 6,
  codeTtlMs: 10 * 60 * 1000,
  codeWindowMs: 5 * 60 * 1000,
  linkPerDevice: 6,
  linkPerIp: 12,
  joinPerDevice: 5,
  joinPerIp: 10,
  maxDevices: 6,
  maxRounds: 40,
  maxLines: 80
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CHAPTER_IDS = ["fade", "think", "lines", "next", "concert"];
const ROUND_ID = /^[a-z0-9]{1,24}(?:-[a-z0-9]{1,24}){0,2}$/;
const LINE_ID = /^[a-z0-9]{1,16}$/;

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCKED_PARTS = ["fuck", "shit", "bitch", "asshole", "bastard", "nigger", "nigga", "faggot", "slut", "whore"];
const BLOCKED_WORDS = ["cunt", "fag", "rape"];

export function validDeviceId(value) {
  return typeof value === "string" && DEVICE_ID.test(value);
}

export function clampInt(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(max, Math.round(number)));
}

export function cleanLabel(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function normalizeBoardName(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function smashedName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/[@]/g, "a")
    .replace(/\$/g, "s")
    .replace(/[^a-z]/g, "");
}

export function nameHasProfanity(value) {
  const flat = smashedName(value);
  if (!flat) return false;
  if (BLOCKED_PARTS.some((word) => flat.includes(word))) return true;
  const tokens = String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .split(/[^a-z]+/)
    .filter(Boolean);
  return BLOCKED_WORDS.some((word) => tokens.includes(word) || flat === word);
}

export function validateBoardName(value) {
  const name = normalizeBoardName(value);
  const length = [...name].length;
  if (length < BOARD_LIMITS.nameMin || length > BOARD_LIMITS.nameMax) {
    return { ok: false, error: "Use 2 to 16 characters." };
  }
  if (!/^[\p{L}\p{N}](?:[\p{L}\p{N}' -]*[\p{L}\p{N}])?$/u.test(name) || /[' -]{2,}/.test(name)) {
    return { ok: false, error: "Use letters and numbers." };
  }
  if (nameHasProfanity(name)) return { ok: false, error: "Choose a different name." };
  return { ok: true, name };
}

export function snapshotFromProgress(progress) {
  const byId = new Map();
  for (const row of Object.values(progress?.songs || {})) {
    if (!row || typeof row !== "object") continue;
    const title = cleanLabel(row.title, 80);
    const artist = cleanLabel(row.artist, 80);
    if (!title || !artist) continue;
    const score = clampInt(row.bestScore, BOARD_LIMITS.maxSongScore);
    const xp = clampInt(row.xp, BOARD_LIMITS.maxSongXp);
    if (score <= 0 && xp <= 0) continue;
    const id = songKey(title, artist);
    const prev = byId.get(id);
    if (!prev || score > prev.score || (score === prev.score && xp > prev.xp)) {
      byId.set(id, { id, title, artist, score, xp });
    }
  }
  const songs = [...byId.values()]
    .sort((a, b) => b.score - a.score || b.xp - a.xp || a.title.localeCompare(b.title))
    .slice(0, BOARD_LIMITS.maxSongs);
  return {
    songs,
    overallScore: songs.reduce((sum, song) => sum + song.score, 0),
    overallXp: songs.reduce((sum, song) => sum + song.xp, 0)
  };
}

export function buildSubmission(progress, profile, library = []) {
  const snapshot = snapshotFromProgress(progress);
  return {
    deviceId: profile?.deviceId || "",
    playerId: profile?.playerId || profile?.deviceId || "",
    name: profile?.name || "",
    overallScore: snapshot.overallScore,
    overallXp: snapshot.overallXp,
    songs: snapshot.songs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      score: song.score,
      xp: song.xp
    })),
    progress: progressSnapshot(progress),
    library: libraryFromSongs(library)
  };
}

export function libraryFromSongs(songs) {
  const rows = [];
  for (const song of (songs || []).slice(0, BOARD_LIMITS.maxSongs)) {
    const title = cleanLabel(song?.title, 120);
    const artist = cleanLabel(song?.artist, 120);
    if (!title || !artist) continue;
    rows.push({ title, artist });
  }
  return rows;
}

export function progressSnapshot(progress) {
  const songs = {};
  for (const row of Object.values(progress?.songs || {})) {
    if (!row || typeof row !== "object") continue;
    const title = cleanLabel(row.title, 80);
    const artist = cleanLabel(row.artist, 80);
    if (!title || !artist) continue;
    songs[songKey(title, artist)] = {
      title,
      artist,
      rounds: row.rounds,
      chapters: row.chapters,
      lineStats: row.lineStats
    };
  }
  return sanitizeProgress({
    totalXp: progress?.totalXp || 0,
    streak: progress?.streak || null,
    songs
  });
}

export function sanitizeSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "That score could not be read." };
  }
  const name = validateBoardName(body.name);
  if (!name.ok) return name;
  if (!validDeviceId(body.deviceId)) return { ok: false, error: "That device is not valid." };
  const incoming = Array.isArray(body.songs) ? body.songs.slice(0, BOARD_LIMITS.maxSongs) : [];
  const byId = new Map();
  for (const row of incoming) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const title = cleanLabel(row.title, 80);
    const artist = cleanLabel(row.artist, 80);
    if (!title || !artist) continue;
    const score = clampInt(row.score, BOARD_LIMITS.maxSongScore);
    const xp = clampInt(row.xp, BOARD_LIMITS.maxSongXp);
    if (score <= 0 && xp <= 0) continue;
    const id = songKey(title, artist);
    const prev = byId.get(id);
    if (!prev) byId.set(id, { id, title, artist, score, xp });
    else {
      byId.set(id, {
        id,
        title,
        artist,
        score: Math.max(prev.score, score),
        xp: Math.max(prev.xp, xp)
      });
    }
  }
  const songs = [...byId.values()].slice(0, BOARD_LIMITS.maxSongs);
  const deviceId = String(body.deviceId).toLowerCase();
  const playerId = validDeviceId(body.playerId) ? String(body.playerId).toLowerCase() : deviceId;
  return {
    ok: true,
    value: {
      deviceId,
      playerId,
      name: name.name,
      songs,
      overallScore: songs.reduce((sum, song) => sum + song.score, 0),
      overallXp: songs.reduce((sum, song) => sum + song.xp, 0)
    }
  };
}

export function nextRate(record, now, limit, windowMs) {
  const start = Number(record?.windowStart);
  const count = Number(record?.count);
  const fresh = !Number.isFinite(start) || now - start >= windowMs;
  if (fresh) return { ok: true, record: { windowStart: now, count: 1 } };
  if (count >= limit) return { ok: false, record: { windowStart: start, count }, retryAt: start + windowMs };
  return { ok: true, record: { windowStart: start, count: count + 1 } };
}

function songsFromPlayer(player) {
  const songs = [];
  for (const [id, song] of Object.entries(player?.songs || {})) {
    if (!song || typeof song !== "object" || Array.isArray(song)) continue;
    const title = cleanLabel(song.title, 80);
    const artist = cleanLabel(song.artist, 80);
    if (!title || !artist) continue;
    songs.push({
      id,
      title,
      artist,
      score: clampInt(song.score, BOARD_LIMITS.maxSongScore),
      xp: clampInt(song.xp, BOARD_LIMITS.maxSongXp)
    });
  }
  return songs;
}

function mergePlayer(prev, incoming, now) {
  const songs = {};
  for (const song of songsFromPlayer(prev)) songs[song.id] = song;
  for (const song of incoming.songs || []) {
    const prior = songs[song.id];
    songs[song.id] = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      score: Math.max(prior?.score || 0, song.score),
      xp: Math.max(prior?.xp || 0, song.xp)
    };
  }
  const kept = Object.values(songs)
    .filter((song) => song.score > 0 || song.xp > 0)
    .sort((a, b) => b.score - a.score || b.xp - a.xp)
    .slice(0, BOARD_LIMITS.maxSongs)
    .map((song) => [song.id, { title: song.title, artist: song.artist, score: song.score, xp: song.xp }]);
  const canonical = validDeviceId(prev?.deviceId)
    ? String(prev.deviceId).toLowerCase()
    : String(incoming.playerId || incoming.deviceId || "").toLowerCase();
  const record = {
    deviceId: canonical,
    name: incoming.name,
    songs: Object.fromEntries(kept),
    updatedAt: now
  };
  const extras = deviceList(prev).filter((id) => id !== canonical).slice(0, BOARD_LIMITS.maxDevices - 1);
  if (extras.length) record.devices = extras;
  const progress = mergeProgress(prev?.progress, incoming.progress);
  if (progress) record.progress = progress;
  return record;
}

function codeKey(code) {
  return `c:${code}`;
}

function pointerKey(playerId) {
  return `k:${playerId}`;
}

export function normalizeCode(value) {
  const cleaned = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== BOARD_LIMITS.codeLength) return "";
  for (const char of cleaned) {
    if (!CODE_ALPHABET.includes(char)) return "";
  }
  return cleaned;
}

function codeFromBytes(bytes) {
  let code = "";
  for (let index = 0; index < BOARD_LIMITS.codeLength; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return code;
}

function randomCode() {
  const bytes = new Uint8Array(BOARD_LIMITS.codeLength);
  globalThis.crypto.getRandomValues(bytes);
  return codeFromBytes(bytes);
}

function deviceList(player) {
  const ids = [];
  const seen = new Set();
  const add = (value) => {
    if (!validDeviceId(value)) return;
    const id = String(value).toLowerCase();
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  add(player?.deviceId);
  add(player?.playerId);
  for (const id of player?.devices || []) add(id);
  return ids;
}

function playerOwnsDevice(player, deviceId) {
  if (!player || !validDeviceId(deviceId)) return false;
  return deviceList(player).includes(String(deviceId).toLowerCase());
}

function sanitizeStreak(streak) {
  if (!streak || typeof streak !== "object" || Array.isArray(streak)) return { count: 0, lastDate: null };
  const lastDate = typeof streak.lastDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(streak.lastDate) ? streak.lastDate : null;
  return { count: clampInt(streak.count, 10000), lastDate };
}

function mergeStreak(left, right) {
  const a = sanitizeStreak(left);
  const b = sanitizeStreak(right);
  if (!b.lastDate) return a;
  if (!a.lastDate) return b;
  if (b.lastDate > a.lastDate) return b;
  if (b.lastDate < a.lastDate) return a;
  return { count: Math.max(a.count, b.count), lastDate: a.lastDate };
}

function mergeRound(left, right) {
  if (!left) return right;
  if (!right) return left;
  const mastered = Boolean(left.mastered || right.mastered);
  const completed = Boolean(left.completed || right.completed);
  const seen = Math.max(left.seen || 0, right.seen || 0);
  const masteredSides = [left, right].filter((item) => item.mastered);
  const mistakes = masteredSides.length
    ? Math.min(...masteredSides.map((item) => item.mistakes || 0))
    : Math.min(left.mistakes || 0, right.mistakes || 0);
  return { mistakes, completed, mastered, seen };
}

function mergeLearning(prev, incoming) {
  const rounds = { ...(prev?.rounds || {}) };
  for (const [id, stat] of Object.entries(incoming?.rounds || {})) rounds[id] = mergeRound(rounds[id], stat);
  const chapters = { ...(prev?.chapters || {}) };
  for (const [id, value] of Object.entries(incoming?.chapters || {})) if (value) chapters[id] = true;
  const lineStats = { ...(prev?.lineStats || {}) };
  for (const [id, stat] of Object.entries(incoming?.lineStats || {})) {
    const prior = lineStats[id];
    lineStats[id] = {
      correct: Math.max(prior?.correct || 0, stat.correct || 0),
      seen: Math.max(prior?.seen || 0, stat.seen || 0)
    };
  }
  return {
    title: incoming?.title || prev?.title || "",
    artist: incoming?.artist || prev?.artist || "",
    rounds,
    chapters,
    lineStats
  };
}

export function sanitizeProgress(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const songs = {};
  const source = body.songs && typeof body.songs === "object" && !Array.isArray(body.songs) ? body.songs : {};
  for (const row of Object.values(source).slice(0, BOARD_LIMITS.maxSongs)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const title = cleanLabel(row.title, 80);
    const artist = cleanLabel(row.artist, 80);
    if (!title || !artist) continue;
    const id = songKey(title, artist);
    const rounds = {};
    const roundSource = row.rounds && typeof row.rounds === "object" && !Array.isArray(row.rounds) ? row.rounds : {};
    for (const [roundId, stat] of Object.entries(roundSource).slice(0, BOARD_LIMITS.maxRounds)) {
      const key = String(roundId).toLowerCase();
      if (!ROUND_ID.test(key) || !stat || typeof stat !== "object" || Array.isArray(stat)) continue;
      rounds[key] = {
        mistakes: clampInt(stat.mistakes, 99),
        completed: Boolean(stat.completed),
        mastered: Boolean(stat.mastered),
        seen: clampInt(stat.seen, 10000)
      };
    }
    const chapters = {};
    if (row.chapters && typeof row.chapters === "object" && !Array.isArray(row.chapters)) {
      for (const chapter of CHAPTER_IDS) if (row.chapters[chapter]) chapters[chapter] = true;
    }
    const lineStats = {};
    const lineSource = row.lineStats && typeof row.lineStats === "object" && !Array.isArray(row.lineStats) ? row.lineStats : {};
    for (const [lineId, stat] of Object.entries(lineSource).slice(0, BOARD_LIMITS.maxLines)) {
      const key = String(lineId).toLowerCase();
      if (!LINE_ID.test(key) || !stat || typeof stat !== "object" || Array.isArray(stat)) continue;
      const correct = clampInt(stat.correct, 99);
      const seen = clampInt(stat.seen, 10000);
      if (correct <= 0 && seen <= 0) continue;
      lineStats[key] = { correct, seen };
    }
    if (!Object.keys(rounds).length && !Object.keys(chapters).length && !Object.keys(lineStats).length) continue;
    songs[id] = { title, artist, rounds, chapters, lineStats };
  }
  const streak = sanitizeStreak(body.streak);
  const totalXp = clampInt(body.totalXp, BOARD_LIMITS.maxSongXp * BOARD_LIMITS.maxSongs);
  if (!Object.keys(songs).length && !streak.lastDate && totalXp <= 0) return null;
  return { streak, totalXp, songs };
}

function mergeProgress(prev, incoming) {
  const left = sanitizeProgress(prev);
  const right = incoming == null ? null : sanitizeProgress(incoming);
  if (!right) return left;
  if (!left) return right;
  const songs = { ...left.songs };
  for (const [id, row] of Object.entries(right.songs || {})) songs[id] = mergeLearning(songs[id], row);
  return {
    streak: mergeStreak(left.streak, right.streak),
    totalXp: Math.max(left.totalXp || 0, right.totalXp || 0),
    songs: Object.fromEntries(Object.entries(songs).slice(0, BOARD_LIMITS.maxSongs))
  };
}

function libraryIds(value) {
  const ids = [];
  const seen = new Set();
  for (const row of (Array.isArray(value) ? value : []).slice(0, BOARD_LIMITS.maxSongs)) {
    const title = cleanLabel(row?.title, 80);
    const artist = cleanLabel(row?.artist, 80);
    if (!title || !artist) continue;
    const id = songKey(title, artist);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function progressForLibrary(player, ids) {
  const wanted = new Set(ids || []);
  const songs = {};
  for (const [id, row] of Object.entries(player?.progress?.songs || {})) {
    if (!wanted.has(id)) continue;
    songs[id] = {
      title: row.title,
      artist: row.artist,
      rounds: row.rounds || {},
      chapters: row.chapters || {},
      lineStats: row.lineStats || {}
    };
  }
  const scores = [];
  for (const [id, song] of Object.entries(player?.songs || {})) {
    if (!wanted.has(id)) continue;
    scores.push({
      id,
      title: song.title || "",
      artist: song.artist || "",
      score: song.score || 0,
      xp: song.xp || 0
    });
  }
  return {
    streak: player?.progress?.streak || { count: 0, lastDate: null },
    totalXp: player?.progress?.totalXp || 0,
    songs,
    scores
  };
}

function blankLearningRow(title, artist) {
  return {
    title,
    artist,
    bestScore: 0,
    bestByGame: {},
    xp: 0,
    lineStats: {},
    rounds: {},
    chapters: {},
    plays: 0,
    lastPlayedAt: null,
    imported: null
  };
}

export function applySharedProgress(progress, payload, library) {
  if (!progress || typeof progress !== "object" || !payload || typeof payload !== "object") return { changed: false };
  const present = new Map();
  for (const song of library || []) {
    const title = typeof song?.title === "string" ? song.title : "";
    const artist = typeof song?.artist === "string" ? song.artist : "";
    if (!title.trim() || !artist.trim()) continue;
    const slot = { localId: songKey(title, artist), title: cleanLabel(title, 120), artist: cleanLabel(artist, 120) };
    present.set(slot.localId, slot);
    present.set(songKey(cleanLabel(title, 80), cleanLabel(artist, 80)), slot);
  }
  if (!present.size) return { changed: false };
  const before = JSON.stringify(progress);
  progress.songs ||= {};
  const remoteSongs = payload.songs && typeof payload.songs === "object" && !Array.isArray(payload.songs) ? payload.songs : {};
  for (const [id, row] of Object.entries(remoteSongs)) {
    const clean = sanitizeProgress({ songs: { [id]: row } });
    const incoming = clean ? Object.values(clean.songs)[0] : null;
    if (!incoming) continue;
    const slot = present.get(id) || present.get(songKey(incoming.title, incoming.artist));
    if (!slot) continue;
    const current = progress.songs[slot.localId] || blankLearningRow(slot.title, slot.artist);
    const learning = mergeLearning({
      title: current.title,
      artist: current.artist,
      rounds: current.rounds || {},
      chapters: current.chapters || {},
      lineStats: current.lineStats || {}
    }, incoming);
    progress.songs[slot.localId] = {
      ...current,
      title: slot.title,
      artist: slot.artist,
      rounds: learning.rounds,
      chapters: learning.chapters,
      lineStats: learning.lineStats
    };
  }
  for (const song of payload.scores || []) {
    if (!song || typeof song !== "object") continue;
    const remoteId = songKey(cleanLabel(song.title, 80), cleanLabel(song.artist, 80));
    const slot = present.get(song.id) || present.get(remoteId);
    if (!slot) continue;
    const current = progress.songs[slot.localId] || blankLearningRow(slot.title, slot.artist);
    current.title = slot.title;
    current.artist = slot.artist;
    current.bestScore = Math.max(current.bestScore || 0, clampInt(song.score, BOARD_LIMITS.maxSongScore));
    current.xp = Math.max(current.xp || 0, clampInt(song.xp, BOARD_LIMITS.maxSongXp));
    current.rounds ||= {};
    current.chapters ||= {};
    current.lineStats ||= {};
    progress.songs[slot.localId] = current;
  }
  const remoteXp = clampInt(payload.totalXp, BOARD_LIMITS.maxSongXp * BOARD_LIMITS.maxSongs);
  if (remoteXp > (progress.totalXp || 0)) progress.totalXp = remoteXp;
  const streak = mergeStreak(progress.streak, payload.streak);
  if ((streak.lastDate || streak.count) && JSON.stringify(progress.streak || null) !== JSON.stringify(streak)) {
    progress.streak = streak;
  }
  return { changed: JSON.stringify(progress) !== before };
}

async function removeKey(store, key) {
  if (typeof store.delete === "function") {
    try {
      await store.delete(key);
      return;
    } catch {
      // Hide the row if the store cannot delete it.
    }
  }
  await store.set(key, { deleted: true });
}

async function freshCode(store, now) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    const existing = await store.get(codeKey(code));
    if (!existing || existing.used || !Number.isFinite(existing.expiresAt) || existing.expiresAt <= now) return code;
  }
  return "";
}

async function handleLink({ body, ip, store, now }) {
  const ipHit = await charge(store, `link:ip:${ip || "anon"}`, BOARD_LIMITS.linkPerIp, now, BOARD_LIMITS.codeWindowMs);
  if (!ipHit.ok) return tooMany("link");
  const name = validateBoardName(body?.name);
  const deviceId = validDeviceId(body?.deviceId) ? String(body.deviceId).toLowerCase() : "";
  if (!deviceId || !name.ok) {
    return { status: 400, body: { error: name.ok ? "That device is not valid." : name.error } };
  }
  const deviceHit = await charge(store, `link:${deviceId}`, BOARD_LIMITS.linkPerDevice, now, BOARD_LIMITS.codeWindowMs);
  if (!deviceHit.ok) return tooMany("link");
  const requested = validDeviceId(body?.playerId) ? String(body.playerId).toLowerCase() : deviceId;
  let prev = await store.get(playerKey(requested));
  if (!prev || !playerOwnsDevice(prev, deviceId)) {
    if (requested !== deviceId || prev) return { status: 403, body: { error: "This device is not linked." } };
  }
  const playerId = validDeviceId(prev?.deviceId) ? String(prev.deviceId).toLowerCase() : deviceId;
  if (!prev) {
    prev = { deviceId: playerId, name: name.name, songs: {}, updatedAt: now };
    await store.set(playerKey(playerId), prev);
  }
  const pointer = await store.get(pointerKey(playerId));
  if (pointer?.code) {
    const previous = await store.get(codeKey(pointer.code));
    if (previous && !previous.used) await store.set(codeKey(pointer.code), { ...previous, used: true });
  }
  const code = await freshCode(store, now);
  if (!code) return { status: 503, body: { error: "The code could not be created." } };
  const expiresAt = now + BOARD_LIMITS.codeTtlMs;
  await store.set(codeKey(code), { playerId, name: prev.name || name.name, expiresAt, used: false });
  await store.set(pointerKey(playerId), { code, expiresAt });
  return { status: 200, body: { code, expiresAt } };
}

async function handleJoin({ body, ip, store, now }) {
  const ipHit = await charge(store, `join:ip:${ip || "anon"}`, BOARD_LIMITS.joinPerIp, now, BOARD_LIMITS.codeWindowMs);
  if (!ipHit.ok) return tooMany("join");
  const deviceId = validDeviceId(body?.deviceId) ? String(body.deviceId).toLowerCase() : "";
  if (!deviceId) return { status: 400, body: { error: "That device is not valid." } };
  const deviceHit = await charge(store, `join:${deviceId}`, BOARD_LIMITS.joinPerDevice, now, BOARD_LIMITS.codeWindowMs);
  if (!deviceHit.ok) return tooMany("join");
  const code = normalizeCode(body?.code);
  if (!code) return { status: 400, body: { error: "That code is not valid." } };
  const ticket = await store.get(codeKey(code));
  if (!ticket || ticket.used || !Number.isFinite(Number(ticket.expiresAt)) || ticket.expiresAt <= now || !validDeviceId(ticket.playerId)) {
    return { status: 400, body: { error: "That code is not valid." } };
  }
  const hostId = String(ticket.playerId).toLowerCase();
  let host = await store.get(playerKey(hostId));
  if (!host || !validDeviceId(host.deviceId)) {
    host = { deviceId: hostId, name: ticket.name, songs: {}, updatedAt: now };
  }
  const joinerId = validDeviceId(body?.playerId) ? String(body.playerId).toLowerCase() : deviceId;
  let joiner = null;
  if (joinerId !== String(host.deviceId).toLowerCase()) {
    const candidate = await store.get(playerKey(joinerId));
    if (candidate && playerOwnsDevice(candidate, deviceId)) joiner = candidate;
  }
  const devices = new Set(deviceList(host));
  devices.add(String(host.deviceId).toLowerCase());
  devices.add(deviceId);
  if (devices.size > BOARD_LIMITS.maxDevices) {
    return { status: 400, body: { error: "This name already has enough devices." } };
  }
  const posted = sanitizeSubmission({
    deviceId,
    playerId: host.deviceId,
    name: host.name || ticket.name || "Player",
    songs: Array.isArray(body?.songs) ? body.songs : []
  });
  const incomingSongs = posted.ok ? posted.value.songs.slice() : [];
  if (joiner) incomingSongs.push(...songsFromPlayer(joiner));
  const next = mergePlayer(host, {
    deviceId: host.deviceId,
    playerId: host.deviceId,
    name: host.name || ticket.name,
    songs: incomingSongs,
    progress: mergeProgress(joiner?.progress, body?.progress)
  }, now);
  const extras = [...devices].filter((id) => id !== next.deviceId);
  if (extras.length) next.devices = extras.slice(0, BOARD_LIMITS.maxDevices - 1);
  else delete next.devices;
  await store.set(playerKey(next.deviceId), next);
  if (joiner && joinerId !== next.deviceId) await removeKey(store, playerKey(joinerId));
  await store.set(codeKey(code), { ...ticket, used: true });
  const pointer = await store.get(pointerKey(next.deviceId));
  if (pointer?.code === code) await removeKey(store, pointerKey(next.deviceId));
  return {
    status: 200,
    body: {
      playerId: next.deviceId,
      name: next.name,
      linked: deviceList(next).length > 1,
      progress: progressForLibrary(next, libraryIds(body?.library))
    }
  };
}

async function handlePull({ body, ip, store, now }) {
  const deviceId = validDeviceId(body?.deviceId) ? String(body.deviceId).toLowerCase() : "";
  if (!deviceId) return { status: 400, body: { error: "That device is not valid." } };
  const viewed = await charge(store, `get:${deviceId}`, BOARD_LIMITS.getPerDevice, now);
  if (!viewed.ok) return tooMany("get");
  if (ip) {
    const ipViewed = await charge(store, `get:ip:${ip}`, BOARD_LIMITS.getPerIp, now);
    if (!ipViewed.ok) return tooMany("get");
  }
  const requested = validDeviceId(body?.playerId) ? String(body.playerId).toLowerCase() : deviceId;
  const prev = await store.get(playerKey(requested));
  if (!prev) return { status: 200, body: { linked: false, progress: progressForLibrary(null, []) } };
  if (!playerOwnsDevice(prev, deviceId)) return { status: 403, body: { error: "This device is not linked." } };
  return {
    status: 200,
    body: {
      name: prev.name || "",
      linked: deviceList(prev).length > 1,
      progress: progressForLibrary(prev, libraryIds(body?.library))
    }
  };
}

function playerKey(deviceId) {
  return `p:${deviceId}`;
}

function overallOf(player) {
  const songs = Object.values(player.songs || {});
  return {
    score: songs.reduce((sum, song) => sum + (song.score || 0), 0),
    xp: songs.reduce((sum, song) => sum + (song.xp || 0), 0)
  };
}

function rankList(players, pick, deviceId) {
  const rows = [];
  for (const player of players) {
    const value = pick(player);
    if (!value || ((value.score || 0) <= 0 && (value.xp || 0) <= 0)) continue;
    rows.push({
      name: player.name,
      score: value.score || 0,
      xp: value.xp || 0,
      you: playerOwnsDevice(player, deviceId)
    });
  }
  rows.sort((a, b) => b.score - a.score || b.xp - a.xp || a.name.localeCompare(b.name));
  return rows.map((row, index) => ({ rank: index + 1, name: row.name, score: row.score, xp: row.xp, you: row.you }));
}

function youSummary(ranked) {
  const row = ranked.find((item) => item.you);
  if (!row) return null;
  return { rank: row.rank, score: row.score, xp: row.xp };
}

function songCatalog(players) {
  const byId = new Map();
  for (const player of players) {
    for (const [id, song] of Object.entries(player.songs || {})) {
      const prev = byId.get(id);
      if (!prev || (song.score || 0) > prev.score) {
        byId.set(id, { id, title: song.title || "", artist: song.artist || "", score: song.score || 0 });
      }
    }
  }
  return [...byId.values()]
    .sort((a, b) => a.title.localeCompare(b.title) || a.artist.localeCompare(b.artist))
    .slice(0, 100)
    .map(({ id, title, artist }) => ({ id, title, artist }));
}

export function boardResponse(players, { deviceId = "", songId = "" } = {}) {
  const overallRanked = rankList(players, overallOf, deviceId);
  const songs = songCatalog(players);
  let song = null;
  let songYou = null;
  if (songId) {
    const ranked = rankList(players, (player) => player.songs?.[songId] || null, deviceId);
    const known = songs.find((item) => item.id === songId) || players.map((player) => player.songs?.[songId]).find(Boolean);
    song = {
      id: songId,
      title: known?.title || "",
      artist: known?.artist || "",
      rows: ranked.slice(0, BOARD_LIMITS.top).map(publicRow)
    };
    songYou = youSummary(ranked);
  }
  const owner = players.find((player) => playerOwnsDevice(player, deviceId));
  const you = deviceId ? {
    overall: youSummary(overallRanked),
    song: songYou,
    linked: Boolean(owner && deviceList(owner).length > 1)
  } : null;
  return {
    overall: overallRanked.slice(0, BOARD_LIMITS.top).map(publicRow),
    you,
    song,
    songs
  };
}

function publicRow(row) {
  return { rank: row.rank, name: row.name, score: row.score, xp: row.xp, you: row.you };
}

async function readPlayers(store, deviceId) {
  const keys = await store.list("p:");
  const wanted = keys.slice(0, BOARD_LIMITS.maxPlayers);
  const mine = deviceId ? playerKey(deviceId) : "";
  if (mine && keys.includes(mine) && !wanted.includes(mine)) wanted.push(mine);
  const players = [];
  for (const key of wanted) {
    const row = await store.get(key);
    if (!row || typeof row !== "object" || !validDeviceId(row.deviceId) || typeof row.name !== "string") continue;
    players.push(row);
  }
  return players;
}

async function charge(store, bucket, limit, now, windowMs = BOARD_LIMITS.windowMs) {
  const key = `r:${bucket}`;
  const decision = nextRate(await store.get(key), now, limit, windowMs);
  if (!decision.ok) return decision;
  await store.set(key, decision.record);
  return decision;
}

function tooMany(kind) {
  const error = kind === "get"
    ? "The board is busy. Try again later."
    : kind === "join"
      ? "Too many code attempts. Wait a few minutes."
      : kind === "link"
        ? "Too many codes. Wait a few minutes."
        : "Too many updates. Try again later.";
  return { status: 429, body: { error } };
}

function clientIp(ip) {
  return String(ip || "").trim().slice(0, 80);
}

export async function handleLeaderboard({ method, searchParams, body, ip, store, now = Date.now() }) {
  const verb = String(method || "").toUpperCase();
  if (verb !== "GET" && verb !== "POST") {
    return { status: 405, body: { error: "That action is not available." } };
  }
  const address = clientIp(ip);
  if (verb === "POST") {
    const action = String(body?.action || "").toLowerCase();
    if (action === "link") return handleLink({ body, ip: address, store, now });
    if (action === "join") return handleJoin({ body, ip: address, store, now });
    if (action === "pull") return handlePull({ body, ip: address, store, now });
    if (action) return { status: 400, body: { error: "That action is not available." } };
    const verdict = sanitizeSubmission(body);
    if (!verdict.ok) {
      const blocked = await charge(store, `post:ip:${address || "anon"}`, BOARD_LIMITS.postPerIp, now);
      if (!blocked.ok) return tooMany("post");
      return { status: 400, body: { error: verdict.error } };
    }
    const deviceBlocked = await charge(store, `post:${verdict.value.deviceId}`, BOARD_LIMITS.postPerDevice, now);
    if (!deviceBlocked.ok) return tooMany("post");
    if (address) {
      const ipBlocked = await charge(store, `post:ip:${address}`, BOARD_LIMITS.postPerIp, now);
      if (!ipBlocked.ok) return tooMany("post");
    }
    const playerId = verdict.value.playerId || verdict.value.deviceId;
    const key = playerKey(playerId);
    const prev = await store.get(key);
    if (prev && !playerOwnsDevice(prev, verdict.value.deviceId)) {
      return { status: 403, body: { error: "This device is not linked." } };
    }
    if (!prev && playerId !== verdict.value.deviceId) {
      return { status: 403, body: { error: "This device is not linked." } };
    }
    const next = mergePlayer(prev, { ...verdict.value, progress: body?.progress }, now);
    await store.set(key, next);
    const players = await readPlayers(store, next.deviceId);
    const library = libraryIds(body?.library);
    const response = boardResponse(players, { deviceId: verdict.value.deviceId });
    if (library.length) response.progress = progressForLibrary(next, library);
    return { status: 200, body: response };
  }

  const rawDevice = searchParams?.get?.("device") || "";
  const deviceId = validDeviceId(rawDevice) ? rawDevice.toLowerCase() : "";
  const rawSong = searchParams?.get?.("song") || "";
  const songId = typeof rawSong === "string" ? rawSong.slice(0, 160) : "";
  const deviceBucket = deviceId ? `get:${deviceId}` : `get:ip:${address || "anon"}`;
  const deviceLimit = deviceId ? BOARD_LIMITS.getPerDevice : BOARD_LIMITS.getPerIp;
  const viewed = await charge(store, deviceBucket, deviceLimit, now);
  if (!viewed.ok) return tooMany("get");
  if (deviceId && address) {
    const ipViewed = await charge(store, `get:ip:${address}`, BOARD_LIMITS.getPerIp, now);
    if (!ipViewed.ok) return tooMany("get");
  }
  const players = await readPlayers(store, deviceId);
  return { status: 200, body: boardResponse(players, { deviceId, songId }) };
}

export function createMemoryBoardStore() {
  const data = new Map();
  return {
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
    async list(prefix) {
      return [...data.keys()].filter((key) => key.startsWith(prefix));
    },
    async delete(key) {
      data.delete(key);
    }
  };
}

export function songChoices(remoteSongs, localSongs) {
  const byId = new Map();
  for (const song of remoteSongs || []) {
    if (!song?.id || !song.title) continue;
    byId.set(song.id, { id: song.id, title: song.title, artist: song.artist || "" });
  }
  for (const song of localSongs || []) {
    if (!song?.id || !song.title || byId.has(song.id)) continue;
    byId.set(song.id, { id: song.id, title: song.title, artist: song.artist || "" });
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title) || a.artist.localeCompare(b.artist));
}

export function boardScreen({ profile, remote, local, songId = "", offline = false, busy = false }) {
  const localSnapshot = local || { songs: [], overallScore: 0, overallXp: 0 };
  const songs = songChoices(remote?.songs, localSnapshot.songs);
  const selected = songs.some((song) => song.id === songId) ? songId : "";
  const remoteRows = selected
    ? (remote?.song?.id === selected ? remote.song.rows || [] : [])
    : (remote?.overall || []);
  const remoteYou = selected ? remote?.you?.song : remote?.you?.overall;
  const localSong = selected ? localSnapshot.songs.find((song) => song.id === selected) : null;
  const localScore = selected ? (localSong?.score || 0) : localSnapshot.overallScore;
  const localXp = selected ? (localSong?.xp || 0) : localSnapshot.overallXp;
  const score = Math.max(remoteYou?.score || 0, localScore);
  const xp = Math.max(remoteYou?.xp || 0, localXp);
  const rank = remoteYou?.rank || null;
  const rows = remoteRows.map((row) => ({
    rank: row.rank,
    name: row.name,
    score: row.you ? Math.max(row.score || 0, localScore) : (row.score || 0),
    xp: row.you ? Math.max(row.xp || 0, localXp) : (row.xp || 0),
    you: Boolean(row.you)
  }));
  const listed = rows.some((row) => row.you);
  let note = "";
  if (!rank && score <= 0 && xp <= 0) note = "Finish a lesson to post a score.";
  else if (!rank) note = "Your rank will show when the board loads.";
  let status = "On the shared board.";
  if (busy) status = remote ? "The board is busy. Showing the last one saved on this device." : "The board is busy. Your scores stay on this device.";
  else if (offline && remote) status = "Showing the last shared board. New scores stay on this device until you are online.";
  else if (offline) status = "Saved on this device. The shared board will load when you are online.";
  else if (profile?.pending) status = "Saved on this device. It will reach the shared board when it can.";
  return {
    name: profile?.name || "",
    selected,
    songs,
    rows,
    you: { rank, score, xp, note, showRow: Boolean(rank && !listed) },
    status
  };
}
