import { hintWords, interpretHearing } from "./voice.js?v=11";

const SILENCE_MS = 2000;

export function recognitionConstructor(root = globalThis) {
  if (!root) return null;
  return root.SpeechRecognition || root.webkitSpeechRecognition || null;
}

export function speechRecognitionSupported(root = globalThis) {
  return typeof recognitionConstructor(root) === "function";
}

export function applyRecognitionSettings(recognition, env = globalThis.navigator) {
  const ua = env?.userAgent || "";
  const platform = env?.platform || "";
  const touches = env?.maxTouchPoints || 0;
  const ios = /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && touches > 1);
  recognition.lang = env?.language || "en-US";
  recognition.interimResults = true;
  recognition.maxAlternatives = 5;
  // iOS Safari drops or rejects the continuous flag. The session still stays
  // open by restarting until the singer stops or speech has been quiet.
  recognition.continuous = !ios;
  return { ios };
}

function applyContextHints(recognition, words, root) {
  if (!words.length) return;
  try {
    const List = root?.SpeechGrammarList || root?.webkitSpeechGrammarList;
    if (typeof List === "function") {
      const grammars = new List();
      const body = `#JSGF V1.0; grammar verse; public <word> = ${words.join(" | ")} ;`;
      grammars.addFromString(body, 1);
      recognition.grammars = grammars;
    }
  } catch {
    /* Safari has no usable grammar list. */
  }
  try {
    if (recognition && "contextualStrings" in recognition) recognition.contextualStrings = words;
  } catch {
    /* Property exists but this browser rejects the assignment. */
  }
}

function join(...parts) {
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function collectHypotheses(results) {
  const list = results || [];
  const total = list.length || 0;
  const rows = [];
  let maxAlt = 1;
  for (let index = 0; index < total; index += 1) {
    const result = list[index];
    const count = Math.min(result?.length || 1, 5);
    maxAlt = Math.max(maxAlt, count);
    const options = [];
    for (let alt = 0; alt < count; alt += 1) options.push(result?.[alt]?.transcript || "");
    rows.push({ final: Boolean(result?.isFinal), options });
  }
  const hypotheses = [];
  for (let alt = 0; alt < maxAlt; alt += 1) {
    let finals = "";
    let interim = "";
    for (const row of rows) {
      const piece = row.options[alt] ?? row.options[0] ?? "";
      if (row.final) finals += piece;
      else interim += piece;
    }
    const text = join(finals, interim);
    if (text) hypotheses.push(text);
  }
  return hypotheses;
}

export function createLineRecognizer(handlers = {}, root = globalThis) {
  const Ctor = recognitionConstructor(root);
  if (!Ctor) return null;
  const recognition = new Ctor();
  const env = root.navigator || globalThis.navigator;
  applyRecognitionSettings(recognition, env);
  const expected = handlers.expected || "";
  const vocabulary = handlers.vocabulary || [];
  try {
    applyContextHints(recognition, hintWords(expected, vocabulary), root);
  } catch {
    /* Hints are optional. A failure here must not block the mic. */
  }
  let active = false;
  let carried = "";
  let latest = "";
  let emptyRestarts = 0;
  let lastSpeech = 0;
  let silenceTimer = 0;

  const clearSilence = () => {
    if (!silenceTimer) return;
    clearTimeout(silenceTimer);
    silenceTimer = 0;
  };

  const armSilence = () => {
    clearSilence();
    silenceTimer = setTimeout(() => {
      silenceTimer = 0;
      if (!active) return;
      active = false;
      try {
        recognition.stop();
      } catch {
        handlers.onEnd?.();
      }
    }, SILENCE_MS);
  };

  recognition.onresult = (event) => {
    emptyRestarts = 0;
    lastSpeech = Date.now();
    const current = collectHypotheses(event?.results);
    latest = current[0] || "";
    const hypotheses = current.map((text) => join(carried, text));
    if (!latest) return;
    let heard = null;
    try {
      heard = interpretHearing(expected, hypotheses, vocabulary);
    } catch {
      heard = null;
    }
    const display = heard?.display || latest;
    const raw = heard?.raw || latest;
    armSilence();
    handlers.onTranscript?.(display, { raw, display, pass: Boolean(heard?.pass) });
  };

  recognition.onerror = (event) => {
    const code = event?.error || "";
    if (code === "aborted" || code === "no-speech") return;
    active = false;
    clearSilence();
    if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
      handlers.onDenied?.();
    }
  };

  recognition.onend = () => {
    if (latest) {
      carried = join(carried, latest);
      latest = "";
    }
    if (!active) {
      clearSilence();
      handlers.onEnd?.();
      return;
    }
    if (!lastSpeech) {
      emptyRestarts += 1;
      if (emptyRestarts > 8) {
        active = false;
        clearSilence();
        handlers.onEnd?.();
        return;
      }
    }
    setTimeout(() => {
      if (!active) return;
      try {
        recognition.start();
      } catch {
        active = false;
        clearSilence();
        handlers.onEnd?.();
      }
    }, 30);
  };

  return {
    start() {
      carried = "";
      latest = "";
      emptyRestarts = 0;
      lastSpeech = 0;
      clearSilence();
      active = true;
      try {
        recognition.start();
      } catch {
        active = false;
        handlers.onUnsupported?.();
      }
    },
    stop() {
      active = false;
      clearSilence();
      try { recognition.stop(); } catch { /* already stopped */ }
    },
    abort() {
      active = false;
      clearSilence();
      try { recognition.abort(); } catch { /* already stopped */ }
    }
  };
}
