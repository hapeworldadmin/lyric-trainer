import assert from "node:assert/strict";
import test from "node:test";
import { analyzePaste, cleanPastedPage, detectTitleArtist, draftLyrics, searchLyricsUrl } from "../js/parse.js";
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

test("section labels stay attached to the following lines and repeats do not clear them", () => {
  const parsed = analyzePaste([
    "[Verse 1]",
    "alpha one two",
    "(x2)",
    "[Chorus]",
    "beta three four",
    "Chorus:",
    "gamma five six"
  ].join("\n"), { detectTitle: false });
  assert.deepEqual(parsed.lines, ["alpha one two", "beta three four", "gamma five six"]);
  assert.deepEqual(parsed.sections, ["Verse 1", "Chorus", "Chorus"]);
  assert.equal(draftLyrics(parsed.lines, parsed.sections), "[Verse 1]\nalpha one two\n[Chorus]\nbeta three four\ngamma five six");
});

test("blank lines become parts when a paste has no section tags", () => {
  const parsed = analyzePaste([
    "alpha one two",
    "",
    "beta three four",
    "gamma five six",
    ""
  ].join("\n"), { detectTitle: false });
  assert.deepEqual(parsed.lines, ["alpha one two", "beta three four", "gamma five six"]);
  assert.deepEqual(parsed.sections, ["Part 1", "Part 2", "Part 2"]);

  const single = analyzePaste(["alpha one two", "beta three four"].join("\n"), { detectTitle: false });
  assert.deepEqual(single.sections, ["Part 1", "Part 1"]);
});

test("section tags win over blank lines", () => {
  const parsed = analyzePaste([
    "[Verse]",
    "alpha one two",
    "",
    "[Chorus]",
    "beta three four"
  ].join("\n"), { detectTitle: false });
  assert.deepEqual(parsed.sections, ["Verse", "Chorus"]);
});

test("a copied page keeps the longest lyric block and drops chrome", () => {
  const page = [
    "Home",
    "Search",
    "Sign in",
    "Advertisement",
    "red one two",
    "red three four",
    "Sponsored",
    "Soft - LANY",
    "[Verse 1]",
    "alpha one two",
    "beta three four",
    "",
    "[Chorus]",
    "gamma five six",
    "delta seven eight",
    "epsilon nine ten",
    "Written by A. Person",
    "Copyright 2024 Example",
    "All rights reserved",
    "Follow",
    "12 comments",
    "Buy tickets"
  ].join("\n");
  const cleaned = cleanPastedPage(page, { detectTitle: false, title: "Soft", artist: "LANY" });
  assert.deepEqual(cleaned.lines, [
    "alpha one two",
    "beta three four",
    "gamma five six",
    "delta seven eight",
    "epsilon nine ten"
  ]);
  assert.deepEqual(cleaned.sections, ["Verse 1", "Verse 1", "Chorus", "Chorus", "Chorus"]);
});

const UNBROKEN = [
  "amber lanterns on the stair",
  "carry the lantern upstairs?",
  "the hallway kept a quiet glow",
  "we counted tiles and let it go",
  "you feel like cotton weather",
  "you feel like cotton weather",
  "you feel like cotton weather",
  "(nothing in the kitchen ever burns me)",
  "the kettle hummed a softer tune",
  "carry the lantern upstairs",
  "windows fogged a silver moon",
  "we left the coats beside the broom",
  "you feel like cotton weather",
  "you feel like cotton weather",
  "you feel like cotton weather?",
  "say it once and leave the light",
  "the porch can hold it for the night",
  "you feel like cotton weather",
  "you feel like cotton weather",
  "you feel like cotton weather"
];
const UNBROKEN_SECTIONS = [
  "Verse 1", "Verse 1", "Verse 1", "Verse 1",
  "Chorus", "Chorus", "Chorus", "Chorus",
  "Verse 2", "Verse 2", "Verse 2", "Verse 2",
  "Chorus", "Chorus", "Chorus",
  "Bridge", "Bridge",
  "Chorus", "Chorus", "Chorus"
];

test("a paste with no blank lines or tags is split by a repeated chorus", () => {
  const parsed = analyzePaste(UNBROKEN.join("\n"), { detectTitle: false });
  assert.deepEqual(parsed.lines, UNBROKEN);
  assert.deepEqual(parsed.sections, UNBROKEN_SECTIONS);
});

test("a paste with no repetition falls back to four-line parts", () => {
  const lines = Array.from({ length: 10 }, (_, index) => `unique marble line ${index} extra`);
  const parsed = analyzePaste(lines.join("\n"), { detectTitle: false });
  assert.deepEqual(parsed.lines, lines);
  assert.deepEqual(parsed.sections, [
    "Verse 1", "Verse 1", "Verse 1", "Verse 1",
    "Verse 2", "Verse 2", "Verse 2", "Verse 2",
    "Verse 3", "Verse 3"
  ]);
});

