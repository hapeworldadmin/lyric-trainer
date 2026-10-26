import { displayToken, mulberry32, normalizeAnswer, shuffle, tokenize } from "./text.js";

export const GAMES = [
  { id: "fill", name: "Fill the blank", detail: "Type it or tap the missing word" },
  { id: "order", name: "Word order", detail: "Put the shuffled line back together" },
  { id: "next", name: "Next line", detail: "Choose the line that comes next" },
  { id: "letters", name: "First letters", detail: "Type the line from the first letters" },
  { id: "concert", name: "Concert mode", detail: "Timed full-song run" }
];

const STOP = new Set("a an the and or but if to of in on for at by from with it my we you he she they i is was were and".split(" "));
const DECOYS = ["kazoo", "slipper", "marble", "comet", "pocket", "lantern", "sprocket", "velvet"];
const LESSON_LENGTH = 6;
export const CONCERT_SECONDS = 12;

export function gameAvailability(lines) {
  const list = lines || [];
  return {
    fill: list.some((line) => chooseBlank(tokenize(line), () => 0)),
    order: list.some((line) => tokenize(line).length >= 3),
    next: list.length >= 3,
    letters: list.some((line) => tokenize(line).length >= 1),
    concert: list.length >= 1 && list.some((line) => tokenize(line).length >= 1)
  };
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
  const base = { fill: 10, next: 10, order: 12, letters: 15 }[kind] || 10;
  const xp = base + Math.min(10, Math.max(0, combo - 1) * 2);
  let score = 100 + combo * 10;
  if (typeof secondsLeft === "number") score += Math.max(0, Math.round(secondsLeft * 8));
  return { xp, score };
}

export function buildLesson(lines, gameId, rng = Math.random) {
  const list = [...(lines || [])];
  if (gameId === "concert") {
    return list.map((line, index) => {
      const prefer = index % 2 === 0 ? "fill" : "letters";
      return makeQuestion(list, index, prefer, rng) || makeQuestion(list, index, prefer === "fill" ? "letters" : "fill", rng);
    }).filter(Boolean);
  }
  const eligible = list.map((_, index) => index).filter((index) => canAsk(list, index, gameId));
  const count = Math.min(LESSON_LENGTH, eligible.length);
  return shuffle(eligible, rng).slice(0, count).map((index) => makeQuestion(list, index, gameId, rng)).filter(Boolean);
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
  const byId = new Map(question.tokens.map((token) => [token.id, token.text]));
  const guess = arrangedIds.map((id) => byId.get(id) || "").join(" ");
  return answersMatch(question.answer, guess);
}
