import { inferSections } from "./parse.js?v=9";
import { contentKey, displayToken, mulberry32, normalizeAnswer, normalizeSing, shuffle, tokenize, wordCount } from "./text.js?v=11";

export const GAMES = [
  { id: "round", name: "Round", detail: "A few lines", group: "main" },
  { id: "fade", name: "Fade", detail: "Hide more words", group: "main" },
  { id: "think", name: "Think", detail: "Recall, then check", group: "main" },
  { id: "lines", name: "Build", detail: "Order the lines", group: "main" },
  { id: "next", name: "Next", detail: "What comes next", group: "main" },
  { id: "concert", name: "Final run", detail: "Full song, timed", group: "main" },
  { id: "fill", name: "Fill", detail: "One missing word", group: "warm" },
  { id: "order", name: "Order", detail: "Rebuild one line", group: "warm" },
  { id: "letters", name: "Letters", detail: "From first letters", group: "warm" }
];

export const CHAPTERS = [
  { id: "fade", name: "Fade", detail: "Hide more words" },
  { id: "think", name: "Think", detail: "Recall, then check" },
  { id: "lines", name: "Build", detail: "Order the lines" },
  { id: "next", name: "Next", detail: "What comes next" },
  { id: "concert", name: "Final run", detail: "Full song, timed" }
];

const STOP = new Set("a an the and or but if to of in on for at by from with it my we you he she they i is was were".split(" "));
const DECOYS = ["kazoo", "slipper", "marble", "comet", "pocket", "lantern", "sprocket", "velvet"];
const LESSON_LENGTH = 6;
export const CONCERT_SECONDS = 15;
const FINAL_WEIGHTS = [
  { type: "next", weight: 3 },
  { type: "fill", weight: 3 },
  { type: "letters", weight: 3 },
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
    round: list.some((line) => tokenize(line).length >= 1),
    fill: list.some((line) => chooseBlank(tokenize(line), () => 0)),
    order: list.some((line) => tokenize(line).length >= 3),
    next: list.length >= 3,
    letters: list.some((line) => tokenize(line).length >= 1),
    concert: list.length >= 1 && list.some((line) => tokenize(line).length >= 1),
    lines: blocks.some((block) => block.lines.length >= 2),
    fade: list.some((line) => tokenize(line).length >= 1),
    think: list.some((line) => tokenize(line).length >= 1)
  };
}