test("repeated block starts and plain-text gaps become stanza breaks", () => {
  const repeated = analyzePaste([
    "amber lanterns on the stair",
    "we counted tiles and let it go",
    "windows fogged a silver moon",
    "amber lanterns on the stair",
    "the porch can hold the light",
    "coats were waiting by the broom"
  ].join("\n"), { detectTitle: false });
  assert.deepEqual(repeated.sections, ["Part 1", "Part 1", "Part 1", "Part 2", "Part 2", "Part 2"]);

  const spaced = analyzePaste("alpha one two  beta three four\ngamma five six", { detectTitle: false });
  assert.deepEqual(spaced.lines, ["alpha one two", "beta three four", "gamma five six"]);
  assert.deepEqual(spaced.sections, ["Part 1", "Part 2", "Part 2"]);

  const separators = analyzePaste("alpha one two\u2028beta three four\u2028\u2028gamma five six", { detectTitle: false });
  assert.deepEqual(separators.sections, ["Part 1", "Part 1", "Part 2"]);

  const crlf = analyzePaste("alpha one two\r\nbeta three four\r\n\r\ngamma five six", { detectTitle: false });
  assert.deepEqual(crlf.sections, ["Part 1", "Part 1", "Part 2"]);

  const mixed = analyzePaste("alpha one two\nbeta three four\r\ngamma five six\ndelta seven eight", { detectTitle: false });
  assert.deepEqual(mixed.sections, ["Part 1", "Part 1", "Part 2", "Part 2"]);
});

test("html stanza blocks keep breaks and drop the panel junk", () => {
  const stanza = (lines) => `<div>${lines.map((line) => `<span>${line}</span>`).join("<br>")}</div>`;
  const html = [
    "<div>",
    stanza(UNBROKEN.slice(0, 4)),
    stanza(UNBROKEN.slice(4, 8)),
    stanza(UNBROKEN.slice(8, 12)),
    stanza(UNBROKEN.slice(12, 15)),
    stanza(UNBROKEN.slice(15, 17)),
    stanza(UNBROKEN.slice(17)),
    "<div>Source: Example Notes</div>",
    "<div>Songwriters: A. Person</div>",
    "<div>Released: 2019</div>",
    "<div>Album: Paper Moon</div>",
    "<div>Listen</div>",
    "<div>People also search for</div>",
    "<div>Feedback</div>",
    "</div>"
  ].join("");
  const parsed = cleanPastedPage(html, { detectTitle: false, title: "Paper Moonfish", artist: "House Band" });
  assert.deepEqual(parsed.lines, UNBROKEN);
  assert.deepEqual(parsed.sections, UNBROKEN_SECTIONS);
  assert.equal(parsed.lines.some((line) => /source|songwriter|feedback|listen/i.test(line)), false);
});

test("a google-shaped paste keeps stanza boundaries and does not split a stanza", () => {
  const verse1 = [
    "paper boats along the stair",
    "counting windows in the rain",
    "the hallway clock forgot the hour",
    "we borrowed light from upstairs",
    "soft shoes on the colder floor",
    "the kettle knew the way"
  ];
  const chorus = [
    "carry the paper moon upstairs",
    "leave the quiet in the hall",
    "spin the silver kitchen light",
    "we can hear the pictures fall",
    "hold the banister and laugh",
    "the ceiling knows our names",
    "open every other door",
    "the landing keeps us safe",
    "say the password to the dark",
    "we arrive and start again"
  ];
  const verse2 = [
    "morning folded on the chair",
    "tickets hidden in a book",
    "the neighbor waved through fog",
    "we practiced being brave",
    "a radio forgot the news",
    "the staircase smelled like rain",
    "you pointed at the roof"
  ];
  const chorusEcho = chorus.map((line, index) => (index % 3 === 0 ? `${line} (${line.split(" ")[0]})` : line));
  const bridge = ["na na na the landing", "na na na the light", "na na na we stay"];
  const lines = [...verse1, ...chorus, ...verse2, ...chorusEcho, ...bridge];
  const expected = [
    ...verse1.map(() => "Verse 1"),
    ...chorus.map(() => "Chorus"),
    ...verse2.map(() => "Verse 2"),
    ...chorusEcho.map(() => "Chorus"),
    ...bridge.map(() => "Bridge")
  ];
  const parsed = analyzePaste(lines.join("\n"), { detectTitle: false });
  assert.deepEqual(parsed.sections, expected);
  const stanza = (block) => `<div>${block.map((line) => `<span>${line}</span>`).join("<br>")}</div>`;
  const html = [stanza(verse1), stanza(chorus), stanza(verse2), stanza(chorusEcho), stanza(bridge)].join("");
  const fromHtml = cleanPastedPage(html, { detectTitle: false });
  assert.deepEqual(fromHtml.lines, lines);
  assert.deepEqual(fromHtml.sections, expected);
});

test("find lyrics is only a web search link", () => {
  const url = new URL(searchLyricsUrl("Paper Moonfish", "House Band"));
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.pathname, "/search");
  assert.match(url.searchParams.get("q"), /Paper Moonfish House Band lyrics/);
});
