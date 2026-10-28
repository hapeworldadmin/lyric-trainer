export function requestPersistentStorage(root = globalThis) {
  const persist = root.navigator?.storage?.persist;
  if (typeof persist !== "function") return Promise.resolve(false);
  return Promise.resolve(persist.call(root.navigator.storage)).then((granted) => Boolean(granted)).catch(() => false);
}

export function homeScreenCopy(root = globalThis) {
  const ua = root.navigator?.userAgent || "";
  const platform = root.navigator?.platform || "";
  const touches = root.navigator?.maxTouchPoints || 0;
  const ios = /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && touches > 1);
  if (ios) return "Add to Home Screen from Share. Safari may clear songs after a week away.";
  return "Add to your Home Screen so songs stay saved.";
}
