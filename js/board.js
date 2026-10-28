import {
  boardScreen,
  buildSubmission,
  snapshotFromProgress,
  validateBoardName,
  validDeviceId
} from "./board-logic.js?v=14";

export const BOARD_ENDPOINT = "/.netlify/functions/leaderboard";

export { boardScreen, buildSubmission, snapshotFromProgress, validateBoardName };

export const BOARD_STORAGE_KEY = "lyric-trainer-board";

function storageOf(storage) {
  const store = storage || globalThis.localStorage;
  if (!store || typeof store.getItem !== "function" || typeof store.setItem !== "function") return null;
  return store;
}

export function createDeviceId() {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoRef?.getRandomValues) cryptoRef.getRandomValues(bytes);
  else for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function emptyBoardProfile() {
  return { version: 1, deviceId: "", name: "", pending: false, syncedAt: null, cache: null };
}

export function loadBoardProfile(storage) {
  const store = storageOf(storage);
  if (!store) return emptyBoardProfile();
  try {
    const raw = JSON.parse(store.getItem(BOARD_STORAGE_KEY) || "null");
    if (!raw || typeof raw !== "object") return emptyBoardProfile();
    const name = validateBoardName(raw.name || "");
    return {
      version: 1,
      deviceId: validDeviceId(raw.deviceId) ? String(raw.deviceId).toLowerCase() : "",
      name: name.ok ? name.name : "",
      pending: Boolean(raw.pending),
      syncedAt: typeof raw.syncedAt === "string" ? raw.syncedAt : null,
      cache: raw.cache && typeof raw.cache === "object" ? raw.cache : null
    };
  } catch {
    return emptyBoardProfile();
  }
}

export function saveBoardProfile(profile, storage) {
  const store = storageOf(storage);
  if (!store || !profile) return;
  store.setItem(BOARD_STORAGE_KEY, JSON.stringify({
    version: 1,
    deviceId: profile.deviceId || "",
    name: profile.name || "",
    pending: Boolean(profile.pending),
    syncedAt: profile.syncedAt || null,
    cache: profile.cache || null
  }));
}

export function saveBoardName(raw, storage, progress, createId = createDeviceId) {
  const verdict = validateBoardName(raw);
  if (!verdict.ok) return verdict;
  const current = loadBoardProfile(storage);
  const profile = {
    ...current,
    version: 1,
    deviceId: current.deviceId || createId(),
    name: verdict.name,
    pending: snapshotFromProgress(progress).songs.length > 0
  };
  saveBoardProfile(profile, storage);
  return { ok: true, profile };
}

export function markScoresPending(storage, progress) {
  const profile = loadBoardProfile(storage);
  if (!profile.name || !snapshotFromProgress(progress).songs.length) return profile;
  const next = { ...profile, pending: true };
  saveBoardProfile(next, storage);
  return next;
}

function boardSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function callBoard(url, init) {
  return fetch(url, { ...init, signal: boardSignal(8000) });
}

async function readError(response) {
  try {
    const body = await response.json();
    return typeof body?.error === "string" ? body.error : "";
  } catch {
    return "";
  }
}

export async function pushScores({ profile, progress, fetchImpl = callBoard, now = Date.now() }) {
  if (!profile?.name || !validDeviceId(profile.deviceId)) return { profile, posted: false, skipped: true };
  const submission = buildSubmission(progress, profile);
  if (!submission.songs.length) return { profile: { ...profile, pending: false }, posted: false, empty: true };
  try {
    const response = await fetchImpl(BOARD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(submission),
      cache: "no-store"
    });
    if (!response.ok) {
      const error = await readError(response);
      if (response.status === 400) return { profile: { ...profile, pending: false }, posted: false, status: 400, error };
      return {
        profile: { ...profile, pending: true },
        posted: false,
        status: response.status,
        error,
        offline: response.status >= 500,
        busy: response.status === 429
      };
    }
    const body = await response.json();
    return {
      profile: { ...profile, pending: false, syncedAt: new Date(now).toISOString(), cache: body },
      posted: true,
      body
    };
  } catch {
    return { profile: { ...profile, pending: true }, posted: false, offline: true };
  }
}

export async function fetchBoard({ deviceId, songId = "", fetchImpl = callBoard }) {
  const params = new URLSearchParams();
  if (deviceId) params.set("device", deviceId);
  if (songId) params.set("song", songId);
  const response = await fetchImpl(`${BOARD_ENDPOINT}?${params.toString()}`, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) {
    const error = new Error("board");
    error.status = response.status;
    throw error;
  }
  return response.json();
}
