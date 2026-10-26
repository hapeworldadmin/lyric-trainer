import { clip, lineKey, shiftDateKey, songKey, todayKey } from "./text.js?v=5";

export const MASTER_CORRECT = 2;
const GAMES = new Set(["fill", "order", "next", "letters", "concert", "sections", "lines"]);

export function emptyProgress() {
  return {
    totalXp: 0,
    streak: { count: 0, lastDate: null },
    songs: {}
  };
}

export function nextStreak(streak, now = new Date()) {
  const today = todayKey(now);
  const current = streak && typeof streak.count === "number"
    ? { count: streak.count, lastDate: streak.lastDate || null }
    : { count: 0, lastDate: null };
  if (current.lastDate === today) return { count: current.count, lastDate: today };
  if (current.lastDate && current.lastDate === shiftDateKey(today, -1)) {
    return { count: current.count + 1, lastDate: today };
  }
  return { count: 1, lastDate: today };
}

function ensureRow(progress, song) {
  const key = songKey(song.title, song.artist);
  if (!progress.songs[key]) {
    progress.songs[key] = {
      title: song.title,
      artist: song.artist,
      bestScore: 0,
      bestByGame: {},
      xp: 0,
      lineStats: {},
      plays: 0,
      lastPlayedAt: null,
      imported: null
    };
  }
  const row = progress.songs[key];
  row.title = song.title;
  row.artist = song.artist;
  row.bestByGame ||= {};
  row.lineStats ||= {};
  return row;
}

export function songStats(progress, song) {
  const key = songKey(song.title, song.artist);
  const row = progress?.songs?.[key] || {
    title: song.title,
    artist: song.artist,
    bestScore: 0,
    bestByGame: {},
    xp: 0,
    lineStats: {},
    plays: 0,
    lastPlayedAt: null,
    imported: null
  };
  const lineCount = song.lines?.length || 0;
  let liveMastered = 0;
  let progressPoints = 0;
  for (const line of song.lines || []) {
    const correct = row.lineStats?.[lineKey(line)]?.correct || 0;
    if (correct >= MASTER_CORRECT) liveMastered += 1;
    progressPoints += Math.min(correct, MASTER_CORRECT) / MASTER_CORRECT;
  }
  let linesMastered = liveMastered;
  if (row.imported && row.imported.lineCount === lineCount) {
    linesMastered = Math.max(linesMastered, Math.min(row.imported.linesMastered || 0, lineCount));
    progressPoints = Math.max(progressPoints, ((row.imported.masteryPercent || 0) / 100) * lineCount);
  }
  const masteryPercent = lineCount === 0 ? 0 : Math.round((100 * progressPoints) / lineCount);
  return {
    key,
    title: song.title,
    artist: song.artist,
    bestScore: row.bestScore || 0,
    bestByGame: { ...(row.bestByGame || {}) },
    xp: row.xp || 0,
    plays: row.plays || 0,
    lastPlayedAt: row.lastPlayedAt || null,
    lineCount,
    linesMastered,
    masteryPercent
  };
}

export function recordLineResult(progress, song, { line, correct, xpGain }) {
  const row = ensureRow(progress, song);
  const key = lineKey(line);
  if (!row.lineStats[key]) row.lineStats[key] = { correct: 0, seen: 0 };
  row.lineStats[key].seen += 1;
  if (correct) row.lineStats[key].correct += 1;
  const gain = Math.max(0, Math.round(xpGain || 0));
  row.xp += gain;
  progress.totalXp = (progress.totalXp || 0) + gain;
  row.lastPlayedAt = new Date().toISOString();
  return songStats(progress, song);
}

export function recordRun(progress, song, { score, gameId }) {
  const row = ensureRow(progress, song);
  const value = Math.max(0, Math.round(score || 0));
  row.plays = (row.plays || 0) + 1;
  const previous = row.bestScore || 0;
  if (value > previous) row.bestScore = value;
  if (GAMES.has(gameId)) {
    row.bestByGame[gameId] = Math.max(row.bestByGame[gameId] || 0, value);
  }
  return { previousBest: previous, bestScore: row.bestScore, isNewBest: value > previous && value > 0 };
}

export function finishStreak(progress, now = new Date()) {
  progress.streak = nextStreak(progress.streak, now);
  return progress.streak;
}

export function addBonusXp(progress, song, amount) {
  const gain = Math.max(0, Math.round(amount || 0));
  if (!gain) return 0;
  const row = ensureRow(progress, song);
  row.xp += gain;
  progress.totalXp = (progress.totalXp || 0) + gain;
  return gain;
}

