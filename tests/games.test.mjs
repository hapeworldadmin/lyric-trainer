import assert from "node:assert/strict";
import test from "node:test";
import {
  answersMatch,
  buildLesson,
  gameAvailability,
  isOrderCorrect,
  lessonBonus,
  pointsFor,
  seededRng
} from "../js/games.js";
import { SAMPLE_SONG } from "../js/sample.js";

test("every game can be built from the sample song", () => {
  const availability = gameAvailability(SAMPLE_SONG.lines);
  assert.deepEqual(availability, { fill: true, order: true, next: true, letters: true, concert: true });
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

test("next line needs three lines and points include combo and time", () => {
  assert.equal(gameAvailability(SAMPLE_SONG.lines.slice(0, 2)).next, false);
  assert.equal(pointsFor({ kind: "fill", correct: false, combo: 2 }).score, 0);
  const timed = pointsFor({ kind: "letters", correct: true, combo: 3, secondsLeft: 5 });
  assert.equal(timed.xp, 15 + 4);
  assert.equal(timed.score, 100 + 30 + 40);
  assert.equal(lessonBonus(6, 6), 20);
  assert.equal(lessonBonus(5, 6), 0);
});
