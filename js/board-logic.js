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
  maxPlayers: 1000
};

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

export function buildSubmission(progress, profile) {
  const snapshot = snapshotFromProgress(progress);
  return {
    deviceId: profile?.deviceId || "",
    name: profile?.name || "",
    overallScore: snapshot.overallScore,
    overallXp: snapshot.overallXp,
    songs: snapshot.songs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      score: song.score,
      xp: song.xp
    }))
  };
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
  return {
    ok: true,
    value: {
      deviceId: String(body.deviceId).toLowerCase(),
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

function mergePlayer(prev, incoming, now) {
  const songs = {};
  for (const [id, song] of Object.entries(prev?.songs || {})) {
    if (!song || typeof song !== "object" || Array.isArray(song)) continue;
    const title = cleanLabel(song.title, 80);
    const artist = cleanLabel(song.artist, 80);
    if (!title || !artist) continue;
    songs[id] = {
      title,
      artist,
      score: clampInt(song.score, BOARD_LIMITS.maxSongScore),
      xp: clampInt(song.xp, BOARD_LIMITS.maxSongXp)
    };
  }
  for (const song of incoming.songs) {
    const prior = songs[song.id];
    songs[song.id] = {
      title: song.title,
      artist: song.artist,
      score: Math.max(prior?.score || 0, song.score),
      xp: Math.max(prior?.xp || 0, song.xp)
    };
  }
  const kept = Object.entries(songs)
    .filter(([, song]) => song.score > 0 || song.xp > 0)
    .sort((a, b) => b[1].score - a[1].score || b[1].xp - a[1].xp)
    .slice(0, BOARD_LIMITS.maxSongs);
  return {
    deviceId: incoming.deviceId,
    name: incoming.name,
    songs: Object.fromEntries(kept),
    updatedAt: now
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
      you: Boolean(deviceId) && player.deviceId === deviceId
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
  const you = deviceId ? { overall: youSummary(overallRanked), song: songYou } : null;
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

async function charge(store, bucket, limit, now) {
  const key = `r:${bucket}`;
  const decision = nextRate(await store.get(key), now, limit, BOARD_LIMITS.windowMs);
  if (!decision.ok) return decision;
  await store.set(key, decision.record);
  return decision;
}

function tooMany(kind) {
  const error = kind === "get" ? "The board is busy. Try again later." : "Too many updates. Try again later.";
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
    const key = playerKey(verdict.value.deviceId);
    const prev = await store.get(key);
    const next = mergePlayer(prev, verdict.value, now);
    await store.set(key, next);
    const players = await readPlayers(store, next.deviceId);
    return { status: 200, body: boardResponse(players, { deviceId: next.deviceId }) };
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