export function retitleSongProgress(progressByPlayer, oldTitle, oldArtist, newTitle, newArtist) {
  const oldKey = songKey(oldTitle, oldArtist);
  const newKey = songKey(newTitle, newArtist);
  for (const progress of Object.values(progressByPlayer || {})) {
    const prev = progress.songs?.[oldKey];
    if (!prev) continue;
    if (oldKey === newKey) {
      prev.title = newTitle;
      prev.artist = newArtist;
      continue;
    }
    const dest = progress.songs[newKey];
    progress.songs[newKey] = dest ? mergeRows(dest, prev, newTitle, newArtist) : { ...prev, title: newTitle, artist: newArtist };
    delete progress.songs[oldKey];
  }
}

export function resetLineMasteryIfChanged(progressByPlayer, title, artist, previousLines, nextLines) {
  const before = (previousLines || []).map((line) => lineKey(line)).join("|");
  const after = (nextLines || []).map((line) => lineKey(line)).join("|");
  if (before === after) return;
  const key = songKey(title, artist);
  for (const progress of Object.values(progressByPlayer || {})) {
    const row = progress.songs?.[key];
    if (!row) continue;
    row.lineStats = {};
    row.imported = null;
  }
}

function mergeRows(a, b, title, artist) {
  const lineStats = { ...(b.lineStats || {}) };
  for (const [key, value] of Object.entries(a.lineStats || {})) {
    const other = lineStats[key];
    lineStats[key] = other
      ? { correct: Math.max(other.correct || 0, value.correct || 0), seen: Math.max(other.seen || 0, value.seen || 0) }
      : { correct: value.correct || 0, seen: value.seen || 0 };
  }
  const bestByGame = { ...(b.bestByGame || {}) };
  for (const [key, value] of Object.entries(a.bestByGame || {})) {
    bestByGame[key] = Math.max(bestByGame[key] || 0, value || 0);
  }
  return {
    title,
    artist,
    bestScore: Math.max(a.bestScore || 0, b.bestScore || 0),
    bestByGame,
    xp: Math.max(a.xp || 0, b.xp || 0),
    lineStats,
    plays: (a.plays || 0) + (b.plays || 0),
    lastPlayedAt: [a.lastPlayedAt, b.lastPlayedAt].filter(Boolean).sort().at(-1) || null,
    imported: a.imported || b.imported || null
  };
}

export function buildExport(state) {
  const progress = {};
  for (const [playerId, row] of Object.entries(state.progress || {})) {
    const songs = {};
    for (const songRow of Object.values(row.songs || {})) {
      if (!songRow?.title || !songRow?.artist) continue;
      const key = songKey(songRow.title, songRow.artist);
      const librarySong = (state.songs || []).find((song) => songKey(song.title, song.artist) === key);
      const stats = librarySong ? songStats(row, librarySong) : null;
      const exported = {
        title: songRow.title,
        artist: songRow.artist,
        bestScore: songRow.bestScore || 0,
        bestByGame: { ...(songRow.bestByGame || {}) },
        xp: songRow.xp || 0,
        plays: songRow.plays || 0
      };
      if (stats) {
        exported.masteryPercent = stats.masteryPercent;
        exported.linesMastered = stats.linesMastered;
        exported.lineCount = stats.lineCount;
      } else if (songRow.imported) {
        exported.masteryPercent = songRow.imported.masteryPercent;
        exported.linesMastered = songRow.imported.linesMastered;
        exported.lineCount = songRow.imported.lineCount;
      }
      songs[key] = exported;
    }
    progress[playerId] = {
      totalXp: row.totalXp || 0,
      streak: {
        count: row.streak?.count || 0,
        lastDate: row.streak?.lastDate || null
      },
      songs
    };
  }
  return {
    version: 1,
    kind: "lyric-trainer-progress",
    exportedAt: new Date().toISOString(),
    note: "Scores only. This file intentionally contains no lyrics.",
    activePlayerId: state.activePlayerId,
    players: (state.players || []).map((player) => ({ id: player.id, name: player.name })),
    progress,
    leaderboard: (state.leaderboard || []).map(publicRun)
  };
}

function publicRun(entry) {
  return {
    id: entry.id,
    playerId: entry.playerId,
    playerName: entry.playerName,
    songTitle: entry.songTitle,
    songArtist: entry.songArtist,
    gameId: entry.gameId,
    score: entry.score,
    xp: entry.xp || 0,
    createdAt: entry.createdAt
  };
}

