import assert from "node:assert/strict";
import test from "node:test";
import { checksumHex, editSummary, identitiesForSong, isLineIdentity, lineChecksum, lineIdentity } from "../js/identity.js";
import { applyLineEdit, buildExport, emptyProgress, mergeImport } from "../js/progress.js";
import { migrateState } from "../js/schema.js";
import { loadState, saveState } from "../js/storage.js";
import { SAMPLE_SONG } from "../js/sample.js";
import { songKey } from "../js/text.js";

test("line identity is a song key, section, line number, and 16-bit checksum", () => {
  const sum = lineChecksum("Bright paper boats");
  assert.equal(sum, sum & 0xffff);
  assert.equal(checksumHex("Bright paper boats"), checksumHex("bright paper boats!"));
  const id = lineIdentity("Paper Moon", "House Band", 2, 3, "Bright paper boats");
  assert.equal(isLineIdentity(id), true);
  assert.equal(id.includes("Bright"), false);
  assert.match(id, /#2\.3\.[0-9a-f]{4}$/);
});

test("a repeated chorus shares one section number", () => {
  const song = {
    title: "Paper Moon",
    artist: "House Band",
    lines: ["verse line one here", "chorus line one here", "chorus line two here", "verse line two here", "chorus line one here", "chorus line two here"],
    sections: ["Verse", "Chorus", "Chorus", "Verse 2", "Chorus", "Chorus"]
  };
  const rows = identitiesForSong(song);
  assert.equal(rows[1].sectionNumber, rows[4].sectionNumber);
  assert.equal(rows[1].id, rows[4].id);
  assert.equal(rows[4].repeat, true);
  const stored = JSON.stringify(rows.map((row) => row.id));
  for (const line of song.lines) assert.equal(stored.includes(line), false);
});

test("editing keeps an unchanged line and resets a changed one", () => {
  const before = {
    title: "Paper Moon",
    artist: "House Band",
    lines: ["alpha one two", "beta three four", "gamma five six"],
    sections: ["Verse", "Verse", "Chorus"]
  };
  const after = {
    ...before,
    lines: ["alpha one two", "beta changed line", "gamma five six"]
  };
  const summary = editSummary(before, after);
  assert.equal(summary.kept, 2);
  assert.equal(summary.reset, 1);
  const progress = emptyProgress();
  const key = songKey(before.title, before.artist);
  const keptId = identitiesForSong(before)[0].id;
  const changedId = identitiesForSong(before)[1].id;
  progress.songs[key] = {
    title: before.title,
    artist: before.artist,
    bestScore: 10,
    bestByGame: {},
    xp: 4,
    lineStats: {},
    rounds: {},
    chapters: {},
    plays: 1,
    lastPlayedAt: null,
    imported: null,
    recall: {
      [keptId]: { level: 3, due: 5, misses: 0, lastPass: 5, ladder: 2, learned: false, hardPass: 0 },
      [changedId]: { level: 2, due: 5, misses: 1, lastPass: 4, ladder: 1, learned: false, hardPass: 0 }
    },
    sectionState: { 1: { boss: true, learned: true, runs: 1, warmed: true } }
  };
  const applied = applyLineEdit({ p1: progress }, before, after);
  assert.equal(applied.kept, 2);
  assert.equal(progress.songs[key].recall[keptId].level, 3);
  assert.equal(progress.songs[key].recall[changedId], undefined);
  assert.equal(progress.songs[key].bestScore, 10);
});

test("export and import carry recall records and drop lyric text", () => {
  const song = { title: SAMPLE_SONG.title, artist: SAMPLE_SONG.artist, lines: [...SAMPLE_SONG.lines], sections: [...SAMPLE_SONG.sections] };
  const progress = emptyProgress();
  const id = identitiesForSong(song)[0].id;
  const key = songKey(song.title, song.artist);
  progress.songs[key] = {
    title: song.title,
    artist: song.artist,
    bestScore: 12,
    bestByGame: {},
    xp: 3,
    lineStats: {},
    plays: 1,
    lastPlayedAt: null,
    recall: { [id]: { level: 2, due: 9, misses: 1, lastPass: 8, ladder: 1, learned: false, hardPass: 0 } }
  };
  const exported = buildExport({
    activePlayerId: "p1",
    players: [{ id: "p1", name: "Alex" }],
    songs: [song],
    progress: { p1: progress },
    leaderboard: []
  });
  const json = JSON.stringify(exported);
  for (const line of SAMPLE_SONG.lines) assert.equal(json.includes(line), false);
  assert.equal(json.includes('"lines"'), false);
  assert.equal(exported.version, 2);
  assert.equal(exported.progress.p1.songs[key].recall[id].level, 2);
  const fresh = { players: [{ id: "p1", name: "Alex" }], songs: [], progress: { p1: emptyProgress() }, leaderboard: [] };
  mergeImport(fresh, {
    ...exported,
    progress: {
      p1: {
        ...exported.progress.p1,
        songs: {
          ...exported.progress.p1.songs,
          extra: { title: "Glow", artist: "Band", bestScore: 1, lines: ["SENTINEL_LYRIC_LINE"], recall: { "nope": { level: 4, line: "SENTINEL_LYRIC_LINE" } } }
        }
      }
    }
  });
  const stored = JSON.stringify(fresh);
  assert.equal(stored.includes("SENTINEL_LYRIC_LINE"), false);
  assert.equal(fresh.progress.p1.songs[key].recall[id].level, 2);
});

test("schema migration is idempotent and keeps a saved score", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => mem.set(key, String(value))
  };
  const first = loadState();
  const sample = first.songs.find((song) => song.sample);
  first.progress[first.activePlayerId].totalXp = 7;
  saveState(first);
  const again = loadState();
  assert.equal(again.schemaVersion, 2);
  assert.equal(again.progress[again.activePlayerId].totalXp, 7);
  assert.equal(again.songs.find((song) => song.id === sample.id).lines.length, SAMPLE_SONG.lines.length);
  const twice = migrateState(migrateState(again));
  assert.equal(twice.schemaVersion, 2);
  assert.equal(twice.progress[twice.activePlayerId].totalXp, 7);
});
