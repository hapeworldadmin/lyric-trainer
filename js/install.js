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
  if (ios) return "Add to Home Screen from the Share menu. Safari may clear songs after about a week away.";
  return "Add Know the Verse to your Home Screen so this browser keeps your songs.";
}
