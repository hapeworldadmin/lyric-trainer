import assert from "node:assert/strict";
import test from "node:test";
import { comboMultiplier, recallXp } from "../js/memory.js";
import { createTideClock, pauseTide, resumeTide, tideBudget, tideLeft } from "../js/tide.js";

test("the tide shrinks about 2 percent per correct answer and floors at 80 percent", () => {
  const start = tideBudget("one two three four", 2, 0);
  const once = tideBudget("one two three four", 2, 1);
  assert.ok(start >= 8000);
  assert.ok(Math.abs(once / start - 0.98) < 0.001);
  const floor = tideBudget("one two three four", 2, 80);
  assert.ok(Math.abs(floor - start * 0.8) < 1);
  assert.ok(tideBudget("one two three four", 4, 0) > tideBudget("one two three four", 0, 0));
  assert.equal(tideBudget("one two three four", 3, 10, { slowdown: false }), tideBudget("one two three four", 3, 0, { slowdown: false }));
});

test("combo rises every four correct answers and pays more at harder levels", () => {
  assert.equal(comboMultiplier(3), 1);
  assert.equal(comboMultiplier(4), 2);
  assert.equal(comboMultiplier(20), 5);
  assert.equal(recallXp({ level: 3, combo: 4 }), Math.round(10 * 1.7 * 2));
  assert.equal(recallXp({ level: 3, combo: 4, sung: true }), Math.round(10 * 1.7 * 2 * 1.25));
});

test("a hidden tab does not spend the tide", () => {
  const clock = pauseTide(createTideClock(5000, 1000), 2000);
  assert.equal(tideLeft(resumeTide(clock, 9000), 9000), 4000);
});
