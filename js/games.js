import { inferSections } from "./parse.js?v=9";
import { contentKey, displayToken, mulberry32, normalizeAnswer, shuffle, tokenize, wordCount } from "./text.js?v=9";

export const GAMES = [
  { id: "lines", name: "Build", detail: "Line order in short rounds", group: "main" },
  { id: "next", name: "Next line", detail: "Recall what comes next", group: "main" },
  { id: "concert", name: "Final run", detail: "Timed run through the song", group: "main" },
  { id: "fill", name: "Fill the blank", detail: "A short warm-up on one word", group: "warm" },
  { id: "order", name: "Word order", detail: "Rebuild one line", group: "warm" },
  { id: "letters", name: "First letters", detail: "Pick the line from first letters", group: "warm" }
];

export const CHAPTERS = [
  { id: "lines", name: "Build", detail: "Line order in short rounds" },
  { id: "next", name: "Next line", detail: "Recall what comes next" },
  { id: "concert", name: "Final run", detail: "Timed run through the song" }
];

const STOP = new Set("a an the and or but if to of in on for at by from with it my we you he she they i is was were".split(" "));
const DECOYS = ["kazoo", "slipper", "marble", "comet", "pocket", "lantern", "sprocket", "velvet"];
const LESSON_LENGTH = 6;
export const CONCERT_SECONDS = 15;
const FINAL_WEIGHTS = [
  { type: "next", weight: 3 },
  { type: "fill", weight: 3 },
  { type: "letters", weight: 3 },
  { type: "swap", weight: 2 },
  { type: "truth", weight: 3 },
  { type: "lines", weight: 1 }
];

export function secondsForLine(line) {
  const words = wordCount(line);
  return Math.min(15, Math.max(5, 2 + words * 0.5));
}

export function questionSeconds(question) {
  if (!question) return 5;
  if (question.sing) return secondsForLine(question.answer || question.line || "");
  if (question.kind === "lines" || question.kind === "order") {
    const text = question.kind === "order"
      ? (question.line || "")
      : (question.tokens || []).map((token) => token.text).join(" ");
    return secondsForLine(text);
  }
  return secondsForLine(question.line || question.prompt || "");
}

export function sectionBlocks(lines, sections = []) {
  const list = lines || [];
  const labels = inferSections(list, sections);
  const raw = [];
  let start = 0;
  const nameAt = (index) => String(labels[index] || "").trim();
  for (let index = 1; index <= list.length; index += 1) {
    if (index === list.length || nameAt(index) !== nameAt(start)) {
      raw.push({ start, end: index, name: nameAt(start) });
      start = index;
    }
  }
  const seen = new Map();
  let part = 0;
  return raw.map((block) => {
    let base = block.name;
    if (!base) {
      part += 1;
      base = `Part ${part}`;
    }
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return {
      id: `s${block.start}`,
      start: block.start,
      end: block.end,
      label: count === 1 ? base : `${base} ${count}`,
      lines: list.slice(block.start, block.end)
    };
  });
}

export function gameAvailability(lines, sections = []) {
  const list = lines || [];
  const blocks = sectionBlocks(list, sections);
  return {
    fill: list.some((line) => chooseBlank(tokenize(line), () => 0)),
    order: list.some((line) => tokenize(line).length >= 3),
    next: list.length >= 3,
    letters: list.some((line) => tokenize(line).length >= 1),
    concert: list.length >= 1 && list.some((line) => tokenize(line).length >= 1),
    lines: blocks.some((block) => block.lines.length >= 2)
  };
}

export function firstLessonId(lines, sections = []) {
  const availability = gameAvailability(lines, sections);
  for (const id of ["lines", "next", "fill", "letters", "order"]) {
    if (availability[id]) return id;
  }
  return "letters";
}

export function letterHint(line) {
  return tokenize(line).map((word) => {
    const chars = [...word];
    const first = chars[0] || "";
    const rest = chars.slice(1).map((char) => (/[\p{L}\p{N}]/u.test(char) ? "•" : char)).join("");
    return `${first}${rest}`;
  }).join("  ");
}

export function answersMatch(expected, given) {
  return normalizeAnswer(expected) === normalizeAnswer(given);
}

