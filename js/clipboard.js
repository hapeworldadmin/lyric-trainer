import { choosePasteSource } from "./parse.js?v=9";

// Safari shows its Paste bubble only when the read starts in the click turn.
// Call readText() and read() before this function awaits.

export function readClipboardFromGesture(clipboard = globalThis.navigator?.clipboard) {
  const readText = clipboard && clipboard.readText;
  const read = clipboard && clipboard.read;
  if (typeof readText !== "function" && typeof read !== "function") {
    return Promise.reject(new Error("unsupported"));
  }
  let textPromise = null;
  if (typeof readText === "function") {
    try {
      textPromise = Promise.resolve(readText.call(clipboard));
    } catch (error) {
      textPromise = Promise.reject(error);
    }
  }
  let itemsPromise = null;
  if (typeof read === "function") {
    try {
      itemsPromise = Promise.resolve(read.call(clipboard));
    } catch (error) {
      itemsPromise = Promise.reject(error);
    }
  }
  if (!itemsPromise) return textPromise;
  return combineClipboard(textPromise, itemsPromise);
}

async function combineClipboard(textPromise, itemsPromise) {
  const [textResult, itemResult] = await Promise.allSettled([
    textPromise || Promise.resolve(""),
    itemsPromise
  ]);
  let plain = "";
  if (textResult.status === "fulfilled") plain = String(textResult.value ?? "");
  let html = "";
  let itemPlain = "";
  if (itemResult.status === "fulfilled") {
    const extracted = await textFromItems(itemResult.value);
    html = extracted.html;
    itemPlain = extracted.plain;
  }
  const chosen = choosePasteSource(html, itemPlain || plain);
  if (String(chosen || plain).trim()) return String(chosen || plain);
  if (textResult.status === "rejected") throw textResult.reason;
  if (itemResult.status === "rejected") throw itemResult.reason;
  return "";
}

async function textFromItems(items) {
  let html = "";
  let plain = "";
  for (const item of items || []) {
    const types = item.types || [];
    if (!html && types.includes("text/html") && typeof item.getType === "function") {
      const blob = await item.getType("text/html");
      html = typeof blob?.text === "function" ? await blob.text() : String(blob ?? "");
    }
    if (!plain && types.includes("text/plain") && typeof item.getType === "function") {
      const blob = await item.getType("text/plain");
      plain = typeof blob?.text === "function" ? await blob.text() : String(blob ?? "");
    }
  }
  return { html, plain };
}
