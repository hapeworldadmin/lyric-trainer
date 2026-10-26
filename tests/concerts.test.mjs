import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeConcertSummary, concertsForSong, leaderboardFromSongScores, linkSetlist, normalizeConcerts } from "../js/concerts.js";
import { emptyProgress, recordLineResult, recordRun } from "../js/progress.js";
import { SAMPLE_SONG } from "../js/sample.js";
import { createDeviceProvider, createScoreProvider, createSupabaseProvider, REMOTE_SCORE_KEYS } from "../js/scores.js";

const ASIA_TITLES = [
  "Soft",
  "Why",
  "Make Me Forget",
  "ex i never had",
  "up to me",
  "you!",
  "If You See Her",
  "I Don't Wanna Love You Anymore",
  "Prettiest Thing I've Ever Seen",
  "Thick and Thin",
  "dna",
  "Know You Naked",
  "When Did You Stop Loving Me?",
  "anything 4 u",
  "Stuck",
  "Sound of Rain",
  "Good Parts",
  "Let Me Know",
  "Super Far",
  "Mean It",
  "Last Forever",
  "Act My Age",
  "13",
  "Good Girls",
  "ILYSB (Stripped)",
  "pink skies",
  "Destiny",
  "Alonica",
  "'Cause You Have To",
  "Malibu Nights",
  "XXL"
];

const SETLIST_SOURCE = "https://www.setlist.fm/setlist/lany/2026/echo-land-music-park-shanghai-china-3b7feca4.html";

test("ships the Asia tour setlist with titles and artists only", () => {
  const file = JSON.parse(readFileSync(new URL("../concerts.json", import.meta.url), "utf8"));
  const concerts = normalizeConcerts(file);
  assert.equal(concerts.length, 1);
  assert.equal(concerts[0].id, "lany-soft-world-tour");
  assert.equal(concerts[0].name, "LANY Soft World Tour");
  assert.equal(concerts[0].label, "Standard Asia Tour setlist");
  assert.equal(concerts[0].source, SETLIST_SOURCE);
  assert.deepEqual(concerts[0].setlist.map((slot) => slot.title), ASIA_TITLES);
  assert.ok(concerts[0].setlist.every((slot) => slot.artist === "LANY"));
  assert.equal(concerts[0].setlist.some((slot) => "lyrics" in slot || "lines" in slot), false);
  for (const line of SAMPLE_SONG.lines) assert.equal(JSON.stringify(file).includes(line), false);
});

test("pasted songs match setlist titles despite case, punctuation, and parentheticals", () => {
  const concert = normalizeConcerts(JSON.parse(readFileSync(new URL("../concerts.json", import.meta.url), "utf8")))[0];
  const songs = [
    { id: "ilysb", title: "ILYSB", artist: "lany", lines: ["line one"] },
    { id: "cause", title: "Cause You Have To", artist: "LANY", lines: ["line one"] },
    { id: "you", title: "YOU", artist: "Lany", lines: ["line one"] },
    { id: "good", title: "Good", artist: "LANY", lines: ["line one"] },
    { id: "soft-other", title: "Soft", artist: "Other Band", lines: ["line one"] }
  ];
  const slots = linkSetlist(concert, songs, emptyProgress());
  const slot = (title) => slots.find((item) => item.title === title);
  assert.equal(slot("ILYSB (Stripped)").status, "ready");
  assert.equal(slot("ILYSB (Stripped)").songId, "ilysb");
  assert.equal(slot("'Cause You Have To").status, "ready");
  assert.equal(slot("'Cause You Have To").songId, "cause");
  assert.equal(slot("you!").status, "ready");
  assert.equal(slot("you!").songId, "you");
  assert.equal(slot("Good Girls").status, "needs-lyrics");
  assert.equal(slot("Good Parts").status, "needs-lyrics");
  assert.equal(slot("Soft").status, "needs-lyrics");
  assert.equal(concertsForSong([concert], "ilysb", "LANY").length, 1);
  assert.equal(concertsForSong([concert], "Soft", "Other Band").length, 0);

  const board = leaderboardFromSongScores([
    { playerName: "Alex", songTitle: "ILYSB", songArtist: "lany", score: 40 },
    { playerName: "Alex", songTitle: "Cause You Have To", songArtist: "LANY", score: 10 },
    { playerName: "Alex", songTitle: "Good", songArtist: "LANY", score: 99 },
    { playerName: "Alex", songTitle: "Soft", songArtist: "Other Band", score: 80 }
  ], concert.setlist);
  assert.deepEqual(board.map((row) => [row.playerName, row.score, row.played]), [["Alex", 50, 2]]);
});

