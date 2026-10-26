import { songStats } from "./progress.js?v=7";
import { clip, normalizeAnswer, safeConcertId, slug, songKey, songsMatch } from "./text.js?v=7";

export function normalizeConcerts(data) {
  const list = Array.isArray(data) ? data : data?.concerts;
  if (!Array.isArray(list)) return [];
  const used = new Set();
  const concerts = [];
  for (const raw of list) {
    if (!raw || typeof raw.name !== "string" || !raw.name.trim()) continue;
    const name = clip(raw.name, 80);
    const label = typeof raw.label === "string" ? clip(raw.label, 80) : "";
    const sourceText = typeof raw.source === "string" ? raw.source.trim() : "";
    const source = /^https:\/\/\S+$/.test(sourceText) ? clip(sourceText, 300) : "";
    const accent = /^#[0-9a-fA-F]{6}$/.test(raw.accent || "") ? raw.accent.toUpperCase() : "";
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
    concerts.push({ id, name, label, source, accent, setlist });
  }
  return concerts;
}

export function bestSongMatch(songs, title, artist) {
  let best = null;
  let bestRank = 0;
  for (const song of songs || []) {
    if (!song || !songsMatch(song.title, song.artist, title, artist)) continue;
    const rank = normalizeAnswer(song.title) === normalizeAnswer(title) ? 2 : 1;
    if (rank > bestRank) {
      best = song;
      bestRank = rank;
    }
  }
  return best;
}

export function linkSetlist(concert, songs, progress) {
  return (concert?.setlist || []).map((item, index) => {
    const key = songKey(item.title, item.artist);
    const song = bestSongMatch(songs, item.title, item.artist);
    const stats = song ? songStats(progress || { songs: {} }, song) : null;
    const mastered = Boolean(stats?.songMastered);
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
  return (concerts || []).filter((concert) => (concert.setlist || []).some((item) => songsMatch(item.title, item.artist, title, artist)));
}

export function leaderboardFromSongScores(songScores, setlist) {
  const players = new Map();
  for (const row of songScores || []) {
    const playerName = clip(row.playerName, 40);
    if (!playerName) continue;
    const id = playerName.toLowerCase();
    if (!players.has(id)) players.set(id, { playerName, entries: [] });
    players.get(id).entries.push({
      title: clip(row.songTitle, 120),
      artist: clip(row.songArtist, 120),
      score: Math.max(0, Math.round(Number(row.score) || 0))
    });
  }
  const slots = setlist || [];
  const rows = [];
  for (const player of players.values()) {
    const bestBySlot = new Map();
    for (const entry of player.entries) {
      let chosen = -1;
      let rank = 0;
      slots.forEach((slot, index) => {
        if (!songsMatch(entry.title, entry.artist, slot.title, slot.artist)) return;
        const exact = normalizeAnswer(entry.title) === normalizeAnswer(slot.title) ? 2 : 1;
        if (exact > rank) {
          rank = exact;
          chosen = index;
        }
      });
      if (chosen < 0) continue;
      bestBySlot.set(chosen, Math.max(bestBySlot.get(chosen) || 0, entry.score));
    }
    let score = 0;
    for (const value of bestBySlot.values()) score += value;
    const played = bestBySlot.size;
    if (score > 0) rows.push({ playerName: player.playerName, score, played, total: (setlist || []).length });
  }
  rows.sort((a, b) => b.score - a.score || b.played - a.played || a.playerName.localeCompare(b.playerName));
  return rows;
}

export function concertStatusLine(summary) {
  if (!summary?.total) return "No setlist posted yet";
  if (!summary.ready && !summary.mastered) return "Add lyrics to your first song";
  return `${summary.mastered}/${summary.total} mastered`;
}

export function activeConcertSummary(concert, songs, progress) {
  const slots = linkSetlist(concert, songs, progress);
  return { slots, ...concertSummary(slots) };
}
