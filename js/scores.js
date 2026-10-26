import { bestSongMatch, concertsForSong } from "./concerts.js?v=4";
import { songStats } from "./progress.js?v=4";
import { clip, safeConcertId, songKey } from "./text.js?v=4";

const GAMES = new Set(["fill", "order", "next", "letters", "concert", "sections", "lines"]);
export const REMOTE_SCORE_KEYS = ["player_name", "concert", "song_title", "artist", "score"];

export function sanitizeRun(entry) {
  return {
    id: String(entry?.id || ""),
    playerId: String(entry?.playerId || ""),
    playerName: clip(entry?.playerName, 40),
    songTitle: clip(entry?.songTitle, 120),
    songArtist: clip(entry?.songArtist, 120),
    songKey: songKey(entry?.songTitle, entry?.songArtist),
    gameId: GAMES.has(entry?.gameId) ? entry.gameId : "fill",
    score: Math.max(0, Math.round(Number(entry?.score) || 0)),
    xp: Math.max(0, Math.round(Number(entry?.xp) || 0)),
    createdAt: typeof entry?.createdAt === "string" ? entry.createdAt : new Date().toISOString()
  };
}

export function toRemoteScore(entry) {
  return {
    player_name: clip(entry?.playerName, 40),
    concert: clip(entry?.concertId, 80),
    song_title: clip(entry?.songTitle, 120),
    artist: clip(entry?.songArtist, 120),
    score: Math.max(0, Math.round(Number(entry?.score) || 0))
  };
}

export function remoteRowsForRun(entry, concerts) {
  return concertsForSong(concerts, entry?.songTitle, entry?.songArtist).map((concert) => toRemoteScore({
    ...entry,
    concertId: concert.id
  }));
}

export function createDeviceProvider(getState, saveState) {
  return {
    source: "device",
    sourceLabel: "On this device",
    async songScores({ concert }) {
      const state = getState();
      const rows = [];
      for (const player of state.players || []) {
        const progress = state.progress?.[player.id];
        if (!progress) continue;
        for (const slot of concert?.setlist || []) {
          const song = bestSongMatch(state.songs, slot.title, slot.artist);
          if (!song) continue;
          const stats = songStats(progress, song);
          if (stats.bestScore <= 0) continue;
          rows.push({
            playerName: player.name,
            concertId: concert.id,
            songTitle: slot.title,
            songArtist: slot.artist,
            score: stats.bestScore
          });
        }
      }
      return rows;
    },
    async participantCount({ concert }) {
      const scores = await this.songScores({ concert });
      return new Set(scores.map((row) => row.playerName.trim().toLowerCase()).filter(Boolean)).size;
    },
    async submitRun(entry) {
      const state = getState();
      const run = sanitizeRun(entry);
      state.leaderboard ||= [];
      state.leaderboard.push(run);
      if (state.leaderboard.length > 300) {
        state.leaderboard.splice(0, state.leaderboard.length - 300);
      }
      saveState(state);
      return run;
    },
    async listRuns() {
      return (getState().leaderboard || []).map(sanitizeRun);
    }
  };
}

function supabaseBase(url) {
  const base = new URL(url);
  base.search = "";
  base.hash = "";
  return base;
}

export function createSupabaseProvider({ url, anonKey, fetchImpl = fetch }) {
  if (!url || !anonKey) throw new Error("Supabase needs a URL and anon key.");
  const base = supabaseBase(url);
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "Content-Type": "application/json"
  };
  const endpoint = new URL("/rest/v1/scores", base);

  return {
    source: "shared",
    sourceLabel: "Shared",
    async songScores({ concert }) {
      const concertId = safeConcertId(concert?.id);
      const query = new URL(endpoint);
      query.searchParams.set("select", REMOTE_SCORE_KEYS.join(","));
      query.searchParams.set("concert", `eq.${concertId}`);
      query.searchParams.set("limit", "1000");
      const response = await fetchImpl(query, { headers });
      if (!response.ok) throw new Error("Could not load shared scores.");
      const data = await response.json();
      return (Array.isArray(data) ? data : []).map((row) => ({
        playerName: clip(row.player_name, 40),
        concertId: clip(row.concert, 80),
        songTitle: clip(row.song_title, 120),
        songArtist: clip(row.artist, 120),
        score: Math.max(0, Math.round(Number(row.score) || 0))
      }));
    },
    async participantCount({ concert }) {
      const scores = await this.songScores({ concert });
      return new Set(scores.map((row) => row.playerName.trim().toLowerCase()).filter(Boolean)).size;
    },
    async submitRun(entry, concerts) {
      const rows = remoteRowsForRun(entry, concerts);
      if (!rows.length) return [];
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(rows)
      });
      if (!response.ok) throw new Error("Could not share that score.");
      return rows;
    },
    async listRuns() {
      return [];
    }
  };
}

// v1 always practices against this device. Pass a Supabase URL and anon key
// here later to switch concert scores and participant counts to the shared board.
// Do not commit keys. Remote rows are limited to name, concert, title, artist, and score.
export function createScoreProvider(getState, saveState) {
  return createDeviceProvider(getState, saveState);
}
