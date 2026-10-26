import assert from "node:assert/strict";
import test from "node:test";
import { buildLesson } from "../js/games.js";
import {
  buildExport,
  emptyProgress,
  masteredRoundIds,
  mergeImport,
  nextStreak,
  recordLineResult,
  recordRoundResult,
  recordRun,
  resetLineMasteryIfChanged,
  retitleSongProgress,
  songStats
} from "../js/progress.js";
import { SAMPLE_SONG } from "../js/sample.js";
import { loadState, saveState } from "../js/storage.js";
import { songKey } from "../js/text.js";

const song = {
  id: "sample",
  title: SAMPLE_SONG.title,
  artist: SAMPLE_SONG.artist,
  lines: [...SAMPLE_SONG.lines]
};

test("streak grows on consecutive days and resets after a gap", () => {
  const first = nextStreak({ count: 0, lastDate: null }, new Date(2026, 9, 24));
  assert.deepEqual(first, { count: 1, lastDate: "2026-10-24" });
  const same = nextStreak(first, new Date(2026, 9, 24, 18));
  assert.equal(same.count, 1);
  const next = nextStreak(first, new Date(2026, 9, 25));
  assert.equal(next.count, 2);
  const reset = nextStreak(next, new Date(2026, 9, 27));
  assert.equal(reset.count, 1);
});

test("two correct answers master a line and best score only rises", () => {
  const progress = emptyProgress();
  recordLineResult(progress, song, { line: song.lines[0], correct: true, xpGain: 10 });
  let stats = songStats(progress, song);
  assert.equal(stats.linesMastered, 0);
  assert.equal(stats.masteryPercent, Math.round(100 * 0.5 / song.lines.length));
  recordLineResult(progress, song, { line: song.lines[0], correct: true, xpGain: 10 });
  stats = songStats(progress, song);
  assert.equal(stats.linesMastered, 1);
  assert.equal(stats.masteryPercent, Math.round(100 / song.lines.length));
  assert.equal(progress.totalXp, 20);
  const lower = recordRun(progress, song, { score: 80, gameId: "fill" });
  assert.equal(lower.isNewBest, true);
  const again = recordRun(progress, song, { score: 40, gameId: "fill" });
  assert.equal(again.isNewBest, false);
  assert.equal(songStats(progress, song).bestScore, 80);
});

test("export and import keep scores and drop lyric text", () => {
  const progress = emptyProgress();
  for (const line of song.lines) {
    recordLineResult(progress, song, { line, correct: true, xpGain: 1 });
    recordLineResult(progress, song, { line, correct: true, xpGain: 1 });
  }
  recordRun(progress, song, { score: 640, gameId: "concert" });
  const state = {
    activePlayerId: "p1",
    players: [{ id: "p1", name: "Alex" }],
    songs: [song],
    progress: { p1: progress },
    leaderboard: []
  };
  const exported = buildExport(state);
  const json = JSON.stringify(exported);
  for (const line of SAMPLE_SONG.lines) assert.equal(json.includes(line), false);
  assert.equal(json.includes('"lines"'), false);
  assert.equal(exported.progress.p1.songs[songKey(song.title, song.artist)].bestScore, 640);
  assert.equal(exported.progress.p1.songs[songKey(song.title, song.artist)].linesMastered, song.lines.length);

  const fresh = {
    players: [{ id: "p1", name: "Alex" }],
    songs: [],
    progress: { p1: emptyProgress() },
    leaderboard: []
  };
  mergeImport(fresh, {
    ...exported,
    progress: {
      p1: {
        ...exported.progress.p1,
        songs: {
          ...exported.progress.p1.songs,
          extra: {
            title: "Glowstick Goldfish",
            artist: "House Band",
            bestScore: 15,
            lines: ["SENTINEL_LYRIC_LINE"],
            lyrics: "SENTINEL_LYRIC_LINE"
          }
        }
      }
    }
  });
  const stored = JSON.stringify(fresh);
  assert.equal(stored.includes("SENTINEL_LYRIC_LINE"), false);
  for (const line of SAMPLE_SONG.lines) assert.equal(stored.includes(line), false);
  assert.equal(fresh.songs.length, 0);
  assert.equal(fresh.progress.p1.totalXp, progress.totalXp);
});

