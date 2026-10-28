import { pickDecoyLines, pickDecoyWords } from "./decoy.js?v=16";
import { identitiesForSong } from "./identity.js?v=16";
import { letterHint } from "./games.js?v=16";
import { applyMiss, applyPass, askedLevel, recallXp } from "./memory.js?v=16";
import { answersMatch, singingMatch } from "./games.js?v=16";
import { displayToken, normalizeAnswer, normalizeSing, shuffle, tokenize } from "./text.js?v=16";

const FILLERS = new Set(["uh", "um", "ah", "er", "hmm", "mm", "mhm"]);

export function stripFillers(value) {
  return normalizeSing(value).split(" ").filter((word) => word && !FILLERS.has(word)).join(" ");
}

export function recallSingMatch(expected, given) {
  return singingMatch(stripFillers(expected), stripFillers(given));
}

function rowsFor(song, sectionNumber) {
  return identitiesForSong(song).filter((row) => !row.repeat && row.sectionNumber === sectionNumber);
}

export function sectionIsFresh(song, recall, sectionNumber) {
  return rowsFor(song, sectionNumber).every((row) => {
    const record = recall?.[row.id];
    return !record || (!record.lastPass && !record.misses);
  });
}

function wordTiles(line, extras, rng) {
  const real = tokenize(line).map((text, index) => ({
    id: `w${index}`,
    text: displayToken(text),
    decoy: false
  }));
  const tiles = shuffle([...real, ...extras], rng);
  return { tiles, solution: real.map((tile) => tile.id) };
}

export function buildRecallQuestion(song, step, rng = Math.random, { audit = false } = {}) {
  const lines = song?.lines || [];
  const index = step.index;
  const level = audit ? 1 : step.level;
  const answer = lines[index] || "";
  const ident = identitiesForSong(song).find((row) => row.index === index) || {};
  const cold = !audit && level >= 4;
  const previous = cold || index <= 0 ? "" : lines[index - 1];
  const question = {
    kind: "recall",
    level,
    audit: Boolean(audit),
    lineIndex: index,
    answer,
    previous,
    identity: step.identity || ident.id || "",
    sectionLabel: ident.label || "",
    lineNumber: ident.lineNumber || index + 1,
    sectionNumber: ident.sectionNumber || step.sectionNumber || 1,
    cold,
    format: "tiles",
    choices: [],
    tiles: [],
    solution: [],
    hint: "",
    allowType: level !== 2,
    allowShow: !audit && level === 3,
    allowSing: !audit && level >= 3
  };
  if (level <= 0) {
    const decoys = pickDecoyLines(lines, song.sections || [], index, 3, rng);
    question.format = "choices";
    question.choices = shuffle([answer, ...decoys], rng);
    question.allowType = false;
    return question;
  }
  if (level === 1) {
    const bank = wordTiles(answer, [], rng);
    question.hint = letterHint(answer);
    question.tiles = bank.tiles;
    question.solution = bank.solution;
    return question;
  }
  if (level === 2) {
    const decoys = pickDecoyWords(lines, answer, 3, rng).map((text, decoyIndex) => ({
      id: `d${decoyIndex}`,
      text,
      decoy: true
    }));
    const bank = wordTiles(answer, decoys, rng);
    question.tiles = bank.tiles;
    question.solution = bank.solution;
    question.allowType = false;
    return question;
  }
  const bank = wordTiles(answer, [], rng);
  question.tiles = bank.tiles;
  question.solution = bank.solution;
  return question;
}

export function recallPrompt(question) {
  if (!question) return "";
  if (question.audit) return "Quick check";
  if (question.cold || question.level >= 4) {
    const name = question.sectionLabel || "Line";
    return `${name}, line ${question.lineNumber}`;
  }
  if (question.level <= 0) return "Next line";
  if (question.level === 1) return "First letters";
  if (question.level === 2) return "Build the line";
  return "Next line";
}

export function judgeRecallTile(question, placedIds, tileId) {
  const tile = (question?.tiles || []).find((item) => item.id === tileId);
  const placed = placedIds || [];
  if (!tile || placed.includes(tileId)) return false;
  if (tile.decoy) return false;
  const expected = question.solution?.[placed.length];
  return Boolean(expected) && expected === tile.id;
}

