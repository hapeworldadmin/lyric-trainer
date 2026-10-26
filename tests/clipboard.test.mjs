import assert from "node:assert/strict";
import test from "node:test";
import { readClipboardFromGesture } from "../js/clipboard.js";

test("readText runs before the gesture function returns", () => {
  assert.equal(readClipboardFromGesture.constructor.name, "Function");
  let called = false;
  const pending = readClipboardFromGesture({
    readText() {
      called = true;
      return Promise.resolve("alpha one two\nbeta three four");
    }
  });
  assert.equal(called, true);
  return pending.then((text) => {
    assert.equal(text, "alpha one two\nbeta three four");
  });
});

test("a rejected clipboard read stays a rejection", async () => {
  await assert.rejects(
    readClipboardFromGesture({
      readText() {
        return Promise.reject(new Error("denied"));
      }
    }),
    /denied/
  );
});

test("a missing clipboard read rejects without waiting", async () => {
  await assert.rejects(readClipboardFromGesture(null), /unsupported/);
  await assert.rejects(readClipboardFromGesture({}), /unsupported/);
});
