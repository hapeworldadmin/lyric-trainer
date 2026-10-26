import { songStats } from "./progress.js";
import { clip, safeConcertId, slug, songKey } from "./text.js";

export function normalizeConcerts(data) {
  const list = Array.isArray(data) ? data : data?.concerts;
  if (!Array.isArray(list)) return [];
  const used = new Set();
  const concerts = [];
  for (const raw of list) {
    if (!raw || typeof raw.name !== "string" || !raw.name.trim()) continue;
    const name = clip(raw.name, 80);
    let id = "";
    try {
      id = safeConcertId(raw.id || slug(name));
    } catch {
      id = slug(name);
    }
    while (used.has(id)) id = `${id}-2`.slice(0, 80);
    used.add(id);
    const setlist = [];
    if (Array.isArray(raw.setlist)) {
      for (const item of raw.setlist) {
        if (!item || typeof item.title !== "string" || typeof item.artist !== "string") continue;
        const title = clip(item.title, 120);
        const artist = clip(item.artist, 120);
        if (!title || !artist) continue;
        setlist.push({ title, artist });
      }
    }
    concerts.push({ id, name, setlist });
  }
  return concerts;
}

export function linkSetlist(concert, songs, progress) {
  return (concert?.setlist || []).map((item, index) => {
    const key = songKey(item.title, item.artist);
    const song = (songs || []).find((candidate) => songKey(candidate.title, candidate.artist) === key) || null;
    const stats = song ? songStats(progress || { songs: {} }, song) : null;
    const mastered = Boolean(stats && stats.lineCount > 0 && stats.linesMastered >= stats.lineCount);
    return {
      index,
      title: item.title,
      artist: item.artist,
      key,
      status: song ? "ready" : "needs-lyrics",
      songId: song?.id || null,
      masteryPercent: stats?.masteryPercent || 0,
      linesMastered: stats?.linesMastered || 0,
      lineCount: stats?.lineCount || 0,
      bestScore: stats?.bestScore || 0,
      mastered
    };
  });
}

export function concertSummary(slots) {
  const total = slots.length;
  const mastered = slots.filter((slot) => slot.mastered).length;
  const score = slots.reduce((sum, slot) => sum + (slot.bestScore || 0), 0);
  const ready = slots.filter((slot) => slot.status === "ready").length;
  return {
    total,
    mastered,
    score,
    ready,
    needsLyrics: total - ready
  };
}

export function concertsForSong(concerts, title, artist) {
  const key = songKey(title, artist);
  return (concerts || []).filter((concert) => concert.setlist.some((item) => songKey(item.title, item.artist) === key));
}

export function leaderboardFromSongScores(songScores, setlist) {
  const players = new Map();
  for (const row of songScores || []) {
    const playerName = clip(row.playerName, 40);
    if (!playerName) continue;
    const id = playerName.toLowerCase();
    if (!players.has(id)) players.set(id, { playerName, slots: new Map() });
    const player = players.get(id);
    const key = songKey(row.songTitle, row.songArtist);
    const score = Math.max(0, Math.round(Number(row.score) || 0));
    player.slots.set(key, Math.max(player.slots.get(key) || 0, score));
  }
  const rows = [];
  for (const player of players.values()) {
    let score = 0;
    let played = 0;
    for (const slot of setlist || []) {
      const value = player.slots.get(songKey(slot.title, slot.artist)) || 0;
      if (value > 0) played += 1;
      score += value;
    }
    if (score > 0) rows.push({ playerName: player.playerName, score, played, total: (setlist || []).length });
  }
  rows.sort((a, b) => b.score - a.score || b.played - a.played || a.playerName.localeCompare(b.playerName));
  return rows;
}

export function activeConcertSummary(concert, songs, progress) {
  const slots = linkSetlist(concert, songs, progress);
  return { slots, ...concertSummary(slots) };
}
