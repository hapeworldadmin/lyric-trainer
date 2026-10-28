import assert from "node:assert/strict";
import test from "node:test";
import { paceAt, paceLabel } from "../js/ghost.js";

test("the pace label says ahead or behind without relying on color", () => {
  assert.equal(paceLabel(1500), "Ahead 1.5s");
  assert.equal(paceLabel(-800), "Behind 0.8s");
  assert.equal(paceAt([1000, 1000], [900, 900]), -200);
  assert.equal(paceLabel(-200), "Behind 0.2s");
  assert.equal(paceAt([], [900]), null);
});
