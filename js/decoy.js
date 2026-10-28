import { displayToken, normalizeAnswer, shuffle, tokenize, wordCount } from "./text.js?v=16";
import { sectionSpans } from "./identity.js?v=16";

function firstWord(line) {
  const token = tokenize(line)[0] || "";
  return normalizeAnswer(displayToken(token));
}

function typeOf(label) {
  return String(label || "").replace(/\s+\d+$/, "").trim().toLowerCase();
}

export function rankDecoyLines(lines, sections, index) {
  const list = lines || [];
  const answer = list[index] || "";
  const answerKey = normalizeAnswer(answer);
  const previous = index > 0 ? normalizeAnswer(list[index - 1]) : "";
  const opening = firstWord(answer);
  const spans = sectionSpans(list, sections);
  const home = spans.find((span) => index >= span.start && index < span.end);
  const homeType = typeOf(home?.label);
  const size = wordCount(answer);
  const hard = [];
  const medium = [];
  const easy = [];
  for (let cursor = 0; cursor < list.length; cursor += 1) {
    if (cursor === index) continue;
    const line = list[cursor];
    if (!line || normalizeAnswer(line) === answerKey) continue;
    const span = spans.find((item) => cursor >= item.start && cursor < item.end);
    const follows = Boolean(previous) && cursor > 0 && normalizeAnswer(list[cursor - 1]) === previous;
    const shares = Boolean(opening) && firstWord(line) === opening;
    if (follows || shares) {
      hard.push(line);
      continue;
    }
    const sameType = Boolean(homeType) && typeOf(span?.label) === homeType && span !== home;
    if (sameType && Math.abs(wordCount(line) - size) <= 2) medium.push(line);
    else if (!home || span !== home) easy.push(line);
  }
  return { hard, medium, easy };
}

export function pickDecoyLines(lines, sections, index, count, rng = Math.random) {
  const ranked = rankDecoyLines(lines, sections, index);
  const seen = new Set([normalizeAnswer(lines?.[index])]);
  const picked = [];
  for (const tier of ["hard", "medium", "easy"]) {
    for (const line of shuffle(ranked[tier], rng)) {
      const key = normalizeAnswer(line);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      picked.push(line);
      if (picked.length >= count) return picked;
    }
  }
  return picked;
}

export function pickDecoyWords(lines, answer, count, rng = Math.random) {
  const used = new Set(tokenize(answer).map((token) => normalizeAnswer(displayToken(token))));
  const words = [];
  for (const line of lines || []) {
    for (const token of tokenize(line)) {
      const chip = displayToken(token);
      const key = normalizeAnswer(chip);
      if (!key || key.length < 2 || used.has(key)) continue;
      used.add(key);
      words.push(chip);
    }
  }
  return shuffle(words, rng).slice(0, count);
}
