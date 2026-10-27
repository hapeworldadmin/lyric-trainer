import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSing } from "../js/text.js";
import { interpretHearing, voiceMatch } from "../js/voice.js";
import { singingMatch } from "../js/games.js";

test("sung and typed lines ignore punctuation, apostrophes, and curly quotes", () => {
  assert.equal(normalizeSing("You're the why"), "you are the why");
  assert.equal(normalizeSing("youre the why"), "you are the why");
  assert.equal(normalizeSing("you are the why"), "you are the why");
  assert.equal(normalizeSing("You’re the why,"), "you are the why");
  assert.equal(normalizeSing("“Hello,” world!"), "hello world");
  assert.equal(singingMatch("You're the why", "youre the why"), true);
  assert.equal(singingMatch("You're the why", "you are the why"), true);
  assert.equal(singingMatch("You're the why,", "You’re the why"), true);
  assert.equal(singingMatch("Don't stop, world!", "dont stop world"), true);
  assert.equal(singingMatch("we're still here", "were still here"), true);
  assert.equal(singingMatch("I found a lantern that could shine", "nope nope nope nope"), false);
});

test("voice matching accepts realistic sung mis-transcriptions and snaps to the lyric", () => {
  const line = "No matter how it all plays out";
  const shine = "I found a lantern that could shine";
  const alley = "It lit the alley soft and slow";
  const carried = "We carried the lantern across the floor";
  const song = [line, shine, alley, carried];
  assert.equal(voiceMatch(line, "no mater how it all plays out", song), true);
  assert.equal(voiceMatch(line, "know matter how it all plays out", song), true);
  assert.equal(voiceMatch(shine, "i found a lantern that could shin", song), true);
  assert.equal(voiceMatch(shine, "eye found uh lantern dat could shine", song), true);
  assert.equal(voiceMatch(alley, "it lit the alley soft and slo", song), true);
  assert.equal(voiceMatch(carried, "we carried da lantern across the flor"), true);
  assert.equal(voiceMatch("going to the show tonight", "gonna the show tonight"), true);
  assert.equal(voiceMatch("two", "2"), true);
  assert.equal(singingMatch("two", "2"), false);
  assert.equal(voiceMatch(line, "completely different words about weather", song), false);
  assert.equal(voiceMatch(line, "", song), false);

  const heard = interpretHearing(line, ["snow weather cow", "no mater how it all plays out"], song);
  assert.equal(heard.pass, true);
  assert.equal(heard.raw, "no mater how it all plays out");
  assert.match(heard.display, /matter/);
  assert.doesNotMatch(heard.display, /snow/);

  const why = interpretHearing("You're the why", ["your the why"]);
  assert.equal(why.pass, true);
  assert.match(why.display, /You're/);

  const close = voiceMatch("soft and slow tonight", "softandslowtonight");
  assert.equal(close, true);
});
