import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  answersMatch,
  buildLesson,
  chapterPlan,
  correctLine,
  exposedText,
  firstLessonId,
  gameAvailability,
  gradeAnswer,
  isOrderCorrect,
  judgeOrderTap,
  lessonBonus,
  lineContext,
  lineWindowSizes,
  mixTypes,
  nextPractice,
  pointsFor,
  secondsForLine,
  sectionBlocks,
  sectionProgress,
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
  assert.equal(availability.lines, true);
  assert.equal(firstLessonId(SAMPLE_SONG.lines, SAMPLE_SONG.sections), "lines");
  for (const gameId of ["fill", "order", "letters"]) {
    const lesson = buildLesson(SAMPLE_SONG.lines, gameId, seededRng(7));
    assert.ok(lesson.length >= 1 && lesson.length <= 6);
    for (const question of lesson) assert.equal(question.kind, gameId);
  }
  const concert = buildLesson(SAMPLE_SONG.lines, "concert", seededRng(3));
  let cursor = 0;
  const recent = [];
  for (const question of concert) {
    assert.equal(question.lineIndex, cursor);
    const span = question.span || 1;
    const visible = exposedText(question);
    for (const line of SAMPLE_SONG.lines.slice(cursor + span)) {
      assert.equal(visible.includes(line), false, `${question.kind} shows a later line`);
    }
    assert.equal(question.context?.next || "", "");
    recent.push(question.kind);
    cursor += span;
  }
  assert.equal(cursor, SAMPLE_SONG.lines.length);
  for (let index = 2; index < recent.length; index += 1) {
    assert.equal(recent[index] === recent[index - 1] && recent[index] === recent[index - 2], false);
  }
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

  for (const gameId of ["fill", "order", "letters"]) {
    const lesson = buildLesson(lines, gameId, seededRng(2), sections);
    assert.ok(lesson.length >= 1);
    for (const question of lesson) {
      const expected = lineContext(lines, question.lineIndex, sections);
      if (question.kind !== "lines") expected.next = "";
      assert.deepEqual(question.context, expected);
      if (question.lineIndex === 0) assert.equal(question.context.previous, "");
      if (question.lineIndex === lines.length - 1) assert.equal(question.context.next, "");
    }
  }
  const next = buildLesson(lines, "next", seededRng(2), sections).find((question) => question.kind === "next");
  const promptAt = lines.indexOf(next.prompt);
  assert.equal(next.context.previous, promptAt > 0 ? lines[promptAt - 1] : "");
  assert.equal(next.context.next, "");
  assert.notEqual(next.context.previous, next.answer);
});

test("line order checks ids, and a repeated chorus keeps its own label", () => {
  const lines = ["alpha one two", "beta three four", "gamma five six", "delta seven eight"];
  const sections = ["Chorus", "Verse", "Chorus", "Chorus"];
  const blocks = sectionBlocks(lines, sections);
  assert.deepEqual(blocks.map((block) => block.label), ["Chorus", "Verse", "Chorus 2"]);
  assert.deepEqual(blocks.map((block) => block.lines.length), [1, 1, 2]);

  const [lineQuestion] = buildLesson(lines, "lines", seededRng(2), sections);
  assert.equal(lineQuestion.kind, "lines");
  assert.equal(lineQuestion.tokens.length, 2);
  assert.equal(isOrderCorrect(lineQuestion, lineQuestion.tokens.map((token) => token.id)), true);
  assert.equal(isOrderCorrect(lineQuestion, [...lineQuestion.tokens].reverse().map((token) => token.id)), false);
  assert.match(lineQuestion.context.rangeLabel, /lines 3–4 of 4/);
  assert.equal(lineQuestion.context.previous, lines[1]);
  assert.equal(lineQuestion.context.next, "");
  assert.equal(gameAvailability(lines.slice(0, 2), ["Verse", "Verse"]).lines, true);
  assert.equal(buildLesson(lines, "lines", seededRng(1), sections).some((question) => question.kind === "sections"), false);
  assert.equal(buildLesson(lines, "lines", seededRng(1), sections).some((question) => question.kind === "intruder"), false);
});

test("line order slides in short windows and section order caps each round", () => {
  const lines = Array.from({ length: 33 }, (_, index) => `lantern line number ${index} here`);
  const flat = lines.map(() => "Part 1");
  const lineLesson = buildLesson(lines, "lines", seededRng(1), flat);
  assert.ok(lineLesson.length > 1);
  const windows = lineLesson.filter((question) => question.kind === "lines");
  assert.ok(windows.every((question) => question.tokens.length >= 2 && question.tokens.length <= 6));
  assert.equal(windows.reduce((sum, question) => sum + question.tokens.length, 0), 33);
  assert.equal(windows[0].context.previous, "");
  assert.equal(windows[1].context.previous, windows[0].tokens.at(-1).text);
  assert.equal(windows[0].context.next, "");
  const covered = windows.flatMap((question) => question.tokens.map((token) => token.text));
  assert.deepEqual(covered, lines);

  const longSection = buildLesson(lines, "lines", seededRng(2), lines.map(() => "Chorus")).filter((question) => question.kind === "lines");
  assert.ok(longSection.every((question) => question.tokens.length <= 6));
  assert.equal(longSection[0].tokens.length, 5);
  assert.equal(longSection.reduce((sum, question) => sum + question.tokens.length, 0), 33);
});