// Sung answers are rough transcripts. Caps and punctuation are ignored, and
// the line counts when most of its words show up in order.
const SING_WORD_MATCH = 0.7;

export function singingMatch(expected, given) {
  const answer = normalizeAnswer(expected).split(" ").filter(Boolean);
  const heard = normalizeAnswer(given).split(" ").filter(Boolean);
  if (!answer.length || !heard.length) return false;
  let cursor = 0;
  let matched = 0;
  for (const word of heard) {
    const at = answer.indexOf(word, cursor);
    if (at < 0) continue;
    matched += 1;
    cursor = at + 1;
  }
  return matched / answer.length >= SING_WORD_MATCH;
}

export function pointsFor({ kind, correct, combo, secondsLeft }) {
  if (!correct) return { xp: 0, score: 0 };
  const base = { fill: 10, next: 10, order: 12, letters: 15, lines: 14, previous: 10, swap: 12, intruder: 12, which: 10, truth: 10 }[kind] || 10;
  const xp = base + Math.min(10, Math.max(0, combo - 1) * 2);
  let score = 100 + combo * 10;
  if (typeof secondsLeft === "number") score += Math.max(0, Math.round(secondsLeft * 8));
  return { xp, score };
}

export function lineContext(lines, index, sections = []) {
  const list = lines || [];
  const total = list.length;
  if (!total) return { section: "", position: 0, total: 0, previous: "", next: "" };
  const at = Math.max(0, Math.min(index, total - 1));
  return {
    section: String(sections?.[at] || ""),
    position: at + 1,
    total,
    previous: at > 0 ? list[at - 1] : "",
    next: at < total - 1 ? list[at + 1] : ""
  };
}

export function exposedText(question) {
  if (!question) return "";
  return [
    question.prompt,
    question.before,
    question.after,
    question.hint,
    question.context?.previous,
    question.context?.next
  ].filter(Boolean).join("\n");
}

export function correctLine(question) {
  if (!question) return "";
  if (question.kind === "lines") {
    return (question.tokens || []).map((token) => token.text).join("\n");
  }
  return question.line || question.answer || "";
}

export function gradeAnswer(question, given) {
  if (!question) return false;
  if (question.kind === "swap") {
    const word = (question.words || []).find((item) => item.id === given);
    return Boolean(word?.wrong);
  }
  if (question.kind === "order" || question.kind === "lines") {
    return isOrderCorrect(question, given);
  }
  if (question.sing) return singingMatch(question.answer || question.line, given);
  return answersMatch(question.answer, given);
}

function withContext(question, lines, sections) {
  if (!question) return null;
  const context = question.context ? { ...question.context } : lineContext(lines, question.lineIndex, sections);
  if (question.kind !== "lines") context.next = "";
  if (question.hidesPrevious) context.previous = "";
  return { ...question, context, span: question.span || 1 };
}

function shuffleTokens(tokens, rng) {
  let shuffled = shuffle(tokens, rng);
  if (shuffled.length > 1 && shuffled.every((token, index) => token.id === tokens[index].id)) {
    shuffled = [...shuffled.slice(1), shuffled[0]];
  }
  return shuffled;
}

export function lineWindowSizes(total) {
  if (total < 2) return [];
  if (total <= 5) return [total];
  let parts = Math.ceil(total / 5);
  while (parts > 1 && total / parts < 3) parts -= 1;
  while (Math.ceil(total / parts) > 5) parts += 1;
  const base = Math.floor(total / parts);
  let extra = total % parts;
  const sizes = [];
  for (let index = 0; index < parts; index += 1) {
    sizes.push(base + (extra > 0 ? 1 : 0));
    if (extra > 0) extra -= 1;
  }
  if (sizes.length > 1 && sizes[sizes.length - 1] < 3) {
    sizes[sizes.length - 2] += sizes.pop();
  }
  return sizes;
}

function stampRounds(questions) {
  const seen = new Map();
  return questions.filter(Boolean).map((question) => {
    const parts = question.roundLines || [question.line || question.prompt || question.answer || ""];
    const base = contentKey(parts);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return { ...question, roundId: count === 1 ? base : `${base}-${count}` };
  });
}

