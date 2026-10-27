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
  seededRng,
  singingMatch
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
  assert.equal(firstLessonId(SAMPLE_SONG.lines, SAMPLE_SONG.sections), "fade");
  assert.equal(availability.fade, true);
  assert.equal(availability.think, true);
  assert.equal(Object.hasOwn(availability, "sections"), false);
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

test("line order checks ids, and repeated sections stay distinct", () => {
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
});

test("line order slides in short windows", () => {
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
  assert.equal(longSection[0].tokens.length, 6);
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
  assert.equal(gradeAnswer({ kind: "intruder", answer: "zeta eleven twelve" }, "zeta, eleven twelve"), true);
  assert.equal(gradeAnswer({ kind: "letters", answer: "gamma five six" }, "Gamma five six"), true);
  assert.equal(gradeAnswer({ kind: "fill", answer: "glow" }, "Glow"), true);
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
    { type: "order", weight: 2 },
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
    assert.equal(lesson.some((question) => question.kind === "swap"), false, gameId);
  }
});

test("line rounds stay at least three lines and a seven line stanza is four then three", () => {
  assert.deepEqual(lineWindowSizes(7), [4, 3]);
  assert.deepEqual(lineWindowSizes(2), [2]);
  assert.deepEqual(lineWindowSizes(6), [6]);
  assert.deepEqual(lineWindowSizes(10), [5, 5]);
  assert.deepEqual(lineWindowSizes(12), [6, 6]);
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
  const step = nextPractice(lines, sections, { rounds, chapters: { sections: true } });
  assert.equal(step.gameId, "fade");
  assert.notEqual(step.roundId, full[0].roundId);
  const progress = sectionProgress(lines, sections, rounds);
  assert.equal(progress[0].mastered, full[0].tokens.length);
  const plan = chapterPlan(lines, sections, {});
  assert.deepEqual(plan.map((chapter) => chapter.id), ["fade", "think", "lines", "next", "concert"]);
  assert.equal(plan[0].name, "Fade");
  assert.equal(plan[0].status, "open");
  assert.equal(plan[1].status, "locked");
  assert.equal(plan[4].id, "concert");
  assert.equal(plan[4].status, "locked");
  assert.equal(chapterPlan(lines, sections, { fade: true })[1].status, "open");
  assert.equal(chapterPlan(lines, sections, { fade: true })[1].id, "think");
  assert.equal(chapterPlan(lines, sections, { sections: true })[0].status, "open");
  assert.equal(chapterPlan(lines, sections, { sections: true })[0].id, "fade");
  const fresh = nextPractice(lines, sections, {});
  assert.equal(fresh.gameId, "fade");
  assert.ok(fresh.roundId);
  for (const gameId of ["lines", "next", "concert"]) {
    const lesson = buildLesson(lines, gameId, seededRng(5), sections);
    assert.ok(lesson.length > 0, gameId);
    assert.equal(lesson.some((question) => question.kind === "sections"), false, gameId);
  }
  const singles = ["alpha one two", "beta three four", "gamma five six"];
  const singleLabels = ["Verse", "Chorus", "Bridge"];
  assert.equal(gameAvailability(singles, singleLabels).lines, false);
  assert.equal(firstLessonId(singles, singleLabels), "fade");
  assert.ok(buildLesson(singles, "next", seededRng(1), singleLabels).length > 0);
  const covered = buildLesson(singles, "concert", seededRng(1), singleLabels);
  assert.equal(covered.some((question) => question.kind === "sections"), false);
  assert.equal(covered.reduce((sum, question) => sum + (question.span || 1), 0), singles.length);
});

test("sung answers ignore case and punctuation and accept most words in order", () => {
  const line = "One two three four five six seven";
  assert.equal(singingMatch(line, "ONE two, three four five six seven!"), true);
  assert.equal(singingMatch(line, "two three four five six seven"), true);
  assert.equal(singingMatch(line, "one two three four five"), true);
  assert.equal(singingMatch(line, "one two three four"), false);
  assert.equal(singingMatch(line, "seven six five four three two one"), false);
  assert.equal(singingMatch(line, ""), false);
  assert.equal(singingMatch("one two three four five six seven eight nine ten", "one two three four five six seven extra words"), true);
  assert.equal(gradeAnswer({ kind: "next", sing: true, answer: line }, "two three four five six seven"), true);
  assert.equal(gradeAnswer({ kind: "next", sing: true, answer: line }, "nope"), false);
  assert.equal(gradeAnswer({ kind: "next", answer: line }, "two three four five six seven"), false);
  const why = "You're the why";
  assert.equal(singingMatch(why, "youre the why"), true);
  assert.equal(singingMatch(why, "you are the why"), true);
  assert.equal(singingMatch(why, "You’re the why"), true);
  assert.equal(singingMatch("You're the why,", "youre the why"), true);
  assert.equal(singingMatch("Don't stop, world!", "dont stop world"), true);
  assert.equal(singingMatch("Don't stop, world!", "do not stop world"), true);
  assert.equal(singingMatch("we're here", "were here"), true);
  assert.equal(singingMatch(why, "nope nope nope"), false);
  assert.equal(gradeAnswer({ kind: "next", sing: true, answer: why }, "you are the why"), true);
});

test("about one in three next-line questions can be sung, and the final run has a couple", () => {
  const lines = Array.from({ length: 12 }, (_, index) => `lantern line number ${index} stays`);
  const sections = lines.map((_, index) => (index < 4 ? "Verse" : index < 8 ? "Chorus" : "Bridge"));
  for (let seed = 1; seed <= 6; seed += 1) {
    const lesson = buildLesson(lines, "next", seededRng(seed), sections);
    const nextQuestions = lesson.filter((question) => question.kind === "next");
    const sing = nextQuestions.filter((question) => question.sing);
    assert.equal(sing.length, Math.round(nextQuestions.length / 3));
    assert.ok(nextQuestions.some((question) => !question.sing));
    for (const question of sing) {
      assert.equal(question.context.next, "");
      assert.equal(question.choices.includes(question.answer), true);
      assert.equal(exposedText(question).split("\n").includes(question.answer), false);
    }
    const concert = buildLesson(lines, "concert", seededRng(seed), sections);
    const concertNext = concert.filter((question) => question.kind === "next");
    const concertSing = concertNext.filter((question) => question.sing);
    assert.equal(concertSing.length, Math.min(2, concertNext.length));
    if (concertNext.length > 2) assert.ok(concertNext.some((question) => !question.sing));
    for (const question of concertSing) {
      assert.equal(question.context.next || "", "");
      assert.equal(exposedText(question).split("\n").includes(question.answer), false);
    }
  }
  const sampleNext = buildLesson(SAMPLE_SONG.lines, "next", seededRng(4), SAMPLE_SONG.sections);
  const sampleSing = sampleNext.filter((question) => question.kind === "next" && question.sing);
  assert.equal(sampleSing.length, Math.round(sampleNext.filter((question) => question.kind === "next").length / 3));
  const forced = buildLesson(SAMPLE_SONG.lines, "next", seededRng(4), SAMPLE_SONG.sections, { forceSing: true });
  assert.equal(forced[0].sing, true);
  assert.equal(forced.filter((question) => question.sing).length, sampleSing.length);
  for (const gameId of ["lines", "fill", "order", "letters", "fade", "think"]) {
    const lesson = buildLesson(SAMPLE_SONG.lines, gameId, seededRng(4), SAMPLE_SONG.sections);
    assert.equal(lesson.some((question) => question.sing), false);
  }
});
