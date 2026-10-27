import assert from "node:assert/strict";
import test from "node:test";
import {
  FADE_PASSES,
  advanceFade,
  answersMatch,
  applyThink,
  buildLesson,
  chapterPlan,
  exposedText,
  fadeView,
  hiddenWordIndexes,
  initialThink,
  lineWindowSizes,
  nextPractice,
  studyFrame
} from "../js/games.js";
import { displayToken, normalizeAnswer, tokenize } from "../js/text.js";

const LINES = [
  "alpha one two three",
  "beta four five six",
  "gamma seven eight nine",
  "delta ten eleven twelve",
  "epsilon thirteen fourteen",
  "zeta fifteen sixteen seventeen"
];
const SECTIONS = ["Verse", "Verse", "Verse", "Verse", "Chorus", "Chorus"];

function visibleText(frame) {
  return [frame.previous, frame.target, (frame.words || []).filter(Boolean).join(" ")]
    .filter(Boolean)
    .join("\n");
}

function assertHiddenFuture(frame) {
  const visible = visibleText(frame);
  for (const later of frame.future) {
    assert.equal(visible.includes(later), false, later);
  }
}

test("fade rounds hide more words each pass and never show a later line", () => {
  assert.deepEqual(FADE_PASSES, ["full", "some", "mostly", "none"]);
  const lesson = buildLesson(LINES, "fade", () => 0.2, SECTIONS);
  assert.ok(lesson.length >= 1);
  for (const question of lesson) {
    assert.equal(question.kind, "fade");
    assert.ok(question.steps.length >= 2 && question.steps.length <= 6);
    assert.equal(question.context.next, "");
    assert.equal(question.roundId.startsWith("fade-"), true);
    const visible = exposedText(question);
    for (const step of question.steps.slice(1)) {
      assert.equal(visible.includes(step.text), false);
    }
    const counts = FADE_PASSES.map((pass) => hiddenWordIndexes(tokenize(question.steps[0].text).length, pass).length);
    assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
    assert.equal(counts[0], 0);
    assert.equal(counts[3], tokenize(question.steps[0].text).length);
    assert.ok(counts[2] > counts[1]);

    let state = { pass: 0, line: 0, revealed: 0 };
    const seen = [];
    let guard = 0;
    while (!state.finished && guard < 400) {
      guard += 1;
      const frame = studyFrame(question, state);
      assert.equal(frame.kind, "fade");
      assertHiddenFuture(frame);
      assert.equal(frame.words.length, tokenize(question.steps[frame.line].text).length);
      if (!frame.done && frame.pass !== "full") assert.equal(frame.words.includes(""), true);
      seen.push(frame.pass);
      const next = advanceFade(question, state);
      if (next.finished) {
        state = { ...state, finished: true };
        break;
      }
      state = next;
    }
    assert.equal(state.finished, true);
    for (const pass of FADE_PASSES) assert.equal(seen.includes(pass), true);
  }
  const six = Array.from({ length: 6 }, (_, index) => `lantern round word ${index} stays here`);
  const oneRound = buildLesson(six, "fade", () => 0.4, six.map(() => "Verse"));
  assert.deepEqual(oneRound.map((question) => question.steps.length), [6]);
  const seven = Array.from({ length: 7 }, (_, index) => `lantern round word ${index} stays here`);
  assert.deepEqual(lineWindowSizes(7), [4, 3]);
  assert.deepEqual(
    buildLesson(seven, "fade", () => 0.4, seven.map(() => "Verse")).map((question) => question.steps.length),
    [4, 3]
  );
});

test("fade treats caps and punctuation as the same words", () => {
  const fancy = "Don't STOP, world!";
  const plain = "dont stop world";
  assert.equal(tokenize(fancy).length, tokenize(plain).length);
  for (const pass of FADE_PASSES) {
    assert.deepEqual(hiddenWordIndexes(tokenize(fancy).length, pass), hiddenWordIndexes(tokenize(plain).length, pass));
    const shown = fadeView(fancy, pass, 99);
    const other = fadeView(plain, pass, 99);
    assert.equal(shown.done, true);
    shown.words.forEach((word, index) => {
      assert.equal(normalizeAnswer(word), normalizeAnswer(other.words[index]));
      assert.equal(answersMatch(word, other.words[index]), true);
      assert.equal(word, displayToken(tokenize(fancy)[index]));
    });
  }
  const none = fadeView(fancy, "none", 0);
  assert.deepEqual(none.shown, ["", "", ""]);
  const revealed = fadeView(fancy, "none", 1);
  assert.equal(revealed.shown[0], "Don't");
  assert.equal(revealed.shown[1], "");
});