test("setlist slots need lyrics until a pasted song matches, then they link", () => {
  const concert = normalizeConcerts({
    concerts: [{
      id: "house-show",
      name: "House Show",
      setlist: [
        { title: SAMPLE_SONG.title, artist: SAMPLE_SONG.artist, lyrics: "SENTINEL_LYRIC_LINE", lines: ["SENTINEL_LYRIC_LINE"] },
        { title: "Paper Moonfish", artist: "House Band" }
      ]
    }]
  })[0];
  assert.deepEqual(concert.setlist[0], { title: SAMPLE_SONG.title, artist: SAMPLE_SONG.artist });
  const songs = [{ id: "s1", title: SAMPLE_SONG.title, artist: SAMPLE_SONG.artist, lines: [...SAMPLE_SONG.lines] }];
  const progress = emptyProgress();
  let summary = activeConcertSummary(concert, songs, progress);
  assert.equal(summary.slots[0].status, "ready");
  assert.equal(summary.slots[1].status, "needs-lyrics");
  assert.equal(summary.mastered, 0);
  assert.equal(summary.total, 2);
  assert.equal(summary.score, 0);

  for (const line of songs[0].lines) {
    recordLineResult(progress, songs[0], { line, correct: true, xpGain: 1 });
    recordLineResult(progress, songs[0], { line, correct: true, xpGain: 1 });
  }
  recordRun(progress, songs[0], { score: 500, gameId: "concert" });
  summary = activeConcertSummary(concert, songs, progress);
  assert.equal(summary.slots[0].mastered, true);
  assert.equal(summary.mastered, 1);
  assert.equal(summary.needsLyrics, 1);
  assert.equal(summary.score, 500);
  assert.equal(JSON.stringify(summary).includes("SENTINEL_LYRIC_LINE"), false);
});

test("concert leaderboard sums the best score per setlist song", () => {
  const setlist = [
    { title: SAMPLE_SONG.title, artist: SAMPLE_SONG.artist },
    { title: "Paper Moonfish", artist: "House Band" }
  ];
  const rows = leaderboardFromSongScores([
    { playerName: "Alex", songTitle: SAMPLE_SONG.title, songArtist: SAMPLE_SONG.artist, score: 200, lyrics: "SENTINEL_LYRIC_LINE" },
    { playerName: "Alex", songTitle: SAMPLE_SONG.title, songArtist: SAMPLE_SONG.artist, score: 480 },
    { playerName: "Sam", songTitle: "Paper Moonfish", songArtist: "House Band", score: 90 }
  ], setlist);
  assert.deepEqual(rows.map((row) => [row.playerName, row.score]), [["Alex", 480], ["Sam", 90]]);
  assert.equal(JSON.stringify(rows).includes("SENTINEL_LYRIC_LINE"), false);
});

test("device scores and a future Supabase row stay limited to name, concert, title, artist, and score", async () => {
  const state = {
    players: [{ id: "p1", name: "Alex" }, { id: "p2", name: "Sam" }],
    songs: [{ id: "s1", title: SAMPLE_SONG.title, artist: SAMPLE_SONG.artist, lines: [...SAMPLE_SONG.lines] }],
    progress: {
      p1: emptyProgress(),
      p2: emptyProgress()
    },
    leaderboard: []
  };
  recordRun(state.progress.p1, state.songs[0], { score: 320, gameId: "fill" });
  const concert = {
    id: "lany-soft-world-tour",
    name: "LANY Soft World Tour",
    setlist: [{ title: SAMPLE_SONG.title, artist: SAMPLE_SONG.artist }]
  };
  let saved = 0;
  const device = createDeviceProvider(() => state, () => { saved += 1; });
  assert.equal(createScoreProvider(() => state, () => {}).source, "device");
  const scores = await device.songScores({ concert });
  assert.equal(scores.length, 1);
  assert.equal(scores[0].score, 320);
  assert.equal(await device.participantCount({ concert }), 1);
  await device.submitRun({
    id: "run-1",
    playerId: "p1",
    playerName: "Alex",
    songTitle: SAMPLE_SONG.title,
    songArtist: SAMPLE_SONG.artist,
    gameId: "fill",
    score: 320,
    lines: ["SENTINEL_LYRIC_LINE"]
  });
  assert.equal(saved, 1);
  assert.equal(JSON.stringify(state.leaderboard).includes("SENTINEL_LYRIC_LINE"), false);

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body || "" });
    if ((options.method || "GET") === "POST") return { ok: true };
    return {
      ok: true,
      async json() {
        return [{
          player_name: "Sam",
          concert: concert.id,
          song_title: SAMPLE_SONG.title,
          artist: SAMPLE_SONG.artist,
          score: 10,
          lyrics: "SENTINEL_LYRIC_LINE"
        }];
      }
    };
  };
  const remote = createSupabaseProvider({ url: "https://example.supabase.co", anonKey: "public-anon", fetchImpl });
  const shared = await remote.songScores({ concert });
  assert.equal(JSON.stringify(shared).includes("SENTINEL_LYRIC_LINE"), false);
  assert.deepEqual(Object.keys(shared[0]).sort(), ["concertId", "playerName", "score", "songArtist", "songTitle"]);
  const posted = await remote.submitRun({
    playerName: "Alex",
    songTitle: SAMPLE_SONG.title,
    songArtist: SAMPLE_SONG.artist,
    score: 320,
    lines: ["SENTINEL_LYRIC_LINE"]
  }, [concert]);
  assert.deepEqual(Object.keys(posted[0]).sort(), [...REMOTE_SCORE_KEYS].sort());
  assert.equal(posted[0].concert, concert.id);
  assert.equal(JSON.stringify(calls).includes("SENTINEL_LYRIC_LINE"), false);
  assert.equal(await remote.participantCount({ concert }), 1);
});