test("renaming a song keeps the score and editing lines resets mastery", () => {
  const progress = emptyProgress();
  recordRun(progress, song, { score: 50, gameId: "order" });
  recordLineResult(progress, song, { line: song.lines[0], correct: true, xpGain: 5 });
  recordLineResult(progress, song, { line: song.lines[0], correct: true, xpGain: 5 });
  const players = { p1: progress };
  retitleSongProgress(players, song.title, song.artist, "Glowstick Goldfish", song.artist);
  assert.equal(progress.songs[songKey("Glowstick Goldfish", song.artist)].bestScore, 50);
  assert.equal(songStats(progress, { ...song, title: "Glowstick Goldfish" }).linesMastered, 1);
  resetLineMasteryIfChanged(players, "Glowstick Goldfish", song.artist, song.lines, ["A brand new invented line", "Another invented line"]);
  assert.equal(songStats(progress, { title: "Glowstick Goldfish", artist: song.artist, lines: ["A brand new invented line", "Another invented line"] }).linesMastered, 0);
  assert.equal(songStats(progress, { title: "Glowstick Goldfish", artist: song.artist, lines: ["A brand new invented line", "Another invented line"] }).bestScore, 50);
});

test("round mastery persists for the same lyrics and is skipped next time", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => mem.set(key, String(value))
  };
  const state = loadState();
  const sample = state.songs.find((item) => item.sample);
  const first = buildLesson(sample.lines, "lines", () => 0.4, sample.sections).find((question) => question.kind === "lines");
  const repaste = buildLesson([...sample.lines], "lines", () => 0.9, [...sample.sections]).find((question) => question.kind === "lines");
  assert.equal(repaste.roundId, first.roundId);
  const progress = state.progress[state.activePlayerId];
  assert.equal(recordRoundResult(progress, sample, { roundId: first.roundId, mistakes: 1, completed: true }).mastered, true);
  assert.equal(recordRoundResult(progress, sample, { roundId: "round-b", mistakes: 2, completed: true }).mastered, false);
  saveState(state);
  const loaded = loadState();
  const again = loaded.songs.find((item) => item.id === sample.id);
  const ids = masteredRoundIds(loaded.progress[loaded.activePlayerId], again);
  assert.deepEqual(ids, [first.roundId]);
  const skipped = buildLesson(again.lines, "lines", () => 0.4, again.sections, { skipIds: ids });
  assert.equal(skipped.some((question) => question.roundId === first.roundId), false);
  const stored = JSON.stringify(JSON.parse(mem.get("lyric-trainer-v1")).progress);
  for (const line of SAMPLE_SONG.lines) assert.equal(stored.includes(line), false);
});

test("saved progress survives a fresh load", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => mem.set(key, String(value))
  };
  const state = loadState();
  const sample = state.songs.find((item) => item.sample);
  assert.ok(sample);
  assert.equal(sample.lines.length, SAMPLE_SONG.lines.length);
  recordRun(state.progress[state.activePlayerId], sample, { score: 123, gameId: "fill" });
  state.progress[state.activePlayerId].totalXp = 45;
  state.progress[state.activePlayerId].streak = { count: 4, lastDate: "2026-10-26" };
  saveState(state);
  const loaded = loadState();
  const again = loaded.songs.find((item) => item.id === sample.id);
  assert.equal(loaded.progress[loaded.activePlayerId].totalXp, 45);
  assert.equal(loaded.progress[loaded.activePlayerId].streak.count, 4);
  assert.equal(songStats(loaded.progress[loaded.activePlayerId], again).bestScore, 123);
  assert.deepEqual(again.lines, SAMPLE_SONG.lines);
});
