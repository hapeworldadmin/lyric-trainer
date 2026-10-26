import { displayToken, mulberry32, normalizeAnswer, shuffle, tokenize } from "./text.js?v=4";

export const GAMES = [
  { id: "sections", name: "Section order", detail: "Arrange the sections", group: "main" },
  { id: "lines", name: "Line order", detail: "Reorder the lines in a section", group: "main" },
  { id: "next", name: "Next line", detail: "Choose the line that comes next", group: "main" },
  { id: "concert", name: "Final run", detail: "Timed full-song run", group: "main" },
  { id: "fill", name: "Fill the blank", detail: "A short warm-up on one word", group: "warm" },
  { id: "order", name: "Word order", detail: "Rebuild one line", group: "warm" },
  { id: "letters", name: "First letters", detail: "Type the line from first letters", group: "warm" }
];

const STOP = new Set("a an the and or but if to of in on for at by from with it my we you he she they i is was were and".split(" "));
const DECOYS = ["kazoo", "slipper", "marble", "comet", "pocket", "lantern", "sprocket", "velvet"];
const LESSON_LENGTH = 6;
export const CONCERT_SECONDS = 12;

export function sectionBlocks(lines, sections = []) {
  const list = lines || [];
  const labels = sections || [];
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
    sections: blocks.length >= 2,
    lines: blocks.some((block) => block.lines.length >= 2)
  };
}

export function firstLessonId(lines, sections = []) {
  const availability = gameAvailability(lines, sections);
  for (const id of ["sections", "lines", "next", "fill", "letters", "order"]) {
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

export function pointsFor({ kind, correct, combo, secondsLeft }) {
  if (!correct) return { xp: 0, score: 0 };
  const base = { fill: 10, next: 10, order: 12, letters: 15, lines: 14, sections: 16 }[kind] || 10;
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

function withContext(question, lines, sections) {
  if (!question) return null;
  return { ...question, context: lineContext(lines, question.lineIndex, sections) };
}

function shuffleTokens(tokens, rng) {
  let shuffled = shuffle(tokens, rng);
  if (shuffled.length > 1 && shuffled.every((token, index) => token.id === tokens[index].id)) {
    shuffled = [...shuffled.slice(1), shuffled[0]];
  }
  return shuffled;
}

function blockContext(lines, block, rangeLabel) {
  return {
    section: block?.label || "",
    position: block ? block.start + 1 : 1,
    total: lines.length,
    previous: "",
    next: "",
    rangeLabel
  };
}

function makeSectionOrder(lines, sections, rng) {
  const blocks = sectionBlocks(lines, sections);
  if (blocks.length < 2) return null;
  const tokens = blocks.map((block) => ({ id: block.id, text: block.label }));
  return {
    kind: "sections",
    lineIndex: blocks[0].start,
    line: blocks[0].lines[0] || "",
    tokens,
    shuffled: shuffleTokens(tokens, rng),
    context: blockContext(lines, null, `${blocks.length} sections`)
  };
}

function makeLineOrder(lines, block, rng) {
  const tokens = block.lines.map((text, index) => ({ id: `l${block.start + index}`, text }));
  if (tokens.length < 2) return null;
  const end = block.end;
  return {
    kind: "lines",
    lineIndex: block.start,
    line: block.lines[0] || "",
    tokens,
    shuffled: shuffleTokens(tokens, rng),
    context: blockContext(lines, block, `${block.label} · lines ${block.start + 1}–${end} of ${lines.length}`)
  };
}

export function buildLesson(lines, gameId, rng = Math.random, sections = []) {
  const list = [...(lines || [])];
  const labels = sections || [];
  if (gameId === "sections") {
    const question = makeSectionOrder(list, labels, rng);
    return question ? [question] : [];
  }
  if (gameId === "lines") {
    const blocks = sectionBlocks(list, labels).filter((block) => block.lines.length >= 2);
    const count = Math.min(LESSON_LENGTH, blocks.length);
    return shuffle(blocks, rng).slice(0, count).map((block) => makeLineOrder(list, block, rng)).filter(Boolean);
  }
  if (gameId === "concert") {
    return list.map((_, index) => {
      const prefer = index % 2 === 0 ? "fill" : "letters";
      const question = makeQuestion(list, index, prefer, rng) || makeQuestion(list, index, prefer === "fill" ? "letters" : "fill", rng);
      return withContext(question, list, labels);
    }).filter(Boolean);
  }
  const eligible = list.map((_, index) => index).filter((index) => canAsk(list, index, gameId));
  const count = Math.min(LESSON_LENGTH, eligible.length);
  return shuffle(eligible, rng).slice(0, count).map((index) => withContext(makeQuestion(list, index, gameId, rng), list, labels)).filter(Boolean);
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
  if (kind === "letters") return makeLetters(line, index);
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
    choices
  };
}

function makeOrder(line, index, rng) {
  const tokens = tokenize(line).map((text, tokenIndex) => ({
    id: `t${tokenIndex}`,
    text: displayToken(text)
  }));
  if (tokens.length < 3) return null;
  let shuffled = shuffle(tokens, rng);
  if (shuffled.every((token, tokenIndex) => token.id === tokens[tokenIndex].id)) {
    shuffled = [...shuffled.slice(1), shuffled[0]];
  }
  return {
    kind: "order",
    lineIndex: index,
    line,
    answer: tokens.map((token) => token.text).join(" "),
    tokens,
    shuffled
  };
}

function makeNext(lines, index, rng) {
  if (index >= lines.length - 1) return null;
  const answer = lines[index + 1];
  const distractors = shuffle(lines.filter((line, lineIndex) => lineIndex !== index && lineIndex !== index + 1 && line !== answer), rng).slice(0, 3);
  if (!distractors.length) return null;
  return {
    kind: "next",
    lineIndex: index + 1,
    line: answer,
    prompt: lines[index],
    answer,
    choices: shuffle([answer, ...distractors], rng)
  };
}

function makeLetters(line, index) {
  if (!tokenize(line).length) return null;
  return {
    kind: "letters",
    lineIndex: index,
    line,
    answer: line,
    hint: letterHint(line)
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
  const expected = (question.tokens || []).map((token) => token.id).join("\n");
  return expected.length > 0 && arrangedIds.join("\n") === expected;
}
