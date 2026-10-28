import assert from "node:assert/strict";
import test from "node:test";
import { pickDecoyLines } from "../js/decoy.js";
import { applyMiss, applyPass, askedLevel, DAY_MS, INTERVALS_MS } from "../js/memory.js";
import {
  buildRecallQuestion,
  createRun,
  finishReveal,
  judgeRecallTile,
  missRun,
  passRun,
  recallSingMatch,
  sectionIsFresh
} from "../js/recall.js";
import { seededRng } from "../js/games.js";

const song = {
  title: "Paper Moon",
  artist: "House Band",
  lines: [
    "alpha one two",
    "beta three four",
    "gamma five six",
    "delta seven eight",
    "hook line alpha",
    "hook line beta",
    "bridge nine ten",
    "bridge eleven twelve",
    "hook line alpha",
    "hook line beta"
  ],
  sections: ["Verse", "Verse", "Verse", "Verse", "Chorus", "Chorus", "Bridge", "Bridge", "Chorus", "Chorus"]
};

test("a pass climbs one level and a miss drops back to ten minutes", () => {
  const now = 1_700_000_000_000;
  const first = applyPass(null, { levelAsked: 0, now });
  assert.equal(first.level, 1);
  assert.equal(first.due - now, INTERVALS_MS[0]);
  const second = applyPass(first, { levelAsked: 1, now: now + 1000 });
  assert.equal(second.level, 2);
  assert.equal(second.due - (now + 1000), INTERVALS_MS[1]);
  const missed = applyMiss(second, now + 2000);
  assert.equal(missed.level, 1);
  assert.equal(missed.due - (now + 2000), INTERVALS_MS[0]);
  assert.equal(missed.ladder, 0);
});

test("two hard passes in one session do not count as learned", () => {
  const now = 1_700_000_000_000;
  const once = applyPass({ level: 3 }, { levelAsked: 3, now });
  assert.equal(once.learned, false);
  const twice = applyPass(once, { levelAsked: 4, now: now + 60 * 1000 });
  assert.equal(twice.learned, false);
  const later = applyPass(twice, { levelAsked: 4, now: now + DAY_MS + 1 });
  assert.equal(later.learned, true);
});

test("a new section starts at recognize or cue", () => {
  assert.equal(sectionIsFresh(song, {}, 1), true);
  assert.equal(askedLevel({ level: 4 }, true), 1);
  assert.equal(askedLevel({ level: 4 }, false), 4);
  const run = createRun({ song, sectionNumber: 1, recall: {}, hearts: 5 });
  assert.equal(run.steps.every((step) => step.level <= 1), true);
  assert.equal(run.hearts, 5);
});

test("decoys stay inside the song and a run rewinds to the checkpoint", () => {
  const rng = seededRng(3);
  const decoys = pickDecoyLines(song.lines, song.sections, 1, 3, rng);
  assert.equal(decoys.length, 3);
  assert.equal(new Set(decoys).size, 3);
  assert.equal(decoys.includes(song.lines[1]), false);
  const run = createRun({ song, sectionNumber: 1, recall: {}, hearts: 2 });
  let state = passRun(run, { now: 10 }).state;
  assert.equal(state.cursor, 1);
  assert.equal(state.checkpoint, 0);
  const missed = missRun(state, { now: 50 });
  assert.equal(missed.state.hearts, 1);
  assert.equal(missed.effect, "rewind");
  const back = finishReveal(missed.state);
  assert.equal(back.cursor, state.checkpoint);
  assert.equal(back.combo, 0);
  const cold = buildRecallQuestion(song, { index: 4, identity: "x", level: 4, sectionNumber: 2 }, rng);
  assert.equal(cold.previous, "");
  assert.equal(cold.format, "tiles");
  assert.equal(cold.allowType, true);
  const tiles = buildRecallQuestion(song, { index: 1, identity: "y", level: 3, sectionNumber: 1 }, rng);
  assert.equal(tiles.format, "tiles");
  assert.equal(tiles.tiles.some((tile) => tile.decoy), false);
  assert.equal(judgeRecallTile(tiles, [], tiles.solution[0]), true);
});

test("sung answers ignore filler words and still need the line in order", () => {
  assert.equal(recallSingMatch("alpha one two", "uh alpha um one two"), true);
  assert.equal(recallSingMatch("alpha one two", "two one alpha"), false);
});
