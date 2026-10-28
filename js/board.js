import {
  applySharedProgress,
  boardScreen,
  buildSubmission,
  libraryFromSongs,
  normalizeCode,
  snapshotFromProgress,
  validateBoardName,
  validDeviceId
} from "./board-logic.js?v=16";

export const BOARD_ENDPOINT = "/.netlify/functions/leaderboard";

export { applySharedProgress, boardScreen, buildSubmission, libraryFromSongs, snapshotFromProgress, validateBoardName };

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
  return {
    version: 1,
    deviceId: "",
    playerId: "",
    name: "",
    pending: false,
    linked: false,
    syncedAt: null,
    progressAt: null,
    cache: null
  };
}

export function loadBoardProfile(storage) {
  const store = storageOf(storage);
  if (!store) return emptyBoardProfile();
  try {
    const raw = JSON.parse(store.getItem(BOARD_STORAGE_KEY) || "null");
    if (!raw || typeof raw !== "object") return emptyBoardProfile();
    const name = validateBoardName(raw.name || "");
    const deviceId = validDeviceId(raw.deviceId) ? String(raw.deviceId).toLowerCase() : "";
    const playerId = validDeviceId(raw.playerId) ? String(raw.playerId).toLowerCase() : deviceId;
    return {
      version: 1,
      deviceId,
      playerId,
      name: name.ok ? name.name : "",
      pending: Boolean(raw.pending),
      linked: Boolean(raw.linked),
      syncedAt: typeof raw.syncedAt === "string" ? raw.syncedAt : null,
      progressAt: typeof raw.progressAt === "string" ? raw.progressAt : null,
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
    playerId: profile.playerId || profile.deviceId || "",
    name: profile.name || "",
    pending: Boolean(profile.pending),
    linked: Boolean(profile.linked),
    syncedAt: profile.syncedAt || null,
    progressAt: profile.progressAt || null,
    cache: profile.cache || null
  }));
}

export function ensureBoardDevice(storage, createId = createDeviceId) {
  const current = loadBoardProfile(storage);
  if (current.deviceId) return current;
  const deviceId = createId();
  const profile = { ...current, deviceId, playerId: current.playerId || deviceId };
  saveBoardProfile(profile, storage);
  return profile;
}

export function saveBoardName(raw, storage, progress, createId = createDeviceId) {
  const verdict = validateBoardName(raw);
  if (!verdict.ok) return verdict;
  const current = loadBoardProfile(storage);
  const deviceId = current.deviceId || createId();
  const profile = {
    ...current,
    version: 1,
    deviceId,
    playerId: current.playerId || deviceId,
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

export async function pushScores({ profile, progress, library = [], fetchImpl = callBoard, now = Date.now() }) {
  if (!profile?.name || !validDeviceId(profile.deviceId)) return { profile, posted: false, skipped: true };
  const submission = buildSubmission(progress, profile, library);
  const learning = submission.progress && (submission.progress.totalXp > 0 || submission.progress.streak?.lastDate || Object.keys(submission.progress.songs || {}).length > 0);
  if (!submission.songs.length && !learning) {
    return { profile: { ...profile, pending: false, progressAt: profile.progressAt || new Date(now).toISOString() }, posted: false, empty: true };
  }
  try {
    const response = await fetchImpl(BOARD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(submission),
      cache: "no-store"
    });
    if (!response.ok) {
      const error = await readError(response);
      if (response.status === 400 || response.status === 403) {
        return { profile: { ...profile, pending: false }, posted: false, status: response.status, error };
      }
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
      profile: {
        ...profile,
        pending: false,
        linked: typeof body?.you?.linked === "boolean" ? body.you.linked : profile.linked,
        syncedAt: new Date(now).toISOString(),
        progressAt: new Date(now).toISOString(),
        cache: boardCache(body)
      },
      posted: true,
      body,
      progress: body?.progress || null
    };
  } catch {
    return { profile: { ...profile, pending: true }, posted: false, offline: true };
  }
}

function boardCache(body) {
  if (!body || typeof body !== "object") return null;
  return {
    overall: body.overall || [],
    you: body.you || null,
    song: body.song || null,
    songs: body.songs || []
  };
}

export async function createDeviceCode({ profile, fetchImpl = callBoard, now = Date.now() }) {
  if (!profile?.name || !validDeviceId(profile.deviceId)) return { ok: false, error: "Save a name first." };
  try {
    const response = await fetchImpl(BOARD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        action: "link",
        deviceId: profile.deviceId,
        playerId: profile.playerId || profile.deviceId,
        name: profile.name
      }),
      cache: "no-store"
    });
    const body = await readJson(response);
    if (!response.ok) return { ok: false, status: response.status, error: body.error || "Could not make a code." };
    const code = normalizeCode(body.code);
    if (!code) return { ok: false, error: "Could not make a code." };
    return { ok: true, code, expiresAt: Number(body.expiresAt) || now + 10 * 60 * 1000 };
  } catch {
    return { ok: false, error: "Offline. Try when you are connected." };
  }
}