export function createRun({ song, sectionNumber = 1, recall = {}, hearts = 5 } = {}) {
  const fresh = sectionIsFresh(song, recall, sectionNumber);
  const steps = rowsFor(song, sectionNumber).map((row) => ({
    index: row.index,
    identity: row.id,
    level: askedLevel(recall?.[row.id], fresh),
    sectionNumber: row.sectionNumber,
    sectionStart: row.lineNumber === 1
  }));
  return {
    mode: "run",
    sectionNumber,
    fresh,
    steps,
    cursor: 0,
    checkpoint: 0,
    hearts,
    maxHearts: hearts,
    combo: 0,
    xp: 0,
    correct: 0,
    answered: 0,
    status: steps.length ? "ask" : "done",
    reveal: "",
    audit: false,
    singTries: 0,
    notice: ""
  };
}

function parkCheckpoint(state) {
  const step = state.steps[state.cursor];
  if (!step) return state;
  if (state.cursor % 4 === 0 || step.sectionStart) return { ...state, checkpoint: state.cursor };
  return state;
}

export function currentStep(state) {
  return state?.steps?.[state.cursor] || null;
}

function advance(state) {
  const cursor = state.cursor + 1;
  if (cursor >= state.steps.length) {
    return { ...state, cursor, status: "done", audit: false, reveal: "" };
  }
  return parkCheckpoint({ ...state, cursor, status: "ask", audit: false, reveal: "", singTries: 0 });
}

export function passRun(state, { record = null, sung = false, now = Date.now(), levelAsked } = {}) {
  const step = currentStep(state);
  if (!step || state.status !== "ask") return { state, record: null, effect: "none" };
  const asked = levelAsked ?? step.level;
  const xp = recallXp({ level: asked, sung });
  const next = advance({
    ...state,
    combo: state.combo + 1,
    xp: state.xp + xp,
    correct: state.correct + 1,
    answered: state.answered + 1,
    singTries: 0
  });
  return {
    state: next,
    record: { id: step.identity, patch: applyPass(record, { levelAsked: asked, now }), xp, sung },
    effect: next.status === "done" ? "done" : "advance"
  };
}

export function missRun(state, { record = null, now = Date.now() } = {}) {
  const step = currentStep(state);
  if (!step || (state.status !== "ask" && state.status !== "retry")) return { state, record: null, effect: "none" };
  const hearts = Math.max(0, state.hearts - 1);
  const next = {
    ...state,
    hearts,
    combo: 0,
    answered: state.answered + 1,
    status: "reveal",
    reveal: "",
    audit: false,
    singTries: 0
  };
  return {
    state: next,
    record: { id: step.identity, patch: applyMiss(record, now) },
    effect: hearts <= 0 ? "lost" : "rewind"
  };
}

export function singRetry(state, record, now = Date.now()) {
  const tries = (state.singTries || 0) + 1;
  if (tries < 2) return { state: { ...state, singTries: tries, status: "ask" }, record: null, effect: "retry" };
  return missRun({ ...state, singTries: tries }, { record, now });
}

export function finishReveal(state) {
  if (state.status !== "reveal") return state;
  if (state.hearts <= 0) return { ...state, status: "lost", reveal: "" };
  return parkCheckpoint({
    ...state,
    cursor: state.checkpoint,
    status: "ask",
    reveal: "",
    audit: false,
    combo: 0,
    singTries: 0
  });
}

export function armAudit(state, rng = Math.random) {
  const step = currentStep(state);
  if (!step || step.level < 3 || state.audit) return false;
  return rng() < 0.3;
}

export function beginAudit(state) {
  return { ...state, audit: true, status: "ask" };
}

// applyPass above uses a null record. The caller merges onto the stored record.
export function mergePass(record, levelAsked, now) {
  return applyPass(record, { levelAsked, now });
}

export function mergeMiss(record, now) {
  return applyMiss(record, now);
}

export function choiceCorrect(question, choice) {
  return answersMatch(question?.answer, choice);
}

export function typedCorrect(question, text) {
  return answersMatch(question?.answer, text);
}
