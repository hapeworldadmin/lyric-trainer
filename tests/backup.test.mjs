import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryBoardStore, handleLeaderboard, sanitizeBackup } from "../js/board-logic.js";
import { applyBackupRecords, backupRecords, emptyProgress } from "../js/progress.js";
import { lineIdentity } from "../js/identity.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";

test("cloud backup stores levels only and drops lyric text", async () => {
  const id = lineIdentity("Paper Moon", "House Band", 1, 1, "alpha one two");
  const dirty = sanitizeBackup({
    "paper moon|house band": {
      [id]: { level: 2, due: 50, misses: 1 }
    },
    "other|band": {
      [id]: { level: 4, line: "SENTINEL_LYRIC_LINE" }
    }
  });
  assert.equal(JSON.stringify(dirty).includes("SENTINEL_LYRIC_LINE"), false);
  assert.equal(dirty["other|band"], undefined);
  assert.equal(dirty["paper moon|house band"][id].level, 2);
  const store = createMemoryBoardStore();
  const saved = await handleLeaderboard({
    method: "POST",
    body: { action: "backup", deviceId: DEVICE, records: dirty },
    store,
    now: 1000
  });
  assert.equal(saved.status, 200);
  const loaded = await handleLeaderboard({
    method: "POST",
    body: { action: "restore", deviceId: DEVICE },
    store,
    now: 2000
  });
  assert.equal(loaded.body.records["paper moon|house band"][id].misses, 1);
  const song = {
    title: "Paper Moon",
    artist: "House Band",
    lines: ["alpha one two", "beta three four"],
    sections: ["Verse", "Verse"]
  };
  const progress = emptyProgress();
  const changed = applyBackupRecords(progress, [song], loaded.body.records);
  assert.equal(changed, 1);
  const kept = lineIdentity(song.title, song.artist, 1, 1, song.lines[0]);
  assert.equal(progress.songs["paper moon|house band"].recall[kept].level, 2);
  const moved = applyBackupRecords(progress, [{ ...song, lines: ["other line here", "beta three four"] }], loaded.body.records);
  assert.equal(moved, 0);
});

test("a backup file from this device has no lyric lines", () => {
  const progress = emptyProgress();
  const song = { title: "Paper Moon", artist: "House Band", lines: ["alpha one two"], sections: ["Verse"] };
  const id = lineIdentity(song.title, song.artist, 1, 1, song.lines[0]);
  progress.songs["paper moon|house band"] = {
    title: song.title,
    artist: song.artist,
    recall: { [id]: { level: 1, due: 9, misses: 0, lastPass: 0, ladder: 0, learned: false, hardPass: 0 } }
  };
  const json = JSON.stringify(backupRecords(progress));
  assert.equal(json.includes("alpha one two"), false);
  assert.equal(json.includes(id), true);
});