function makeLineWindow(lines, block, start, end, rng) {
  const tokens = [];
  for (let index = start; index < end; index += 1) {
    tokens.push({ id: `l${index}`, text: lines[index] });
  }
  if (tokens.length < 2) return null;
  const windowLines = lines.slice(start, end);
  return {
    kind: "lines",
    lineIndex: start,
    line: lines[start] || "",
    span: end - start,
    tokens,
    shuffled: shuffleTokens(tokens, rng),
    roundLines: windowLines,
    context: {
      section: block.label,
      position: start + 1,
      total: lines.length,
      previous: start > 0 ? lines[start - 1] : "",
      next: "",
      rangeLabel: `${block.label} · lines ${start + 1}–${end} of ${lines.length}`
    }
  };
}

function lineQuestions(lines, sections, rng) {
  const questions = [];
  for (const block of sectionBlocks(lines, sections)) {
    if (block.lines.length < 2) continue;
    let offset = 0;
    for (const size of lineWindowSizes(block.lines.length)) {
      const start = block.start + offset;
      const question = makeLineWindow(lines, block, start, start + size, rng);
      if (question) questions.push(question);
      offset += size;
    }
  }
  return questions;
}

function weightedPick(pool, rng) {
  const total = pool.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  for (const item of pool) {
    roll -= item.weight;
    if (roll < 0) return item.type;
  }
  return pool[pool.length - 1].type;
}

export function mixTypes(weighted, count, rng = Math.random) {
  const usable = (weighted || []).filter((item) => item.weight > 0);
  const sequence = [];
  for (let index = 0; index < count; index += 1) {
    const banned = sequence.length >= 2 && sequence.at(-1) === sequence.at(-2) ? sequence.at(-1) : null;
    let pool = usable.filter((item) => item.type !== banned);
    if (!pool.length) pool = usable;
    if (!pool.length) break;
    sequence.push(weightedPick(pool, rng));
  }
  return sequence;
}

function interleave(backbone, fillers) {
  const tagged = stampRounds(backbone);
  const out = [];
  const pending = [...fillers];
  let runKind = "";
  let run = 0;
  let currentId = "";
  const push = (question) => {
    if (!question) return;
    const roundId = question.roundId || currentId;
    if (question.roundId) currentId = question.roundId;
    if (question.kind === runKind) run += 1;
    else {
      runKind = question.kind;
      run = 1;
    }
    out.push({ ...question, roundId });
  };
  for (const question of tagged) {
    if (run >= 2 && pending.length) push(pending.shift());
    push(question);
  }
  while (pending.length && run < 2) push(pending.shift());
  return out;
}

function makeByKind(kind, lines, sections, index, rng, span = 0) {
  if (kind === "fill") return makeFill(lines, index, rng);
  if (kind === "letters") return makeLetters(lines, index, rng);
  if (kind === "next") return makeNext(lines, index, rng);
  if (kind === "previous") return makePrevious(lines, index, rng);
  if (kind === "swap") return makeSwap(lines, index, rng);
  if (kind === "truth") return makeTruth(lines, index, rng);
  if (kind === "which") return makeWhich(lines, sections, index, rng);
  if (kind === "intruder") return makeIntruder(lines, sections, rng);
  if (kind === "lines") {
    const count = span || Math.min(3, lines.length - index);
    if (count < 2) return null;
    const blocks = sectionBlocks(lines, sections);
    const block = blocks.find((item) => index >= item.start && index < item.end) || { label: "", start: 0 };
    return makeLineWindow(lines, block, index, index + count, rng);
  }
  if (kind === "order") return makeOrder(lines[index], index, rng);
  return null;
}

function varied(lines, sections, rng, weights, count) {
  const made = [];
  const recent = [];
  let guard = 0;
  while (made.length < count && guard < count * 8) {
    guard += 1;
    const banned = recent.length >= 2 && recent.at(-1) === recent.at(-2) ? recent.at(-1) : null;
    const pool = weights.filter((item) => item.type !== banned);
    const kind = weightedPick(pool.length ? pool : weights, rng);
    const index = Math.floor(rng() * lines.length);
    const question = makeByKind(kind, lines, sections, index, rng);
    if (!question) continue;
    made.push(withContext(question, lines, sections));
    recent.push(question.kind);
  }
  return made;
}

