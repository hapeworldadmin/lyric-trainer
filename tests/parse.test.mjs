import assert from "node:assert/strict";
import test from "node:test";
import { analyzePaste, detectTitleArtist, searchLyricsUrl } from "../js/parse.js";
import { SAMPLE_SONG } from "../js/sample.js";

test("detects a Title - Artist first line and keeps the song lines", () => {
  const pasted = [
    `${SAMPLE_SONG.title} - ${SAMPLE_SONG.artist}`,
    "",
    "",
    "[Verse 1]",
    SAMPLE_SONG.lines[0],
    "[Chorus]",
    SAMPLE_SONG.lines[1],
    "",
    "You might also like",
    "Embed"
  ].join("\n");
  const parsed = analyzePaste(pasted);
  assert.equal(parsed.detected, true);
  assert.equal(parsed.title, SAMPLE_SONG.title);
  assert.equal(parsed.artist, SAMPLE_SONG.artist);
  assert.deepEqual(parsed.lines, [SAMPLE_SONG.lines[0], SAMPLE_SONG.lines[1]]);
  assert.ok(parsed.removedJunk >= 3);
});

test("accepts en dashes and em dashes", () => {
  assert.deepEqual(detectTitleArtist("Paper Moonfish – House Band"), {
    title: "Paper Moonfish",
    artist: "House Band"
  });
  assert.deepEqual(detectTitleArtist("Paper Moonfish — House Band"), {
    title: "Paper Moonfish",
    artist: "House Band"
  });
});

test("does not treat a normal lyric line as a title", () => {
  const parsed = analyzePaste(SAMPLE_SONG.lines.join("\n"));
  assert.equal(parsed.detected, false);
  assert.deepEqual(parsed.lines, SAMPLE_SONG.lines);
});

test("keeps a dashed first line when title detection is off", () => {
  const line = `${SAMPLE_SONG.title} - ${SAMPLE_SONG.artist}`;
  const parsed = analyzePaste([line, SAMPLE_SONG.lines[0], SAMPLE_SONG.lines[1]].join("\n"), { detectTitle: false });
  assert.equal(parsed.detected, false);
  assert.equal(parsed.lines[0], line);
});

test("strips timestamps, section labels, and lyric-site chrome", () => {
  const parsed = analyzePaste([
    "[Intro]",
    `0:12 ${SAMPLE_SONG.lines[0]}`,
    "(Chorus)",
    SAMPLE_SONG.lines[1],
    "Chorus",
    "(x2)",
    "12 Contributors",
    "Translations",
    "Read More",
    "https://example.com/not-lyrics",
    SAMPLE_SONG.lines[2]
  ].join("\n"), { detectTitle: false });
  assert.deepEqual(parsed.lines, [SAMPLE_SONG.lines[0], SAMPLE_SONG.lines[1], SAMPLE_SONG.lines[2]]);
});

test("keeps a sentence that merely contains the word embed", () => {
  const line = "The embed button sat on the counter";
  const parsed = analyzePaste([line, SAMPLE_SONG.lines[0]].join("\n"), { detectTitle: false });
  assert.deepEqual(parsed.lines, [line, SAMPLE_SONG.lines[0]]);
});

test("find lyrics is only a web search link", () => {
  const url = new URL(searchLyricsUrl("Paper Moonfish", "House Band"));
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.pathname, "/search");
  assert.match(url.searchParams.get("q"), /Paper Moonfish House Band lyrics/);
});
