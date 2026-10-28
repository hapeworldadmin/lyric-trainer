import assert from "node:assert/strict";
import test from "node:test";
import { bossSteps, dailySteps, dueRows, nextAction, songMap } from "../js/map.js";
import { applyPass } from "../js/memory.js";
import { finishReveal, missRun, startSession } from "../js/recall.js";
import { identitiesForSong } from "../js/identity.js";

const song = {
  title: "Paper Moon",
  artist: "House Band",
  lines: ["alpha one two", "beta three four", "hook line alpha", "hook line beta", "bridge nine ten"],
  sections: ["Verse", "Verse", "Chorus", "Chorus", "Bridge"]
};

test("the song map skips a learned section and offers the next step", () => {
  const rows = identitiesForSong(song).filter((row) => !row.repeat);
  const recall = {};
  const now = 1_700_000_000_000;
  for (const row of rows.filter((item) => item.sectionNumber === 1)) {
    recall[row.id] = applyPass(applyPass({ level: 3, hardPass: now - 2 * 24 * 60 * 60 * 1000 }, { levelAsked: 4, now }), { levelAsked: 4, now: now + 1000 });
  }
  const blocks = songMap(song, recall, { 1: { learned: true, boss: true, runs: 1, warmed: true } }, now);
  assert.equal(blocks[0].state, "Learned");
  const action = nextAction(blocks, 0);
  assert.equal(action.kind, "warmup");
  assert.equal(action.section, blocks[1].sectionNumber);
  const due = dueRows(song, { [rows[2].id]: { level: 2, due: now - 1, misses: 1, lastPass: now - 2, ladder: 1, learned: false, hardPass: 0 } }, now);
  assert.equal(due.length, 1);
  assert.equal(nextAction(blocks, due.length).kind, "daily");
});

test("daily review is only due lines and a boss miss returns to the start", () => {
  const now = 1_700_000_000_000;
  const rows = identitiesForSong(song).filter((row) => !row.repeat);
  const recall = {};
  recall[rows[0].id] = { level: 1, due: now - 10, misses: 3, lastPass: 1, ladder: 0, learned: false, hardPass: 0 };
  recall[rows[1].id] = { level: 2, due: now + 999999, misses: 0, lastPass: 1, ladder: 1, learned: false, hardPass: 0 };
  const steps = dailySteps(song, recall, now);
  assert.deepEqual(steps.map((step) => step.index), [rows[0].index]);
  const boss = startSession({ mode: "boss", steps: bossSteps(song, 1, {}), hearts: 3, sectionNumber: 1 });
  const missed = missRun(boss, { now });
  const back = finishReveal(missed.state);
  assert.equal(back.cursor, 0);
  assert.equal(boss.steps.every((step) => step.level >= 3), true);
});