const BUILD_WEIGHTS = [
  { type: "fill", weight: 2 },
  { type: "swap", weight: 2 },
  { type: "intruder", weight: 2 },
  { type: "next", weight: 2 },
  { type: "previous", weight: 1 }
];
const NEXT_WEIGHTS = [
  { type: "previous", weight: 3 },
  { type: "letters", weight: 3 },
  { type: "fill", weight: 2 },
  { type: "truth", weight: 2 },
  { type: "which", weight: 1 }
];

function lineLesson(lines, sections, rng, chunk) {
  let backbone = lineQuestions(lines, sections, rng);
  if (Number.isInteger(chunk)) {
    backbone = backbone.filter((question) => question.lineIndex === chunk);
    if (!backbone.length) {
      const blocks = sectionBlocks(lines, sections);
      const block = blocks.find((item) => chunk >= item.start && chunk < item.end);
      if (block && block.lines.length >= 2) {
        const end = Math.min(block.end, chunk + (lineWindowSizes(block.lines.length)[0] || block.lines.length));
        const question = makeLineWindow(lines, block, chunk, end, rng);
        if (question) backbone = [question];
      }
    }
  }
  const fillers = Number.isInteger(chunk) ? [] : varied(lines, sections, rng, BUILD_WEIGHTS, Math.max(1, Math.floor(backbone.length / 2)));
  return interleave(backbone, fillers);
}

function nextLesson(lines, sections, rng) {
  const backbone = [];
  const order = shuffle(lines.map((_, index) => index).filter((index) => canAsk(lines, index, "next")), rng).slice(0, LESSON_LENGTH);
  for (const index of order) {
    const question = makeNext(lines, index, rng);
    if (question) backbone.push(withContext(question, lines, sections));
  }
  const fillers = varied(lines, sections, rng, NEXT_WEIGHTS, Math.max(1, Math.floor(backbone.length / 2)));
  return interleave(backbone, fillers);
}

function canFinal(type, lines, index) {
  const rest = lines.length - index;
  if (type === "lines") return rest >= 3;
  if (type === "next" || type === "truth") return rest >= 2;
  if (type === "fill") return Boolean(chooseBlank(tokenize(lines[index] || ""), () => 0));
  if (type === "swap") return Boolean(chooseBlank(tokenize(lines[index] || ""), () => 0));
  if (type === "letters") return tokenize(lines[index] || "").length >= 1;
  return false;
}

function finalRun(lines, sections, rng) {
  const questions = [];
  const recent = [];
  let index = 0;
  while (index < lines.length) {
    const banned = recent.length >= 2 && recent.at(-1) === recent.at(-2) ? recent.at(-1) : null;
    const possible = FINAL_WEIGHTS.filter((item) => canFinal(item.type, lines, index));
    let pool = possible.filter((item) => item.type !== banned);
    if (!pool.length) pool = possible;
    let question = null;
    if (pool.length) {
      const kind = weightedPick(pool, rng);
      question = makeByKind(kind, lines, sections, index, rng, kind === "lines" ? 3 : 0);
    }
    if (!question) question = makeLetters(lines, index, rng) || makeFill(lines, index, rng);
    if (!question) break;
    question.lineIndex = index;
    question.span = question.kind === "lines" ? (question.tokens || []).length : 1;
    questions.push(withContext(question, lines, sections));
    recent.push(question.kind);
    index += question.span;
  }
  return stampRounds(questions);
}

function keepRounds(questions, options) {
  const skip = new Set(options.skipIds || []);
  const only = options.roundId || "";
  if (only) {
    const picked = questions.filter((question) => question.roundId === only);
    return picked.length ? picked : questions.filter((question) => question.roundId === only);
  }
  if (!skip.size) return questions;
  const kept = questions.filter((question) => !question.roundId || !skip.has(question.roundId));
  return kept;
}

function markSing(questions, rng, count, force) {
  const slots = [];
  questions.forEach((question, index) => {
    if (question?.kind === "next") slots.push(index);
  });
  const total = Math.min(Math.max(0, count), slots.length);
  const picked = new Set(shuffle(slots, rng).slice(0, total));
  if (force && slots.length && !picked.has(slots[0])) {
    if (picked.size) picked.delete([...picked][0]);
    picked.add(slots[0]);
  }
  if (!picked.size) return questions;
  return questions.map((question, index) => (picked.has(index) ? { ...question, sing: true } : question));
}