export function firstLessonId(lines, sections = []) {
  const availability = gameAvailability(lines, sections);
  for (const id of ["round", "fade", "think", "lines", "next", "fill", "letters", "order"]) {
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
  const answer = normalizeSing(expected).split(" ").filter(Boolean);
  const heard = normalizeSing(given).split(" ").filter(Boolean);
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
  const base = { fill: 10, next: 10, order: 12, letters: 15, lines: 14, fade: 12, think: 12, previous: 10, intruder: 12, which: 10, truth: 10 }[kind] || 10;
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
  if (question.kind === "fade" || question.kind === "think") {
    return (question.steps || []).map((step) => step.text).join("\n");
  }
  return question.line || question.answer || "";
}

export function gradeAnswer(question, given) {
  if (!question) return false;
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
  if (total <= 4) return [total];
  const sizes = [];
  let left = total;
  while (left > 0) {
    if (left <= 4) {
      sizes.push(left);
      break;
    }
    if (left === 5) {
      sizes.push(3, 2);
      break;
    }
    if (left === 6) {
      sizes.push(3, 3);
      break;
    }
    const take = left % 4 === 1 ? 3 : 4;
    sizes.push(take);
    left -= take;
  }
  return sizes;
}

function stampRounds(questions) {
  const seen = new Map();
  return questions.filter(Boolean).map((question) => {
    const parts = question.roundLines || [question.line || question.prompt || question.answer || ""];
    const prefix = question.roundPrefix || "";
    const base = `${prefix}${contentKey(parts)}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    const roundId = count === 1 ? base : `${base}-${count}`;
    const { roundPrefix, ...rest } = question;
    return { ...rest, roundId };
  });
}

export const FADE_PASSES = ["full", "some", "half"];

const FADE_PASS_LABELS = {
  full: "Full line",
  some: "Some hidden",
  half: "Half hidden",
  mostly: "Hardest",
  none: "All hidden"
};

export function fadePassLabel(pass) {
  return FADE_PASS_LABELS[pass] || FADE_PASS_LABELS.full;
}

export function fadeLessonFraction(question, state = {}) {
  const steps = question?.steps || [];
  const count = Math.max(1, steps.length);
  const passes = passesFor(question);
  const total = Math.max(1, passes.length);
  if (state?.finished) return 1;
  const pass = Math.max(0, Math.min(total - 1, state?.pass || 0));
  const line = Math.max(0, Math.min(count - 1, state?.line || 0));
  const text = steps[line]?.text || "";
  const hidden = hiddenWordIndexes(tokenize(text).length, passes[pass]).length;
  const revealed = Math.max(0, state?.revealed || 0);
  const linePart = hidden ? Math.min(1, revealed / hidden) : 0;
  return (pass * count + line + linePart) / (total * count);
}

export function hiddenWordIndexes(count, pass) {
  const total = Math.max(0, count | 0);
  if (!total || pass === "full") return [];
  if (pass === "none") return Array.from({ length: total }, (_, index) => index);
  if (pass === "some") {
    const hidden = [];
    for (let index = 2; index < total; index += 3) hidden.push(index);
    if (!hidden.length && total > 1) hidden.push(total - 1);
    if (hidden.length >= total && hidden.length) hidden.pop();
    return hidden;
  }
  if (pass === "mostly") {
    if (total === 1) return [0];
    return Array.from({ length: total - 1 }, (_, index) => index + 1);
  }
  if (pass === "half") {
    const hidden = [];
    for (let index = 1; index < total; index += 2) hidden.push(index);
    if (total > 1) {
      const someCount = hiddenWordIndexes(total, "some").length;
      let cursor = 0;
      while (hidden.length <= someCount && hidden.length < total - 1 && cursor < total) {
        if (!hidden.includes(cursor)) hidden.push(cursor);
        cursor += 1;
      }
      hidden.sort((a, b) => a - b);
    } else if (!hidden.length) {
      hidden.push(0);
    }
    return hidden;
  }
  if (total === 1) return [0];
  return Array.from({ length: total - 1 }, (_, index) => index + 1);
}

export function fadeView(line, pass, revealed = 0) {
  const words = tokenize(line).map((token) => displayToken(token));
  const hidden = hiddenWordIndexes(words.length, pass);
  const pending = new Set(hidden.slice(Math.max(0, revealed)));
  return {
    words,
    hidden,
    shown: words.map((word, index) => (pending.has(index) ? "" : word)),
    done: pending.size === 0
  };
}

function studyWindows(count) {
  if (count <= 0) return [];
  if (count === 1) return [1];
  return lineWindowSizes(count);
}

function makeStudyRound(kind, lines, block, start, end) {
  const steps = [];
  for (let index = start; index < end; index += 1) {
    const text = lines[index];
    if (!tokenize(text).length) continue;
    steps.push({
      id: index,
      text,
      previous: index > 0 ? lines[index - 1] : ""
    });
  }
  if (!steps.length) return null;
  return {
    kind,
    lineIndex: start,
    line: steps[0].text,
    span: end - start,
    steps,
    roundPrefix: kind === "fade" ? "fade-" : "think-",
    roundLines: steps.map((step) => step.text),
    context: {
      section: block.label,
      position: start + 1,
      total: lines.length,
      previous: start > 0 ? lines[start - 1] : "",
      next: "",
      rangeLabel: `${block.label} · ${start + 1}–${end}/${lines.length}`
    }
  };
}

function studyLesson(lines, sections, kind) {
  const questions = [];
  for (const block of sectionBlocks(lines, sections)) {
    let offset = 0;
    for (const size of studyWindows(block.lines.length)) {
      const start = block.start + offset;
      const question = makeStudyRound(kind, lines, block, start, start + size);
      if (question) questions.push(question);
      offset += size;
    }
  }
  return stampRounds(questions);
}

function passesFor(question) {
  const passes = question?.passes;
  if (Array.isArray(passes) && passes.length) return passes;
  return FADE_PASSES;
}

export function studyFrame(question, state = {}) {
  if (!question) return null;
  if (question.kind === "fade") {
    const steps = question.steps || [];
    const passes = passesFor(question);
    const passIndex = Math.max(0, Math.min(passes.length - 1, state.pass || 0));
    const line = Math.max(0, Math.min(Math.max(steps.length - 1, 0), state.line || 0));
    const step = steps[line];
    if (!step) return null;
    const view = fadeView(step.text, passes[passIndex], state.revealed || 0);
    return {
      kind: "fade",
      previous: step.previous || "",
      words: view.shown,
      pass: passes[passIndex],
      passIndex,
      line,
      lineCount: steps.length,
      done: view.done,
      action: view.done ? "Next" : "Show word",
      prompt: view.done ? "Read" : "Missing words",
      future: steps.slice(line + 1).map((item) => item.text)
    };
  }
  if (question.kind === "think") {
    const queue = state.queue || [];
    const current = queue[0];
    if (!current) return null;
    const phase = state.phase === "rate" ? "rate" : "think";
    const steps = question.steps || [];
    const stepIndex = Math.max(0, steps.findIndex((step) => step.id === current.id));
    const section = String(question.context?.section || "").trim();
    const count = Math.max(steps.length, 1);
    const place = section
      ? `${section} · line ${stepIndex + 1}/${count}`
      : `Line ${stepIndex + 1}/${count}`;
    return {
      kind: "think",
      previous: current.previous || "",
      target: phase === "rate" ? current.text : "",
      words: [],
      phase,
      place,
      prompt: phase === "rate"
        ? "Mark it"
        : (current.previous ? "Next line" : "This line"),
      action: phase === "rate" ? "Got it" : "Show",
      future: queue.slice(1).map((item) => item.text),
      currentId: current.id
    };
  }
  return null;
}

export function advanceFade(question, state = {}) {
  const frame = studyFrame(question, state);
  if (!frame) return { pass: 0, line: 0, revealed: 0, finished: true };
  if (!frame.done) {
    return {
      pass: frame.passIndex,
      line: frame.line,
      revealed: (state.revealed || 0) + 1,
      finished: false
    };
  }
  let line = frame.line + 1;
  let pass = frame.passIndex;
  if (line >= (question.steps || []).length) {
    line = 0;
    pass += 1;
  }
  if (pass >= passesFor(question).length) {
    return { pass: frame.passIndex, line: frame.line, revealed: state.revealed || 0, finished: true };
  }
  return { pass, line, revealed: 0, finished: false };
}

export function initialThink(question) {
  return {
    phase: "think",
    queue: (question?.steps || []).map((step) => ({ ...step, tries: 0 })),
    got: [],
    misses: 0,
    finished: false
  };
}

export function rateThink(queue, gotIt) {
  if (!queue?.length) return { queue: [], missed: false, dropped: false, done: true };
  const [current, ...rest] = queue;
  if (gotIt) return { queue: rest, missed: false, dropped: false, done: rest.length === 0 };
  const tries = (current.tries || 0) + 1;
  if (tries >= 2) return { queue: rest, missed: true, dropped: true, done: rest.length === 0 };
  return {
    queue: [...rest, { ...current, tries }],
    missed: true,
    dropped: false,
    done: false
  };
}

export function applyThink(state, gotIt) {
  const queue = state?.queue || [];
  const current = queue[0];
  if (!current) {
    return { phase: "think", queue: [], got: [...(state?.got || [])], misses: state?.misses || 0, finished: true };
  }
  const result = rateThink(queue, gotIt);
  return {
    phase: "think",
    queue: result.queue,
    got: gotIt ? [...(state.got || []), current.id] : [...(state.got || [])],
    misses: (state.misses || 0) + (result.dropped ? 1 : 0),
    finished: result.done
  };
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
      rangeLabel: `${block.label} · ${start + 1}–${end}/${lines.length}`
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

const ROUND_ROTATION = {
  early: ["fade", "order", "fade", "think"],
  middle: ["fade", "think", "order", "sing"],
  late: ["sing", "think", "next", "order"]
};

function roundWindows(count) {
  if (count <= 0) return [];
  if (count === 1) return [1];
  return lineWindowSizes(count);
}

function roundStage(index, count) {
  if (count <= 1) return "middle";
  if (index <= 0) return "early";
  if (index >= count - 1) return "late";
  return "middle";
}

function collectRounds(lines, sections) {
  const specs = [];
  for (const block of sectionBlocks(lines, sections)) {
    let offset = 0;
    for (const size of roundWindows(block.lines.length)) {
      const start = block.start + offset;
      const end = start + size;
      specs.push({
        start,
        end,
        label: block.label,
        lines: lines.slice(start, end),
        block
      });
      offset += size;
    }
  }
  const seen = new Map();
  return specs.map((spec, index) => {
    const base = `mix-${contentKey(spec.lines)}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return {
      ...spec,
      id: count === 1 ? base : `${base}-${count}`,
      stage: roundStage(index, specs.length)
    };
  });
}

export function roundList(lines, sections = []) {
  return collectRounds(lines || [], sections).map((spec) => ({
    id: spec.id,
    start: spec.start,
    end: spec.end,
    label: spec.label,
    stage: spec.stage,
    lines: spec.lines
  }));
}

function kindsForRound(stage, count) {
  const pattern = ROUND_ROTATION[stage] || ROUND_ROTATION.middle;
  const kinds = [];
  for (let index = 0; index < count; index += 1) kinds.push(pattern[index % pattern.length]);
  return kinds;
}

function makeMixedQuestion(kind, lines, sections, index, rng) {
  const blocks = sectionBlocks(lines, sections);
  const block = blocks.find((item) => index >= item.start && index < item.end) || {
    label: "",
    start: 0,
    end: lines.length
  };
  let question = null;
  if (kind === "fade" || kind === "think") question = makeStudyRound(kind, lines, block, index, index + 1);
  else if (kind === "order") question = makeOrder(lines[index], index, rng);
  else if (kind === "next" || kind === "sing") {
    question = makeNext(lines, index, rng);
    if (question && kind === "sing") question.sing = true;
  }
  if (!question) return null;
  if (kind === "fade" || kind === "think") return question;
  return withContext(question, lines, sections);
}

function makeWithFallback(kind, lines, sections, index, rng, previousKind, stage) {
  const preferred = stage === "late"
    ? ["think", "next", "sing", "order", "fade"]
    : stage === "early"
      ? ["fade", "order", "think", "next", "sing"]
      : ["fade", "think", "order", "next", "sing"];
  const order = [kind, ...preferred].filter((item, at, list) => list.indexOf(item) === at);
  const tryKind = (candidate, allowRepeat) => {
    if (!allowRepeat && candidate === previousKind && candidate !== kind) return null;
    return makeMixedQuestion(candidate, lines, sections, index, rng);
  };
  for (const candidate of order) {
    const made = tryKind(candidate, false);
    if (made) return made;
  }
  for (const candidate of order) {
    const made = tryKind(candidate, true);
    if (made) return made;
  }
  return null;
}

function questionsForRound(lines, sections, spec, rng) {
  const kinds = kindsForRound(spec.stage, spec.end - spec.start);
  const made = [];
  kinds.forEach((kind, offset) => {
    const question = makeWithFallback(kind, lines, sections, spec.start + offset, rng, made.at(-1)?.kind, spec.stage);
    if (question) made.push(question);
  });
  let fades = 0;
  return made.map((question) => {
    const { roundPrefix, ...rest } = question;
    const next = {
      ...rest,
      roundId: spec.id,
      roundLines: spec.lines.slice()
    };
    if (next.kind === "fade") {
      next.passes = fades === 0 && spec.stage !== "late" ? ["full", "some", "half"] : ["full", "some"];
      fades += 1;
    }
    return next;
  });
}

export function describeMix(questions) {
  const labels = [];
  for (const question of questions || []) {
    const label = question.sing
      ? "Sing"
      : { fade: "Fade", think: "Think", order: "Order", next: "Next", lines: "Lines" }[question.kind];
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.join(", ");
}

function chapterDetail(spec, questions) {
  const range = `${spec.start + 1}–${spec.end}`;
  const mix = describeMix(questions);
  return mix ? `${range} · ${mix}` : range;
}

export function questionTaps(question) {
  if (!question) return 0;
  if (question.kind === "fade") {
    const words = tokenize(question.steps?.[0]?.text || question.line || "").length;
    return passesFor(question).reduce((sum, pass) => sum + 1 + hiddenWordIndexes(words, pass).length, 0);
  }
  if (question.kind === "think") return Math.max(1, question.steps?.length || 1) * 2;
  if (question.kind === "order") return (question.tokens?.length || 0) + 1;
  if (question.kind === "lines") return question.tokens?.length || 0;
  return question.sing ? 2 : 1;
}

function buildMixedLesson(lines, sections, rng, options) {
  const specs = collectRounds(lines, sections);
  if (!specs.length) return [];
  let spec = null;
  if (options.roundId) spec = specs.find((item) => item.id === options.roundId) || null;
  else {
    const skip = new Set(options.skipIds || []);
    spec = specs.find((item) => !skip.has(item.id)) || null;
  }
  return spec ? questionsForRound(lines, sections, spec, rng) : [];
}

export function buildLesson(lines, gameId, rng = Math.random, sections = [], options = {}) {
  const list = [...(lines || [])];
  const labels = sections || [];
  if (gameId === "round") return buildMixedLesson(list, labels, rng, options);
  if (gameId === "fade" || gameId === "think") return keepRounds(studyLesson(list, labels, gameId), options);
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
  const chapters = cleared?.chapters || (cleared?.rounds ? {} : (cleared || {}));
  const roundState = cleared?.rounds || {};
  const specs = collectRounds(lines || [], sections);
  let waiting = false;
  const rounds = specs.map((spec) => {
    const stat = roundState[spec.id] || {};
    const finished = Boolean(stat.completed || stat.mastered);
    let status = "open";
    if (waiting) status = "locked";
    else if (finished) status = "done";
    if (!finished) waiting = true;
    const questions = questionsForRound(lines || [], sections, spec, () => 0.5);
    return {
      id: "round",
      roundId: spec.id,
      name: spec.label,
      detail: chapterDetail(spec, questions),
      stage: spec.stage,
      status,
      done: status === "done"
    };
  });
  const concert = CHAPTERS.find((chapter) => chapter.id === "concert");
  let concertStatus = "open";
  if (!specs.length || !gameAvailability(lines, sections).concert) concertStatus = "unavailable";
  else if (waiting) concertStatus = "locked";
  else if (chapters.concert) concertStatus = "done";
  rounds.push({
    ...concert,
    status: concertStatus,
    done: concertStatus === "done"
  });
  return rounds;
}

export function nextPractice(lines, sections = [], { rounds = {} } = {}) {
  const spec = collectRounds(lines || [], sections).find((item) => !rounds[item.id]?.mastered);
  if (spec) return { gameId: "round", roundId: spec.id };
  return { gameId: "concert" };
}

export function sectionProgress(lines, sections = [], rounds = {}) {
  return collectRounds(lines || [], sections).map((spec) => {
    const mastered = rounds[spec.id]?.mastered ? spec.lines.length : 0;
    return {
      id: spec.id,
      label: spec.label,
      opener: spec.lines[0] || spec.label,
      start: spec.start,
      total: spec.lines.length,
      mastered,
      roundId: spec.id,
      done: spec.lines.length > 0 && mastered >= spec.lines.length
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
