// Safari shows its Paste bubble only when readText() runs in the click turn.
// An async handler yields first, and WebKit rejects the read.

export function readClipboardFromGesture(clipboard = globalThis.navigator?.clipboard) {
  const readText = clipboard && clipboard.readText;
  if (typeof readText !== "function") return Promise.reject(new Error("unsupported"));
  try {
    return Promise.resolve(readText.call(clipboard));
  } catch (error) {
    return Promise.reject(error);
  }
}
