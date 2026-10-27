import { SAMPLE_SONG } from "./sample.js?v=9";
import { emptyProgress } from "./progress.js?v=10";
import { sanitizeRun } from "./scores.js?v=10";
import { clip, songKey, uid } from "./text.js?v=9";

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
    sections: [...(SAMPLE_SONG.sections || [])],
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
  const lines = [];
  const sections = [];
  for (let index = 0; index < song.lines.length && lines.length < 400; index += 1) {
    const line = song.lines[index];
    if (typeof line !== "string" || !line.trim()) continue;
    lines.push(clip(line, 300));
    const label = Array.isArray(song.sections) && typeof song.sections[index] === "string" ? song.sections[index] : "";
    sections.push(clip(label, 40));
  }
  if (lines.length < 2) return null;
  const sample = Boolean(song.sample);
  const matchesSample = lines.length === SAMPLE_SONG.lines.length && lines.every((line, index) => line === SAMPLE_SONG.lines[index]);
  if (sample && matchesSample && sections.every((label) => !label) && Array.isArray(SAMPLE_SONG.sections)) {
    SAMPLE_SONG.sections.forEach((label, index) => {
      if (index < sections.length) sections[index] = clip(label, 40);
    });
  }
  return {
    id: typeof song.id === "string" && song.id ? song.id : uid(),
    title: clip(song.title, 120),
    artist: clip(song.artist, 120),
    lines,
    sections,
    sample,
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
    if (!["fill", "order", "next", "letters", "concert", "lines", "fade", "think"].includes(game)) continue;
    bestByGame[game] = Math.max(0, Math.round(Number(value) || 0));
  }
  const rounds = {};
  for (const [id, stat] of Object.entries(row.rounds || {})) {
    if (!/^[a-z0-9-]+$/i.test(id) || !stat || typeof stat !== "object") continue;
    rounds[id] = {
      mistakes: Math.max(0, Math.round(Number(stat.mistakes) || 0)),
      completed: Boolean(stat.completed),
      mastered: Boolean(stat.mastered),
      seen: Math.max(0, Math.round(Number(stat.seen) || 0))
    };
  }
  const chapters = {};
  for (const id of ["fade", "think", "lines", "next", "concert"]) {
    if (row.chapters?.[id]) chapters[id] = true;
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
    rounds,
    chapters,
    plays: Math.max(0, Math.round(Number(row.plays) || 0)),
    lastPlayedAt: typeof row.lastPlayedAt === "string" ? row.lastPlayedAt : null,
    imported
  };
}