export function buildLesson(lines, gameId, rng = Math.random, sections = [], options = {}) {
  const list = [...(lines || [])];
  const labels = sections || [];
  if (gameId === "lines") return keepRounds(lineLesson(list, labels, rng, Number.isInteger(options.chunk) ? options.chunk : null), options);
  if (gameId === "next") {
    const lesson = keepRounds(nextLesson(list, labels, rng), options);
    const nextCount = lesson.filter((question) => question.kind === "next").length;
    return markSing(lesson, rng, Math.round(nextCount / 3), options.forceSing);
  }
  if (gameId === "concert") {
    const lesson = finalRun(list, labels, rng);
    return markSing(lesson, rng, 2, options.forceSing);
  }
  const eligible = list.map((_, index) => index).filter((index) => canAsk(list, index, gameId));
  const count = Math.min(LESSON_LENGTH, eligible.length);
  return stampRounds(shuffle(eligible, rng).slice(0, count).map((index) => withContext(makeQuestion(list, index, gameId, rng), list, labels)).filter(Boolean));
}

export function chapterPlan(lines, sections = [], cleared = {}) {
  const availability = gameAvailability(lines, sections);
  let waiting = false;
  return CHAPTERS.map((chapter) => {
    const playable = Boolean(availability[chapter.id]);
    const done = Boolean(cleared[chapter.id]);
    let status = "open";
    if (!playable) status = "unavailable";
    else if (waiting) status = "locked";
    else if (done) status = "done";
    if (playable && !done) waiting = true;
    return { ...chapter, status, done: status === "done" };
  });
}

function unfinished(questions, rounds) {
  return questions.find((question) => question.roundId && !rounds[question.roundId]?.mastered);
}

export function nextPractice(lines, sections = [], { rounds = {}, chapters = {} } = {}) {
  const build = lineLesson(lines, sections, () => 0.5, null);
  const recall = nextLesson(lines, sections, () => 0.5);
  const buildDone = !unfinished(build, rounds);
  const recallDone = !unfinished(recall, rounds);
  const plan = chapterPlan(lines, sections, {
    ...chapters,
    lines: chapters.lines || buildDone,
    next: chapters.next || recallDone
  });
  const playable = (id) => plan.find((chapter) => chapter.id === id)?.status === "open";
  if (playable("lines")) {
    const question = unfinished(build, rounds);
    if (question) return { gameId: "lines", roundId: question.roundId };
  }
  if (playable("next")) {
    const question = unfinished(recall, rounds);
    if (question) return { gameId: "next", roundId: question.roundId };
  }
  return { gameId: "concert" };
}

export function sectionProgress(lines, sections = [], rounds = {}) {
  return sectionBlocks(lines, sections).map((block) => {
    const questions = [];
    if (block.lines.length >= 2) {
      let offset = 0;
      for (const size of lineWindowSizes(block.lines.length)) {
        const start = block.start + offset;
        const question = makeLineWindow(lines, { label: block.label }, start, start + size, () => 0.5);
        if (question) questions.push(question);
        offset += size;
      }
    }
    const stamped = stampRounds(questions);
    let mastered = 0;
    for (const question of stamped) {
      if (rounds[question.roundId]?.mastered) mastered += question.roundLines.length;
    }
    const again = stamped.find((question) => rounds[question.roundId]?.mastered);
    return {
      id: block.id,
      label: block.label,
      opener: block.lines[0] || block.label,
      start: block.start,
      total: block.lines.length,
      mastered,
      roundId: (stamped.find((question) => !rounds[question.roundId]?.mastered) || again || {}).roundId || "",
      done: block.lines.length > 0 && mastered >= block.lines.length
    };
  });
}

function canAsk(lines, index, kind) {
  if (kind === "next") return index < lines.length - 1 && lines.length >= 3;
  if (kind === "order") return tokenize(lines[index]).length >= 3;
  if (kind === "fill") return Boolean(chooseBlank(tokenize(lines[index]), () => 0));
  if (kind === "letters") return tokenize(lines[index]).length >= 1;
  return false;
}