export async function joinDevice({ profile, code, progress, library = [], fetchImpl = callBoard, now = Date.now() }) {
  if (!validDeviceId(profile?.deviceId)) return { ok: false, error: "Device is not valid." };
  const submission = buildSubmission(progress, profile, library);
  try {
    const response = await fetchImpl(BOARD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        action: "join",
        code,
        deviceId: profile.deviceId,
        playerId: profile.playerId || profile.deviceId,
        name: profile.name || "",
        songs: submission.songs,
        progress: submission.progress,
        library: submission.library
      }),
      cache: "no-store"
    });
    const body = await readJson(response);
    if (!response.ok || !validDeviceId(body.playerId)) {
      return { ok: false, status: response.status, error: body.error || "Code is not valid." };
    }
    return {
      ok: true,
      progress: body.progress || null,
      profile: {
        ...profile,
        playerId: String(body.playerId).toLowerCase(),
        name: typeof body.name === "string" && body.name ? body.name : profile.name,
        linked: true,
        pending: false,
        progressAt: new Date(now).toISOString(),
        syncedAt: new Date(now).toISOString()
      }
    };
  } catch {
    return { ok: false, error: "Offline. Try when you are connected." };
  }
}

export async function pullSharedProgress({ profile, library = [], fetchImpl = callBoard }) {
  if (!validDeviceId(profile?.deviceId)) return { profile, progress: null, skipped: true };
  try {
    const response = await fetchImpl(BOARD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        action: "pull",
        deviceId: profile.deviceId,
        playerId: profile.playerId || profile.deviceId,
        library: libraryFromSongs(library)
      }),
      cache: "no-store"
    });
    const body = await readJson(response);
    if (!response.ok) return { profile, progress: null, status: response.status, error: body.error || "" };
    const name = typeof body.name === "string" && body.name ? body.name : profile.name;
    return {
      profile: { ...profile, name, linked: Boolean(body.linked) },
      progress: body.progress || null,
      status: 200
    };
  } catch {
    return { profile, progress: null, offline: true };
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
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

export async function backupProgress({ profile, records, fetchImpl = callBoard }) {
  if (!validDeviceId(profile?.deviceId)) return { ok: false, error: "Save a name first." };
  try {
    const response = await fetchImpl(BOARD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action: "backup", deviceId: profile.deviceId, records }),
      cache: "no-store"
    });
    if (!response.ok) return { ok: false, error: "The backup did not save." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Offline. Try when you are connected." };
  }
}

export async function restoreProgress({ profile, fetchImpl = callBoard }) {
  if (!validDeviceId(profile?.deviceId)) return { ok: false, error: "Save a name first." };
  try {
    const response = await fetchImpl(BOARD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action: "restore", deviceId: profile.deviceId }),
      cache: "no-store"
    });
    if (!response.ok) return { ok: false, error: "The backup did not load." };
    const body = await response.json();
    return { ok: true, records: body?.records || {} };
  } catch {
    return { ok: false, error: "Offline. Try when you are connected." };
  }
}
