import assert from "node:assert/strict";
import test from "node:test";
import { validateRunPayload } from "../js/board-logic.js";
import { fullSteps } from "../js/map.js";
import { shareText } from "../js/share.js";
import { SAMPLE_SONG } from "../js/sample.js";

const song = {
  title: "Paper Moon",
  artist: "House Band",
  lines: ["alpha one two", "beta three four", "hook line alpha", "hook line beta", "bridge nine ten", "hook line alpha", "hook line beta"],
  sections: ["Verse", "Verse", "Chorus", "Chorus", "Bridge", "Chorus", "Chorus"]
};

test("a full run includes every repeat and opens each section cold", () => {
  const steps = fullSteps(song, {});
  assert.equal(steps.length, song.lines.length);
  assert.equal(steps.filter((step) => step.coldOpen).length, 4);
  assert.equal(steps[0].level, 4);
  assert.equal(steps[2].coldOpen, true);
  assert.equal(steps[5].coldOpen, true);
  assert.equal(steps[5].sectionNumber, steps[2].sectionNumber);
});

test("the board rejects an impossible run and keeps lyric text out", () => {
  const good = validateRunPayload({
    title: "Paper Moon",
    artist: "House Band",
    score: 20,
    xp: 40,
    accuracy: 0.5,
    lineCount: 2,
    times: [800, 900],
    totalMs: 1700
  });
  assert.equal(good.ok, true);
  assert.equal(good.value.times.join(","), "800,900");
  assert.equal(validateRunPayload({ ...good.value, title: "Paper Moon", artist: "House Band", times: [100, 900], lineCount: 2, totalMs: 1000 }).ok, false);
  assert.equal(validateRunPayload({ ...good.value, title: "Paper Moon", artist: "House Band", score: 999, lineCount: 2, times: [800, 900] }).ok, false);
  const text = shareText({
    kind: "song",
    playerName: "Alex",
    title: song.title,
    artist: song.artist,
    score: 20,
    streak: 1,
    accuracy: 80,
    elapsed: 65000,
    detail: "Full run"
  });
  assert.match(text, /80% correct/);
  assert.match(text, /1m 5s/);
  for (const line of song.lines) assert.equal(text.includes(line), false);
  for (const line of SAMPLE_SONG.lines) assert.equal(JSON.stringify(good.value).includes(line), false);
});
