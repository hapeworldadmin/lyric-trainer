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
  // iOS Safari drops or rejects continuous mode. Capture one phrase, then restart.
  recognition.continuous = !ios;
  return { ios };
}

export function createLineRecognizer(handlers = {}, root = globalThis) {
  const Ctor = recognitionConstructor(root);
  if (!Ctor) return null;
  const recognition = new Ctor();
  const env = root.navigator || globalThis.navigator;
  applyRecognitionSettings(recognition, env);
  let active = false;
  let carried = "";
  let latest = "";
  let restarts = 0;

  const join = (...parts) => parts.join(" ").replace(/\s+/g, " ").trim();

  recognition.onresult = (event) => {
    restarts = 0;
    let finals = "";
    let interim = "";
    const results = event?.results;
    const total = results?.length || 0;
    for (let index = 0; index < total; index += 1) {
      const piece = results[index]?.[0]?.transcript || "";
      if (results[index]?.isFinal) finals += piece;
      else interim += piece;
    }
    latest = join(finals, interim);
    handlers.onTranscript?.(join(carried, latest));
  };

  recognition.onerror = (event) => {
    const code = event?.error || "";
    if (code === "aborted" || code === "no-speech") return;
    active = false;
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
      handlers.onEnd?.();
      return;
    }
    restarts += 1;
    if (restarts > 8) {
      active = false;
      handlers.onEnd?.();
      return;
    }
    try {
      recognition.start();
    } catch {
      active = false;
      handlers.onEnd?.();
    }
  };

  return {
    start() {
      carried = "";
      latest = "";
      restarts = 0;
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
      try { recognition.stop(); } catch { /* already stopped */ }
    },
    abort() {
      active = false;
      try { recognition.abort(); } catch { /* already stopped */ }
    }
  };
}