export function mergeImport(state, data) {
  if (!data || data.kind !== "lyric-trainer-progress" || data.version !== 1) {
    throw new Error("Choose a Know the Verse progress file.");
  }
  const importedPlayers = Array.isArray(data.players) ? data.players : [];
  for (const raw of importedPlayers) {
    if (!raw || typeof raw.name !== "string" || !raw.name.trim()) continue;
    const name = clip(raw.name, 40);
    let player = (raw.id && state.players.find((item) => item.id === raw.id))
      || state.players.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!player) {
      player = { id: typeof raw.id === "string" && raw.id ? raw.id : `player-${name.toLowerCase()}`, name, createdAt: Date.now() };
      state.players.push(player);
      state.progress[player.id] = emptyProgress();
    } else {
      player.name = name;
    }
    const incoming = data.progress?.[player.id] || (raw.id ? data.progress?.[raw.id] : null);
    if (!incoming || typeof incoming !== "object") continue;
    const dest = state.progress[player.id] || emptyProgress();
    dest.totalXp = Math.max(dest.totalXp || 0, Math.round(Number(incoming.totalXp) || 0));
    dest.streak = betterStreak(dest.streak, incoming.streak);
    dest.songs ||= {};
    for (const row of Object.values(incoming.songs || {})) {
      if (!row || typeof row.title !== "string" || typeof row.artist !== "string") continue;
      const key = songKey(row.title, row.artist);
      const prev = dest.songs[key] || {
        title: clip(row.title, 120),
        artist: clip(row.artist, 120),
        bestScore: 0,
        bestByGame: {},
        xp: 0,
        lineStats: {},
        plays: 0,
        lastPlayedAt: null,
        imported: null
      };
      prev.title = clip(row.title, 120);
      prev.artist = clip(row.artist, 120);
      prev.bestScore = Math.max(prev.bestScore || 0, Math.round(Number(row.bestScore) || 0));
      prev.xp = Math.max(prev.xp || 0, Math.round(Number(row.xp) || 0));
      prev.plays = Math.max(prev.plays || 0, Math.round(Number(row.plays) || 0));
      prev.bestByGame ||= {};
      for (const [game, value] of Object.entries(row.bestByGame || {})) {
        if (!GAMES.has(game)) continue;
        prev.bestByGame[game] = Math.max(prev.bestByGame[game] || 0, Math.round(Number(value) || 0));
      }
      if (row.masteryPercent != null && row.linesMastered != null && row.lineCount != null) {
        prev.imported = {
          masteryPercent: clamp(row.masteryPercent, 0, 100),
          linesMastered: Math.max(0, Math.round(Number(row.linesMastered) || 0)),
          lineCount: Math.max(0, Math.round(Number(row.lineCount) || 0))
        };
      }
      dest.songs[key] = prev;
    }
    state.progress[player.id] = dest;
  }
  if (Array.isArray(data.leaderboard)) {
    const seen = new Set((state.leaderboard || []).map((entry) => entry.id));
    state.leaderboard ||= [];
    for (const raw of data.leaderboard) {
      if (!raw?.id || seen.has(raw.id)) continue;
      seen.add(raw.id);
      state.leaderboard.push(publicRun({
        id: String(raw.id),
        playerId: String(raw.playerId || ""),
        playerName: clip(raw.playerName, 40),
        songTitle: clip(raw.songTitle, 120),
        songArtist: clip(raw.songArtist, 120),
        gameId: GAMES.has(raw.gameId) ? raw.gameId : "fill",
        score: Math.max(0, Math.round(Number(raw.score) || 0)),
        xp: Math.max(0, Math.round(Number(raw.xp) || 0)),
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString()
      }));
    }
  }
  return state;
}

function betterStreak(current, incoming) {
  const left = normalizeStreak(current);
  const right = normalizeStreak(incoming);
  if (!right.lastDate) return left;
  if (!left.lastDate) return right;
  if (right.lastDate > left.lastDate) return right;
  if (right.lastDate < left.lastDate) return left;
  return { count: Math.max(left.count, right.count), lastDate: left.lastDate };
}

function normalizeStreak(streak) {
  if (!streak || typeof streak !== "object") return { count: 0, lastDate: null };
  const lastDate = typeof streak.lastDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(streak.lastDate) ? streak.lastDate : null;
  return { count: Math.max(0, Math.round(Number(streak.count) || 0)), lastDate };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}
