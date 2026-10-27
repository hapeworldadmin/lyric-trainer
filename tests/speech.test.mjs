import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { applyRecognitionSettings, createLineRecognizer, speechRecognitionSupported } from "../js/speech.js";

const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

test("speech recognition uses the webkit name and stays quiet until start", () => {
  assert.equal(speechRecognitionSupported({}), false);
  assert.equal(speechRecognitionSupported({ SpeechRecognition: function Speech() {} }), true);
  assert.equal(speechRecognitionSupported({ webkitSpeechRecognition: function WebkitSpeech() {} }), true);

  const iosRecognition = {};
  const ios = applyRecognitionSettings(iosRecognition, { userAgent: iphone, language: "en-US" });
  assert.equal(ios.ios, true);
  assert.equal(iosRecognition.continuous, false);
  assert.equal(iosRecognition.interimResults, true);
  assert.equal(iosRecognition.maxAlternatives, 5);
  assert.equal(iosRecognition.lang, "en-US");

  const macRecognition = {};
  const desktop = applyRecognitionSettings(macRecognition, {
    userAgent: mac,
    platform: "MacIntel",
    maxTouchPoints: 0,
    language: "en-GB"
  });
  assert.equal(desktop.ios, false);
  assert.equal(macRecognition.continuous, true);
  assert.equal(macRecognition.interimResults, true);
  assert.equal(macRecognition.lang, "en-GB");

  const padRecognition = {};
  const pad = applyRecognitionSettings(padRecognition, {
    userAgent: mac,
    platform: "MacIntel",
    maxTouchPoints: 5,
    language: "en-US"
  });
  assert.equal(pad.ios, true);
  assert.equal(padRecognition.continuous, false);
});

test("a recognizer does not listen until start, and a denied mic stays quiet", () => {
  const events = [];
  class Fake {
    start() {
      events.push(["start", this.continuous, this.interimResults, this.lang]);
      this.onresult?.({
        resultIndex: 0,
        results: [{ 0: { transcript: "two three four" }, isFinal: false, length: 1 }]
      });
    }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  let heard = "";
  const root = {
    webkitSpeechRecognition: Fake,
    navigator: { userAgent: iphone, language: "en-US", platform: "iPhone", maxTouchPoints: 5 }
  };
  const ear = createLineRecognizer({
    onTranscript(text) { heard = text; }
  }, root);
  assert.equal(events.length, 0);
  assert.equal(heard, "");
  ear.start();
  assert.equal(heard, "two three four");
  assert.equal(events[0][1], false);
  assert.equal(events[0][2], true);
  ear.abort();

  class Denied {
    start() {
      this.onerror?.({ error: "not-allowed" });
      this.onend?.();
    }
    stop() {}
    abort() {}
  }
  let denied = 0;
  let unsupported = 0;
  const quiet = createLineRecognizer({
    onDenied() { denied += 1; },
    onUnsupported() { unsupported += 1; },
    onTranscript() { denied += 10; }
  }, { webkitSpeechRecognition: Denied, navigator: { userAgent: mac, language: "en-US", platform: "MacIntel", maxTouchPoints: 0 } });
  quiet.start();
  assert.equal(denied, 1);
  assert.equal(unsupported, 0);
  assert.equal(createLineRecognizer({}, {}), null);
});

test("recognition keeps every alternative and prefers the lyric, without throwing when hints are missing", () => {
  const events = [];
  class Fake {
    constructor() { Fake.last = this; }
    start() { events.push("start"); }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  class Grammar {
    constructor() { Grammar.built += 1; this.items = []; }
    addFromString(body, weight) { this.items.push([body, weight]); }
  }
  Grammar.built = 0;
  let heard = null;
  const root = {
    webkitSpeechRecognition: Fake,
    webkitSpeechGrammarList: Grammar,
    navigator: { userAgent: mac, language: "en-US", platform: "MacIntel", maxTouchPoints: 0 }
  };
  const ear = createLineRecognizer({
    expected: "No matter how it all plays out",
    vocabulary: ["goldfish", "hallway"],
    onTranscript(text, meta) { heard = { text, meta }; }
  }, root);
  ear.start();
  Fake.last.onresult({
    resultIndex: 0,
    results: [{
      0: { transcript: "snow weather cow" },
      1: { transcript: "no mater how it all plays out" },
      isFinal: false,
      length: 2
    }]
  });
  assert.equal(Fake.last.maxAlternatives, 5);
  assert.equal(Grammar.built, 1);
  assert.match(Fake.last.grammars.items[0][0], /matter/);
  assert.match(Fake.last.grammars.items[0][0], /goldfish/);
  assert.equal(heard.meta.raw, "no mater how it all plays out");
  assert.match(heard.text, /matter/);
  ear.abort();

  class Touchy {
    constructor() { Touchy.last = this; }
    start() {}
    stop() {}
    abort() {}
    set contextualStrings(_value) { throw new Error("safari"); }
    get contextualStrings() { return undefined; }
  }
  class BrokenList {
    constructor() { throw new Error("safari"); }
  }
  assert.doesNotThrow(() => {
    createLineRecognizer({
      expected: "You're the why",
      vocabulary: ["stay"]
    }, {
      webkitSpeechRecognition: Touchy,
      SpeechGrammarList: BrokenList,
      navigator: { userAgent: iphone, language: "en-US", platform: "iPhone", maxTouchPoints: 5 }
    });
  });
});

test("listening stays open until about two seconds of silence", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let ended = 0;
    class Fake {
      constructor() { Fake.last = this; }
      start() { Fake.starts += 1; }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    Fake.starts = 0;
    const ear = createLineRecognizer({
      expected: "soft and slow",
      onEnd() { ended += 1; }
    }, {
      webkitSpeechRecognition: Fake,
      navigator: { userAgent: iphone, language: "en-US", platform: "iPhone", maxTouchPoints: 5 }
    });
    ear.start();
    Fake.last.onresult({
      resultIndex: 0,
      results: [{ 0: { transcript: "soft and slo" }, isFinal: false, length: 1 }]
    });
    assert.equal(ended, 0);
    mock.timers.tick(1999);
    assert.equal(ended, 0);
    mock.timers.tick(20);
    assert.equal(ended, 1);
    ear.abort();
  } finally {
    mock.timers.reset();
  }
});
