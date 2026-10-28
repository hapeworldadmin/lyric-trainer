import assert from "node:assert/strict";
import test from "node:test";
import { analyzePaste, sectionName } from "../js/parse.js";
import { completenessWarnings, mergeWithNext, prepareImportedText, relabelBlock, renameBlock, splitAtLine, splitSection } from "../js/sections.js";

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
  const short = completenessWarnings(["alpha one two", "beta three four"], ["Verse", "Verse"]);
  assert.equal(short.some((item) => /8 lines/.test(item)), true);
  assert.equal(short.some((item) => /chorus/i.test(item)), false);
  const nine = Array.from({ length: 9 }, (_, index) => `unique marble line ${index} extra`);
  const parsed = analyzePaste(nine.join("\n"), { detectTitle: false });
  assert.deepEqual(parsed.sections, [
    "Verse 1", "Verse 1", "Verse 1", "Verse 1",
    "Verse 2", "Verse 2", "Verse 2", "Verse 2", "Verse 2"
  ]);
  const long = Array.from({ length: 16 }, (_, index) => `unique marble line ${index} extra`);
  assert.equal(completenessWarnings(long, long.map(() => "Verse 1")).some((item) => /chorus/i.test(item)), true);
  const chorus = ["one two three", "four five six", "hook line stays", "hook line stays"];
  const sections = ["Verse", "Verse", "Chorus", "Chorus"];
  assert.equal(completenessWarnings([...chorus, ...chorus], [...sections, ...sections]).some((item) => /chorus/i.test(item)), false);
  assert.equal(renameBlock(["Verse 1", "Verse 1", "Chorus"], 0, "Chorus")[0], "Chorus");
  assert.deepEqual(splitSection(["Verse 1", "Verse 1", "Verse 1", "Verse 1"], 0).slice(0, 2), ["Verse 1", "Verse 1"]);
});
