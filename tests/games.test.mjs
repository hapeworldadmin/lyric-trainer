import assert from "node:assert/strict";
import test from "node:test";
import {
  answersMatch,
  buildLesson,
  firstLessonId,
  gameAvailability,
  isOrderCorrect,
  lessonBonus,
  lineContext,
  pointsFor,
  sectionBlocks,
  seededRng
} from "../js/games.js";
import { SAMPLE_SONG } from "../js/sample.js";

test("every game can be built from the sample song", () => {
  const availability = gameAvailability(SAMPLE_SONG.lines, SAMPLE_SONG.sections);
  assert.equal(availability.fill, true);
  assert.equal(availability.order, true);
  assert.equal(availability.next, true);
  assert.equal(availability.letters, true);
  assert.equal(availability.concert, true);
  assert.equal(availability.sections, true);
  assert.equal(availability.lines, true);
  assert.equal(firstLessonId(SAMPLE_SONG.lines, SAMPLE_SONG.sections), "sections");
  for (const gameId of ["fill", "order", "next", "letters"]) {
    const lesson = buildLesson(SAMPLE_SONG.lines, gameId, seededRng(7));
    assert.ok(lesson.length >= 1 && lesson.length <= 6);
    for (const question of lesson) assert.equal(question.kind, gameId);
  }
  const concert = buildLesson(SAMPLE_SONG.lines, "concert", seededRng(3));
  assert.equal(concert.length, SAMPLE_SONG.lines.length);
  assert.deepEqual(concert.map((question) => question.line), SAMPLE_SONG.lines);
});

test("correct answers match and wrong answers do not", () => {
  const [fill] = buildLesson(SAMPLE_SONG.lines, "fill", seededRng(4));
  assert.equal(answersMatch(fill.answer, fill.answer.toUpperCase()), true);
  assert.equal(answersMatch(fill.answer, "not-the-word"), false);
  assert.ok(fill.choices.includes(fill.answer));

  const [order] = buildLesson(SAMPLE_SONG.lines, "order", seededRng(5));
  assert.equal(isOrderCorrect(order, order.tokens.map((token) => token.id)), true);
  assert.equal(isOrderCorrect(order, [...order.tokens].reverse().map((token) => token.id)), false);

  const [next] = buildLesson(SAMPLE_SONG.lines, "next", seededRng(6));
  const promptAt = SAMPLE_SONG.lines.indexOf(next.prompt);
  assert.equal(SAMPLE_SONG.lines[promptAt + 1], next.answer);
  assert.ok(next.choices.includes(next.answer));
  assert.equal(next.choices.filter((choice) => choice === next.answer).length, 1);

  const [letters] = buildLesson(SAMPLE_SONG.lines, "letters", seededRng(8));
  assert.equal(answersMatch(letters.answer, letters.line.replace(/[^\p{L}\p{N}\s]/gu, "")), true);
  assert.match(letters.hint, /\p{L}/u);
});

test("context lines cover neighbors, section labels, and the ends of a song", () => {
  const lines = ["alpha one two", "beta three four", "gamma five six", "delta seven eight"];
  const sections = ["Verse", "Verse", "Chorus", "Chorus"];
  const first = lineContext(lines, 0, sections);
  assert.equal(first.previous, "");
  assert.equal(first.next, lines[1]);
  assert.equal(first.section, "Verse");
  assert.equal(first.position, 1);
  assert.equal(first.total, 4);

  const last = lineContext(lines, 3, sections);
  assert.equal(last.previous, lines[2]);
  assert.equal(last.next, "");
  assert.equal(last.section, "Chorus");
  assert.equal(last.position, 4);
  assert.equal(last.total, 4);

  const only = lineContext(["solo line here"], 0, ["Intro"]);
  assert.equal(only.previous, "");
  assert.equal(only.next, "");
  assert.equal(only.position, 1);
  assert.equal(only.total, 1);
  assert.equal(only.section, "Intro");

  const unlabeled = lineContext(lines, 1, []);
  assert.equal(unlabeled.section, "");
  assert.equal(unlabeled.previous, lines[0]);
  assert.equal(unlabeled.next, lines[2]);

  for (const gameId of ["fill", "order", "next", "letters", "concert"]) {
    const lesson = buildLesson(lines, gameId, seededRng(2), sections);
    assert.ok(lesson.length >= 1);
    for (const question of lesson) {
      assert.deepEqual(question.context, lineContext(lines, question.lineIndex, sections));
      if (question.lineIndex === 0) assert.equal(question.context.previous, "");
      if (question.lineIndex === lines.length - 1) assert.equal(question.context.next, "");
    }
  }
  const next = buildLesson(lines, "next", seededRng(2), sections)[0];
  assert.equal(next.context.previous, next.prompt);
  assert.notEqual(next.context.previous, next.answer);
});

test("section order and line order check ids, and repeated sections stay distinct", () => {
  const lines = ["alpha one two", "beta three four", "gamma five six", "delta seven eight"];
  const sections = ["Chorus", "Verse", "Chorus", "Chorus"];
  const blocks = sectionBlocks(lines, sections);
  assert.deepEqual(blocks.map((block) => block.label), ["Chorus", "Verse", "Chorus 2"]);
  assert.deepEqual(blocks.map((block) => block.lines.length), [1, 1, 2]);

  const [sectionsQuestion] = buildLesson(lines, "sections", seededRng(1), sections);
  assert.equal(sectionsQuestion.kind, "sections");
  assert.equal(isOrderCorrect(sectionsQuestion, sectionsQuestion.tokens.map((token) => token.id)), true);
  assert.equal(isOrderCorrect(sectionsQuestion, [...sectionsQuestion.tokens].reverse().map((token) => token.id)), false);
  assert.equal(sectionsQuestion.context.rangeLabel, "3 sections");
  assert.equal(sectionsQuestion.context.previous, "");
  assert.equal(sectionsQuestion.context.next, "");

  const [lineQuestion] = buildLesson(lines, "lines", seededRng(2), sections);
  assert.equal(lineQuestion.kind, "lines");
  assert.equal(lineQuestion.tokens.length, 2);
  assert.equal(isOrderCorrect(lineQuestion, lineQuestion.tokens.map((token) => token.id)), true);
  assert.equal(isOrderCorrect(lineQuestion, [...lineQuestion.tokens].reverse().map((token) => token.id)), false);
  assert.match(lineQuestion.context.rangeLabel, /lines 3–4 of 4/);
  assert.equal(gameAvailability(lines.slice(0, 2), ["Verse", "Verse"]).sections, false);
  assert.equal(gameAvailability(lines.slice(0, 2), ["Verse", "Verse"]).lines, true);
});

test("next line needs three lines and points include combo and time", () => {
  assert.equal(gameAvailability(SAMPLE_SONG.lines.slice(0, 2)).next, false);
  assert.equal(pointsFor({ kind: "fill", correct: false, combo: 2 }).score, 0);
  const timed = pointsFor({ kind: "letters", correct: true, combo: 3, secondsLeft: 5 });
  assert.equal(timed.xp, 15 + 4);
  assert.equal(timed.score, 100 + 30 + 40);
  assert.equal(lessonBonus(6, 6), 20);
  assert.equal(lessonBonus(5, 6), 0);
});