test("identical lines are interchangeable one tap at a time", () => {
  const question = {
    kind: "lines",
    tokens: [
      { id: "a", text: "same cotton weather" },
      { id: "b", text: "same cotton weather" },
      { id: "c", text: "Same cotton weather!" },
      { id: "d", text: "leave the porch light" }
    ]
  };
  assert.equal(isOrderCorrect(question, ["a", "b", "c", "d"]), true);
  assert.equal(isOrderCorrect(question, ["c", "a", "b", "d"]), true);
  assert.equal(isOrderCorrect(question, ["b", "a", "c", "d"]), true);
  assert.equal(isOrderCorrect(question, ["a", "d", "b", "c"]), false);
  assert.equal(judgeOrderTap(question, [], "c"), true);
  assert.equal(judgeOrderTap(question, [], "d"), false);
  assert.equal(judgeOrderTap(question, ["c"], "a"), true);
  assert.equal(judgeOrderTap(question, ["c"], "d"), false);
  assert.equal(judgeOrderTap(question, ["a", "b", "c"], "d"), true);
  assert.equal(judgeOrderTap(question, ["a"], "a"), false);
});

test("order taps flash a color and the shake is an animation reduced motion can drop", async () => {
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(css, /\.token\.is-reject[\s\S]*#ff4d6d/i);
  assert.match(css, /\.token\.is-accept[\s\S]*#34d399|var\(--good\)/);
  assert.match(css, /@keyframes token-shake/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation:\s*none\s*!important/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /\.key-hint/);
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

test("answer checking ignores case, quotes, and punctuation, and the reveal keeps them", () => {
  assert.equal(answersMatch("Don’t stop, world!", "dont stop world"), true);
  assert.equal(answersMatch("“Hello”", "hello"), true);
  assert.equal(answersMatch("ﬁne day", "fine day"), true);
  assert.equal(answersMatch("glow", "glow!"), true);
  assert.equal(answersMatch("true", "True"), true);
  const line = "Don't stop, world!";
  const lesson = buildLesson([line, "other lantern words here", "third marble line stays"], "order", seededRng(1));
  const order = lesson.find((question) => question.line === line);
  assert.equal(correctLine(order), line);
  assert.equal(gradeAnswer({ kind: "previous", answer: "beta three four" }, "Beta three four!"), true);
  assert.equal(gradeAnswer({ kind: "truth", answer: "True" }, "true"), true);
  assert.equal(gradeAnswer({ kind: "which", answer: "Chorus" }, "chorus"), true);
  assert.equal(gradeAnswer({ kind: "letters", answer: "gamma five six" }, "Gamma five six"), true);
  assert.equal(gradeAnswer({ kind: "fill", answer: "glow" }, "Glow"), true);
  assert.equal(gradeAnswer({ kind: "swap", words: [{ id: "w0", wrong: false }, { id: "w1", wrong: true }] }, "w1"), true);
  assert.equal(gradeAnswer({ kind: "swap", words: [{ id: "w0", wrong: false }, { id: "w1", wrong: true }] }, "w0"), false);
});

test("the timer is about two seconds plus half a second per word", () => {
  assert.equal(secondsForLine(""), 5);
  assert.equal(secondsForLine("one"), 5);
  assert.equal(secondsForLine("one two three four five six"), 5);
  assert.equal(secondsForLine("one two three four five six seven"), 5.5);
  assert.equal(secondsForLine("one two three four five six seven eight nine ten"), 7);
  assert.equal(secondsForLine(Array.from({ length: 26 }, () => "word").join(" ")), 15);
  assert.equal(secondsForLine(Array.from({ length: 40 }, () => "word").join(" ")), 15);
});

test("question types do not repeat more than twice in a row", () => {
  const mixed = mixTypes([
    { type: "next", weight: 3 },
    { type: "fill", weight: 3 },
    { type: "letters", weight: 2 },
    { type: "swap", weight: 2 },
    { type: "truth", weight: 2 }
  ], 40, seededRng(9));
  assert.equal(mixed.length, 40);
  for (let index = 2; index < mixed.length; index += 1) {
    assert.equal(mixed[index] === mixed[index - 1] && mixed[index] === mixed[index - 2], false);
  }
  const lines = ["alpha one two", "beta three four", "gamma five six", "delta seven eight", "epsilon nine ten", "zeta eleven twelve"];
  const sections = ["Verse", "Verse", "Chorus", "Chorus", "Bridge", "Bridge"];
  for (const gameId of ["lines", "next", "concert"]) {
    const lesson = buildLesson(lines, gameId, seededRng(4), sections);
    const kinds = lesson.map((question) => question.kind);
    for (let index = 2; index < kinds.length; index += 1) {
      assert.equal(kinds[index] === kinds[index - 1] && kinds[index] === kinds[index - 2], false, gameId);
    }
  }
});

test("line rounds stay at least three lines and a seven line stanza is four then three", () => {
  assert.deepEqual(lineWindowSizes(7), [4, 3]);
  assert.deepEqual(lineWindowSizes(2), [2]);
  assert.deepEqual(lineWindowSizes(10), [5, 5]);
  const seven = Array.from({ length: 7 }, (_, index) => `lantern line number ${index} here`);
  const lesson = buildLesson(seven, "lines", seededRng(1), seven.map(() => "Verse")).filter((question) => question.kind === "lines");
  assert.deepEqual(lesson.map((question) => question.tokens.length), [4, 3]);
});

test("mastered rounds are skipped and the final run still covers them", () => {
  const lines = ["alpha one two", "beta three four", "gamma five six", "delta seven eight"];
  const sections = ["Verse", "Verse", "Chorus", "Chorus"];
  const full = buildLesson(lines, "lines", seededRng(2), sections).filter((question) => question.kind === "lines");
  const skip = [full[0].roundId];
  const rest = buildLesson(lines, "lines", seededRng(2), sections, { skipIds: skip }).filter((question) => question.kind === "lines");
  assert.equal(rest.some((question) => question.roundId === skip[0]), false);
  assert.equal(rest.some((question) => question.roundId === full[1].roundId), true);
  const again = buildLesson(lines, "lines", seededRng(2), sections, { roundId: skip[0] });
  assert.ok(again.some((question) => question.roundId === skip[0]));
  const concert = buildLesson(lines, "concert", seededRng(2), sections);
  let cursor = 0;
  for (const question of concert) cursor += question.span || 1;
  assert.equal(cursor, lines.length);
  const rounds = { [full[0].roundId]: { mastered: true } };
  const step = nextPractice(lines, sections, { rounds, chapters: {} });
  assert.equal(step.gameId, "lines");
  assert.notEqual(step.roundId, full[0].roundId);
  const progress = sectionProgress(lines, sections, rounds);
  assert.equal(progress[0].mastered, full[0].tokens.length);
  const plan = chapterPlan(lines, sections, {});
  assert.equal(plan[0].id, "lines");
  assert.equal(plan[0].status, "open");
  assert.equal(plan[1].status, "locked");
  assert.equal(plan.find((chapter) => chapter.id === "concert").status, "locked");
  assert.equal(chapterPlan(lines, sections, { lines: true })[1].status, "open");
  const mastered = {};
  for (const question of full) mastered[question.learnId] = { mastered: true };
  assert.equal(chapterPlan(lines, sections, {}, mastered).find((chapter) => chapter.id === "concert").status, "open");
});

test("a repeated chorus that differs only by punctuation is learned once", () => {
  const lines = [
    "paper boats along the stair",
    "counting windows in the rain",
    "carry the lantern upstairs",
    "leave the quiet in the hall",
    "spin the silver kitchen light",
    "morning folded on the chair",
    "tickets hidden in a book",
    "carry the lantern upstairs?",
    "leave the quiet in the hall",
    "spin the silver kitchen light"
  ];
  const labels = [
    "Verse 1", "Verse 1",
    "Chorus", "Chorus", "Chorus",
    "Verse 2", "Verse 2",
    "Chorus", "Chorus", "Chorus"
  ];
  const blocks = sectionBlocks(lines, labels);
  assert.deepEqual(blocks.map((block) => block.label), ["Verse 1", "Chorus", "Verse 2", "Chorus 2"]);
  const lesson = buildLesson(lines, "lines", seededRng(1), labels).filter((question) => question.kind === "lines");
  const chorusQuestions = lesson.filter((question) => question.roundLines.some((line) => line.includes("lantern upstairs")));
  assert.equal(chorusQuestions.length, 1);
  assert.equal(lesson.some((question) => question.kind === "intruder" || question.kind === "sections"), false);
  const rounds = { [chorusQuestions[0].learnId]: { mastered: true } };
  const progress = sectionProgress(lines, labels, rounds);
  assert.equal(progress.find((section) => section.label === "Chorus").done, true);
  assert.equal(progress.find((section) => section.label === "Chorus 2").done, true);
  assert.equal(progress.find((section) => section.label === "Verse 1").done, false);
  assert.equal(progress.find((section) => section.label === "Verse 2").done, false);
});