function makeQuestion(lines, index, kind, rng) {
  const line = lines[index];
  if (kind === "fill") return makeFill(lines, index, rng);
  if (kind === "order") return makeOrder(line, index, rng);
  if (kind === "next") return makeNext(lines, index, rng);
  if (kind === "letters") return makeLetters(lines, index, rng);
  return null;
}

function makeFill(lines, index, rng) {
  const parts = tokenize(lines[index]);
  const chosen = chooseBlank(parts, rng);
  if (!chosen) return null;
  const answer = displayToken(chosen.token);
  const distractors = shuffle(collectDistractors(lines, answer), rng).slice(0, 3);
  const choices = shuffle([answer, ...distractors], rng);
  return {
    kind: "fill",
    lineIndex: index,
    line: lines[index],
    before: parts.slice(0, chosen.index).join(" "),
    after: parts.slice(chosen.index + 1).join(" "),
    answer,
    choices,
    span: 1,
    roundLines: [lines[index]]
  };
}

function makeOrder(line, index, rng) {
  const tokens = tokenize(line).map((text, tokenIndex) => ({
    id: `t${tokenIndex}`,
    text: displayToken(text)
  }));
  if (tokens.length < 3) return null;
  return {
    kind: "order",
    lineIndex: index,
    line,
    answer: line,
    tokens,
    shuffled: shuffleTokens(tokens, rng),
    span: 1,
    roundLines: [line]
  };
}

function makeNext(lines, index, rng) {
  if (index >= lines.length - 1) return null;
  const answer = lines[index + 1];
  const distractors = shuffle(lines.filter((line, lineIndex) => lineIndex !== index && lineIndex !== index + 1 && normalizeAnswer(line) !== normalizeAnswer(answer)), rng).slice(0, 3);
  if (!distractors.length) return null;
  return {
    kind: "next",
    lineIndex: index,
    line: lines[index],
    prompt: lines[index],
    answer,
    choices: shuffle([answer, ...distractors], rng),
    span: 1,
    roundLines: [lines[index], answer]
  };
}

function makePrevious(lines, index, rng) {
  if (index <= 0) return null;
  const answer = lines[index - 1];
  const distractors = shuffle(lines.filter((line, lineIndex) => lineIndex !== index - 1 && normalizeAnswer(line) !== normalizeAnswer(answer)), rng).slice(0, 3);
  if (!distractors.length) return null;
  return {
    kind: "previous",
    lineIndex: index,
    line: lines[index],
    prompt: lines[index],
    answer,
    choices: shuffle([answer, ...distractors], rng),
    hidesPrevious: true,
    span: 1,
    roundLines: [answer, lines[index]]
  };
}

function makeLetters(lines, index, rng) {
  const line = lines[index];
  if (!tokenize(line).length) return null;
  const distractors = shuffle(lines.filter((item, lineIndex) => lineIndex !== index && normalizeAnswer(item) !== normalizeAnswer(line)), rng).slice(0, 3);
  return {
    kind: "letters",
    lineIndex: index,
    line,
    answer: line,
    hint: letterHint(line),
    choices: distractors.length ? shuffle([line, ...distractors], rng) : [line],
    span: 1,
    roundLines: [line]
  };
}

function makeSwap(lines, index, rng) {
  const parts = tokenize(lines[index]);
  const chosen = chooseBlank(parts, rng);
  if (!chosen) return null;
  const answer = displayToken(chosen.token);
  const decoy = shuffle(collectDistractors(lines, answer), rng)[0];
  if (!decoy) return null;
  const words = parts.map((token, tokenIndex) => ({
    id: `w${tokenIndex}`,
    text: tokenIndex === chosen.index ? decoy : displayToken(token),
    wrong: tokenIndex === chosen.index
  }));
  return {
    kind: "swap",
    lineIndex: index,
    line: lines[index],
    words,
    answer,
    span: 1,
    roundLines: [lines[index]]
  };
}

