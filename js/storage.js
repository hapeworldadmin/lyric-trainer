import { SAMPLE_SONG } from "./sample.js";
import { emptyProgress } from "./progress.js";
import { sanitizeRun } from "./scores.js";
import { clip, songKey, uid } from "./text.js";

export const STORAGE_KEY = "lyric-trainer-v1";

function memory() {
  const store = globalThis.localStorage;
  if (!store || typeof store.getItem !== "function" || typeof store.setItem !== "function") return null;
  return store;
}

export function blankState() {
  const player = { id: uid(), name: "You", createdAt: Date.now() };
  return {
    version: 1,
    seeded: false,
    songs: [],
    players: [player],
    activePlayerId: player.id,
    progress: { [player.id]: emptyProgress() },
    leaderboard: [],
    settings: { sound: true, privacySeen: false }
  };
}

export function seedSample(state) {
  if (state.seeded) return state;
  state.songs.push(sampleRecord());
  state.seeded = true;
  return state;
}

export function sampleRecord() {
  return {
    id: "sample-banana-flashlight",
    title: SAMPLE_SONG.title,
    artist: SAMPLE_SONG.artist,
    lines: [...SAMPLE_SONG.lines],
    sample: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function loadState() {
  const store = memory();
  if (!store) return seedSample(blankState());
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return seedSample(blankState());
    return seedSample(hydrate(JSON.parse(raw)));
  } catch {
    return seedSample(blankState());
  }
}

export function saveState(state) {
  const store = memory();
  if (!store) return;
  store.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function activePlayer(state) {
  return state.players.find((player) => player.id === state.activePlayerId) || state.players[0];
}

export function activeProgress(state) {
  const player = activePlayer(state);
  if (!state.progress[player.id]) state.progress[player.id] = emptyProgress();
  return state.progress[player.id];
}

function hydrate(raw) {
  const state = blankState();
  if (!raw || typeof raw !== "object") return state;
  state.seeded = Boolean(raw.seeded);
  state.songs = Array.isArray(raw.songs) ? raw.songs.map(cleanSong).filter(Boolean) : [];
  const players = Array.isArray(raw.players) ? raw.players.map(cleanPlayer).filter(Boolean) : [];
  if (players.length) state.players = players;
  state.activePlayerId = players.some((player) => player.id === raw.activePlayerId) ? raw.activePlayerId : state.players[0].id;
  state.progress = {};
  for (const player of state.players) {
    state.progress[player.id] = cleanProgress(raw.progress?.[player.id]);
  }
  state.leaderboard = Array.isArray(raw.leaderboard) ? raw.leaderboard.slice(-300).map(sanitizeRun) : [];
  state.settings = {
    sound: raw.settings?.sound !== false,
    privacySeen: Boolean(raw.settings?.privacySeen)
  };
  return state;
}

function cleanSong(song) {
  if (!song || typeof song.title !== "string" || typeof song.artist !== "string" || !Array.isArray(song.lines)) return null;
  const lines = song.lines.filter((line) => typeof line === "string" && line.trim()).map((line) => clip(line, 300)).slice(0, 400);
  if (lines.length < 2) return null;
  return {
    id: typeof song.id === "string" && song.id ? song.id : uid(),
    title: clip(song.title, 120),
    artist: clip(song.artist, 120),
    lines,
    sample: Boolean(song.sample),
    createdAt: Number(song.createdAt) || Date.now(),
    updatedAt: Number(song.updatedAt) || Date.now()
  };
}

function cleanPlayer(player) {
  if (!player || typeof player.name !== "string" || !player.name.trim()) return null;
  return {
    id: typeof player.id === "string" && player.id ? player.id : uid(),
    name: clip(player.name, 40),
    createdAt: Number(player.createdAt) || Date.now()
  };
}

function cleanProgress(progress) {
  const next = emptyProgress();
  if (!progress || typeof progress !== "object") return next;
  next.totalXp = Math.max(0, Math.round(Number(progress.totalXp) || 0));
  if (progress.streak && typeof progress.streak === "object") {
    next.streak = {
      count: Math.max(0, Math.round(Number(progress.streak.count) || 0)),
      lastDate: typeof progress.streak.lastDate === "string" ? progress.streak.lastDate : null
    };
  }
  for (const row of Object.values(progress.songs || {})) {
    const clean = cleanSongProgress(row);
    if (!clean) continue;
    next.songs[songKey(clean.title, clean.artist)] = clean;
  }
  return next;
}

function cleanSongProgress(row) {
  if (!row || typeof row.title !== "string" || typeof row.artist !== "string") return null;
  const lineStats = {};
  for (const [key, stat] of Object.entries(row.lineStats || {})) {
    if (!/^[a-z0-9]+$/i.test(key) || !stat || typeof stat !== "object") continue;
    lineStats[key] = {
      correct: Math.max(0, Math.round(Number(stat.correct) || 0)),
      seen: Math.max(0, Math.round(Number(stat.seen) || 0))
    };
  }
  const bestByGame = {};
  for (const [game, value] of Object.entries(row.bestByGame || {})) {
    if (!["fill", "order", "next", "letters", "concert"].includes(game)) continue;
    bestByGame[game] = Math.max(0, Math.round(Number(value) || 0));
  }
  let imported = null;
  if (row.imported && typeof row.imported === "object") {
    imported = {
      masteryPercent: Math.max(0, Math.min(100, Math.round(Number(row.imported.masteryPercent) || 0))),
      linesMastered: Math.max(0, Math.round(Number(row.imported.linesMastered) || 0)),
      lineCount: Math.max(0, Math.round(Number(row.imported.lineCount) || 0))
    };
  }
  return {
    title: clip(row.title, 120),
    artist: clip(row.artist, 120),
    bestScore: Math.max(0, Math.round(Number(row.bestScore) || 0)),
    bestByGame,
    xp: Math.max(0, Math.round(Number(row.xp) || 0)),
    lineStats,
    plays: Math.max(0, Math.round(Number(row.plays) || 0)),
    lastPlayedAt: typeof row.lastPlayedAt === "string" ? row.lastPlayedAt : null,
    imported
  };
}
