import assert from "node:assert/strict";
import test from "node:test";
import { analyzePaste, sectionName } from "../js/parse.js";
import { completenessWarnings, mergeWithNext, prepareImportedText, relabelBlock, splitAtLine } from "../js/sections.js";

test("section tags drop a trailing artist", () => {
  assert.equal(sectionName("[Chorus: House Band]"), "Chorus");
  assert.equal(sectionName("[Verse 1: Someone]"), "Verse 1");
  assert.equal(sectionName("[Chorus]"), "Chorus");
});

test("trailing page numbers are junk and lrc timestamps come off", () => {
  const parsed = analyzePaste(["alpha one two", "12", "beta three four"].join("\n"), { detectTitle: false });
  assert.deepEqual(parsed.lines, ["alpha one two", "beta three four"]);
  const lrc = prepareImportedText("notes.lrc", "[00:12.00]alpha one two\n[00:18.50]beta three four\n");
  const fromFile = analyzePaste(lrc, { detectTitle: false });
  assert.deepEqual(fromFile.lines, ["alpha one two", "beta three four"]);
});

test("preview can relabel, merge, and split, and short songs warn", () => {
  const labels = ["Verse", "Verse", "Chorus", "Chorus"];
  assert.deepEqual(relabelBlock(labels, 0, "Intro"), ["Intro", "Intro", "Chorus", "Chorus"]);
  assert.deepEqual(mergeWithNext(["Verse", "Verse", "Chorus", "Chorus"], 0), ["Verse", "Verse", "Verse", "Verse"]);
  const split = splitAtLine(["Verse", "Verse", "Verse"], 2);
  assert.equal(split[0], "Verse");
  assert.notEqual(split[2], "Verse");
  const warnings = completenessWarnings(["alpha one two", "beta three four"], ["Verse", "Verse"]);
  assert.equal(warnings.some((item) => /8 lines/.test(item)), true);
  assert.equal(warnings.some((item) => /chorus/i.test(item)), true);
  const chorus = ["one two three", "four five six", "hook line stays", "hook line stays"];
  const sections = ["Verse", "Verse", "Chorus", "Chorus"];
  assert.equal(completenessWarnings([...chorus, ...chorus], [...sections, ...sections]).some((item) => /chorus/i.test(item)), false);
});