function makeTruth(lines, index, rng) {
  if (index >= lines.length - 1) return null;
  const real = lines[index + 1];
  const others = lines.filter((line, lineIndex) => lineIndex !== index + 1 && normalizeAnswer(line) !== normalizeAnswer(real));
  const truthful = rng() < 0.5 || !others.length;
  const claim = truthful ? real : others[Math.floor(rng() * others.length)];
  return {
    kind: "truth",
    lineIndex: index,
    line: lines[index],
    prompt: lines[index],
    claim,
    answer: normalizeAnswer(claim) === normalizeAnswer(real) ? "True" : "False",
    choices: ["True", "False"],
    span: 1,
    roundLines: [lines[index]]
  };
}

function makeWhich(lines, sections, index, rng) {
  const blocks = sectionBlocks(lines, sections);
  const names = [...new Set(blocks.map((block) => block.label.replace(/\s+\d+$/, "")))];
  if (names.length < 2) return null;
  const block = blocks.find((item) => index >= item.start && index < item.end);
  if (!block) return null;
  const answer = block.label.replace(/\s+\d+$/, "");
  let choices = shuffle(names, rng).slice(0, 4);
  if (!choices.includes(answer)) choices = shuffle([answer, ...choices.slice(0, 3)], rng);
  return {
    kind: "which",
    lineIndex: index,
    line: lines[index],
    prompt: lines[index],
    answer,
    choices,
    span: 1,
    roundLines: [lines[index]]
  };
}

function makeIntruder(lines, sections, rng) {
  const blocks = sectionBlocks(lines, sections).filter((block) => block.lines.length);
  if (blocks.length < 2) return null;
  const home = blocks[Math.floor(rng() * blocks.length)];
  const others = blocks.filter((block) => block.id !== home.id);
  const foreign = others[Math.floor(rng() * others.length)];
  const keep = shuffle([...home.lines], rng).slice(0, 3);
  const intruder = foreign.lines[Math.floor(rng() * foreign.lines.length)];
  if (keep.some((line) => normalizeAnswer(line) === normalizeAnswer(intruder))) return null;
  return {
    kind: "intruder",
    lineIndex: home.start,
    line: keep[0],
    choices: shuffle([...keep, intruder], rng),
    answer: intruder,
    span: 1,
    roundLines: keep
  };
}

function chooseBlank(tokens, rng) {
  const indexed = tokens.map((token, index) => ({ token, index, chip: displayToken(token) }));
  const good = indexed.filter((item) => {
    const word = normalizeAnswer(item.chip);
    return word.length >= 4 && !STOP.has(word);
  });
  const pool = good.length ? good : indexed.filter((item) => normalizeAnswer(item.chip).length >= 2);
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}

function collectDistractors(lines, answer) {
  const target = normalizeAnswer(answer);
  const words = [];
  const seen = new Set([target]);
  for (const line of lines) {
    for (const token of tokenize(line)) {
      const chip = displayToken(token);
      const word = normalizeAnswer(chip);
      if (word.length < 3 || seen.has(word)) continue;
      seen.add(word);
      words.push(chip);
    }
  }
  for (const decoy of DECOYS) {
    if (words.length >= 3) break;
    if (seen.has(decoy)) continue;
    seen.add(decoy);
    words.push(decoy);
  }
  return words;
}

export function lessonBonus(answered, total) {
  if (!total || answered < total) return 0;
  return 20;
}

export function seededRng(seed) {
  return mulberry32(seed);
}

export function isOrderCorrect(question, arrangedIds) {
  const tokens = question?.tokens || [];
  if (!tokens.length || arrangedIds?.length !== tokens.length) return false;
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const seen = new Set();
  for (let index = 0; index < arrangedIds.length; index += 1) {
    const id = arrangedIds[index];
    if (seen.has(id)) return false;
    const token = byId.get(id);
    if (!token) return false;
    seen.add(id);
    const expected = normalizeAnswer(tokens[index].text);
    if (!expected || expected !== normalizeAnswer(token.text)) return false;
  }
  return true;
}

export function judgeOrderTap(question, placedIds, candidateId) {
  const tokens = question?.tokens || [];
  const placed = placedIds || [];
  const token = tokens.find((item) => item.id === candidateId);
  if (!token || placed.includes(candidateId) || placed.length >= tokens.length) return false;
  const expected = normalizeAnswer(tokens[placed.length].text);
  return expected.length > 0 && expected === normalizeAnswer(token.text);
}