test("think shows the previous line, hides the target until show, and replays a miss later", () => {
  const lesson = buildLesson(LINES, "think", () => 0.3, SECTIONS);
  const question = lesson[0];
  assert.ok(question.steps.length >= 3 && question.steps.length <= 6);
  assert.equal(question.context.next, "");
  assert.equal(question.roundId.startsWith("think-"), true);
  let state = initialThink(question);
  const frame = studyFrame(question, state);
  assert.equal(frame.target, "");
  assert.equal(frame.action, "Show");
  assert.equal(frame.prompt, question.steps[0].previous ? "Recall the next line" : "Recall this line");
  assertHiddenFuture(frame);
  const recalled = studyFrame(question, { ...state, queue: state.queue.slice(1) });
  assert.equal(recalled.prompt, "Recall the next line");
  assert.equal(recalled.previous, question.steps[0].text);
  assert.equal(recalled.target, "");
  assertHiddenFuture(recalled);
  const shown = studyFrame(question, { ...state, phase: "rate" });
  assert.equal(shown.target, question.steps[0].text);
  assert.equal(shown.action, "Got it");
  assertHiddenFuture(shown);
  for (const later of question.steps.slice(1)) {
    assert.notEqual(shown.target, later.text);
  }

  const first = state.queue[0].id;
  state = applyThink(state, false);
  assert.equal(state.finished, false);
  assert.equal(state.queue.at(-1).id, first);
  assert.equal(state.queue.at(-1).tries, 1);
  assert.notEqual(state.queue[0].id, first);
  assert.equal(studyFrame(question, state).target, "");
  while (state.queue[0] && state.queue[0].id !== first) state = applyThink(state, true);
  state = applyThink(state, false);
  assert.equal(state.queue.some((step) => step.id === first), false);
  assert.equal(state.misses, 1);
  assert.equal(state.got.includes(first), false);
  while (!state.finished) state = applyThink(state, true);
  assert.equal(state.finished, true);

  const solo = buildLesson(["only lantern line here"], "think", () => 0, ["Verse"]);
  let again = initialThink(solo[0]);
  assert.equal(studyFrame(solo[0], again).prompt, "Recall this line");
  assert.equal(studyFrame(solo[0], again).previous, "");
  again = applyThink(again, false);
  assert.equal(again.finished, false);
  assert.equal(again.queue[0].tries, 1);
  again = applyThink(again, true);
  assert.equal(again.finished, true);
  assert.equal(again.misses, 0);
  assert.deepEqual(again.got, [0]);
});

test("mastered fade and think rounds are skipped and the final run still covers them", () => {
  const fade = buildLesson(LINES, "fade", () => 0.2, SECTIONS);
  const think = buildLesson(LINES, "think", () => 0.2, SECTIONS);
  const skip = [fade[0].roundId];
  const rest = buildLesson(LINES, "fade", () => 0.2, SECTIONS, { skipIds: skip });
  assert.equal(rest.some((question) => question.roundId === skip[0]), false);
  assert.equal(rest.some((question) => question.roundId === fade[1].roundId), true);
  const again = buildLesson(LINES, "fade", () => 0.2, SECTIONS, { roundId: skip[0] });
  assert.ok(again.some((question) => question.roundId === skip[0]));
  const rounds = {};
  for (const question of fade) rounds[question.roundId] = { mastered: true };
  assert.equal(nextPractice(LINES, SECTIONS, { rounds }).gameId, "think");
  for (const question of think) rounds[question.roundId] = { mastered: true };
  assert.equal(nextPractice(LINES, SECTIONS, { rounds }).gameId, "lines");
  const concert = buildLesson(LINES, "concert", () => 0.2, SECTIONS, { skipIds: [...Object.keys(rounds)] });
  assert.equal(concert.reduce((sum, question) => sum + (question.span || 1), 0), LINES.length);
  const plan = chapterPlan(LINES, SECTIONS, { fade: true, think: true });
  assert.equal(plan.find((chapter) => chapter.id === "lines").status, "open");
  assert.equal(plan.find((chapter) => chapter.id === "concert").status, "locked");
});
