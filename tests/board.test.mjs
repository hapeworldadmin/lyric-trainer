import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BOARD_LIMITS,
  boardResponse,
  boardScreen,
  buildSubmission,
  createMemoryBoardStore,
  handleLeaderboard,
  nextRate,
  sanitizeSubmission,
  validateBoardName
} from "../js/board-logic.js";
import { fetchBoard, pushScores, saveBoardName } from "../js/board.js";
import { adaptStore } from "../netlify/functions/leaderboard.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SENTINEL = "SENTINEL_LYRIC_LINE";

function memory() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); }
  };
}

function jsonResponse(result) {
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    async json() { return result.body; }
  };
}

function progress() {
  return {
    totalXp: 15,
    songs: {
      "soft|lany": {
        title: "Soft",
        artist: "LANY",
        bestScore: 40,
        xp: 15,
        lines: [SENTINEL],
        sections: [SENTINEL],
        lyrics: SENTINEL
      }
    }
  };
}

async function post(store, body, ip = "203.0.113.10", now = 1_700_000_000_000) {
  return handleLeaderboard({
    method: "POST",
    searchParams: new URLSearchParams(),
    body,
    ip,
    store,
    now
  });
}

test("display names stay short and skip a light profanity list", () => {
  assert.equal(validateBoardName("  Ada  ").name, "Ada");
  assert.equal(validateBoardName("Kai-2").ok, true);
  assert.equal(validateBoardName("A").ok, false);
  assert.equal(validateBoardName("This name is too long").ok, false);
  assert.equal(validateBoardName("Ada!").ok, false);
  assert.equal(validateBoardName("oh shit").ok, false);
  assert.equal(validateBoardName("f.u.c.k").ok, false);
  assert.equal(validateBoardName("Grape").ok, true);
  assert.match(validateBoardName("****").error, /letters/);
});

test("a submit clamps scores and drops lyric fields", () => {
  const verdict = sanitizeSubmission({
    deviceId: DEVICE,
    name: "Ada",
    overallScore: 9e15,
    overallXp: 9e15,
    lines: [SENTINEL],
    lyrics: SENTINEL,
    songs: [{
      id: "evil",
      title: "Soft",
      artist: "LANY",
      score: 9e15,
      xp: -4,
      lines: [SENTINEL],
      lyrics: SENTINEL
    }]
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.value.overallScore, BOARD_LIMITS.maxSongScore);
  assert.equal(verdict.value.songs[0].id, "soft|lany");
  assert.equal(verdict.value.songs[0].score, BOARD_LIMITS.maxSongScore);
  assert.equal(verdict.value.songs[0].xp, 0);
  assert.equal(JSON.stringify(verdict.value).includes(SENTINEL), false);
  assert.equal(Object.hasOwn(verdict.value, "lines"), false);
});

test("the board keeps the higher score and ranks you outside the top 20", async () => {
  const store = createMemoryBoardStore();
  const first = await post(store, {
    deviceId: DEVICE,
    name: "Ada",
    songs: [{ title: "Soft", artist: "LANY", score: 50, xp: 10 }]
  });
  assert.equal(first.status, 200);
  const lower = await post(store, {
    deviceId: DEVICE,
    name: "Ada L",
    songs: [{ title: "Soft", artist: "LANY", score: 20, xp: 40 }]
  });
  assert.equal(lower.status, 200);
  const saved = await store.get(`p:${DEVICE}`);
  assert.equal(saved.name, "Ada L");
  assert.equal(saved.songs["soft|lany"].score, 50);
  assert.equal(saved.songs["soft|lany"].xp, 40);
  assert.deepEqual(Object.keys(saved).sort(), ["deviceId", "name", "songs", "updatedAt"]);
  assert.equal(JSON.stringify(saved).includes(SENTINEL), false);

  for (let index = 0; index < 24; index += 1) {
    const id = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
    const result = await post(store, {
      deviceId: id,
      name: `Player ${index}`,
      songs: [
        { title: "Soft", artist: "LANY", score: 1000 - index, xp: 1 },
        { title: "North", artist: "LANY", score: index === 0 ? 5 : 0, xp: index === 0 ? 1 : 0 }
      ]
    }, `203.0.113.${20 + index}`);
    assert.equal(result.status, 200);
  }
  const board = await handleLeaderboard({
    method: "GET",
    searchParams: new URLSearchParams({ device: DEVICE, song: "soft|lany" }),
    body: null,
    ip: "203.0.113.10",
    store,
    now: 1_700_000_100_000
  });
  assert.equal(board.status, 200);
  assert.equal(board.body.overall.length, 20);
  assert.equal(board.body.you.overall.rank, 25);
  assert.equal(board.body.overall.some((row) => row.you), false);
  assert.equal(board.body.song.rows.length, 20);
  assert.equal(board.body.you.song.rank, 25);
  assert.equal(board.body.song.rows[0].name, "Player 0");
  assert.equal(JSON.stringify(board.body).includes(DEVICE), false);
  assert.equal(JSON.stringify(board.body).includes(SENTINEL), false);
  const north = boardResponse(await playersFrom(store), { deviceId: DEVICE, songId: "north|lany" });
  assert.equal(north.song.rows[0].name, "Player 0");
  assert.equal(north.you.song, null);
});

async function playersFrom(store) {
  const keys = await store.list("p:");
  const rows = [];
  for (const key of keys) rows.push(await store.get(key));
  return rows;
}

test("one device can only submit a limited number of times an hour", async () => {
  const store = createMemoryBoardStore();
  const body = {
    deviceId: DEVICE,
    name: "Ada",
    songs: [{ title: "Soft", artist: "LANY", score: 12, xp: 3 }]
  };
  for (let index = 0; index < BOARD_LIMITS.postPerDevice; index += 1) {
    const result = await post(store, body, "203.0.113.8", 1_700_000_000_000 + index);
    assert.equal(result.status, 200);
  }
  const blocked = await post(store, body, "203.0.113.8", 1_700_000_000_000 + 50);
  assert.equal(blocked.status, 429);
  const stillThere = await handleLeaderboard({
    method: "GET",
    searchParams: new URLSearchParams({ device: DEVICE }),
    ip: "203.0.113.9",
    store,
    now: 1_700_000_000_000 + 60
  });
  assert.equal(stillThere.status, 200);
  assert.equal(stillThere.body.you.overall.score, 12);
  const other = await post(store, { ...body, deviceId: OTHER, name: "Bo" }, "198.51.100.4", 1_700_000_000_000 + 70);
  assert.equal(other.status, 200);
  const later = await post(store, { ...body, songs: [{ title: "Soft", artist: "LANY", score: 18, xp: 3 }] }, "203.0.113.8", 1_700_000_000_000 + BOARD_LIMITS.windowMs);
  assert.equal(later.status, 200);
  assert.equal(later.body.you.overall.score, 18);
});

test("the rate window resets and a bad method is refused", async () => {
  const first = nextRate(null, 1000, 2, 500);
  const second = nextRate(first.record, 1100, 2, 500);
  const third = nextRate(second.record, 1200, 2, 500);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
  assert.equal(nextRate(third.record, 1600, 2, 500).ok, true);
  const refused = await handleLeaderboard({
    method: "PUT",
    searchParams: new URLSearchParams(),
    store: createMemoryBoardStore(),
    now: 1
  });
  assert.equal(refused.status, 405);
});

test("a failed sync keeps local progress and a later sync posts scores only", async () => {
  const store = createMemoryBoardStore();
  const local = progress();
  const before = JSON.stringify(local);
  const profile = {
    version: 1,
    deviceId: DEVICE,
    name: "Ada",
    pending: true,
    syncedAt: null,
    cache: null
  };
  const submission = buildSubmission(local, profile);
  assert.deepEqual(Object.keys(submission).sort(), ["deviceId", "library", "name", "overallScore", "overallXp", "playerId", "progress", "songs"]);
  assert.deepEqual(Object.keys(submission.songs[0]).sort(), ["artist", "id", "score", "title", "xp"]);
  assert.equal(JSON.stringify(submission).includes(SENTINEL), false);
  assert.equal(submission.songs[0].id, "soft|lany");

  let calls = 0;
  const offline = await pushScores({
    profile,
    progress: local,
    now: 1_700_000_000_000,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("offline");
    }
  });
  assert.equal(offline.offline, true);
  assert.equal(offline.profile.pending, true);
  assert.equal(JSON.stringify(local), before);
  assert.equal(await store.get(`p:${DEVICE}`), null);

  const online = await pushScores({
    profile: offline.profile,
    progress: local,
    now: 1_700_000_500_000,
    fetchImpl: async (url, init) => {
      assert.equal(url, "/.netlify/functions/leaderboard");
      assert.equal(init.method, "POST");
      const result = await handleLeaderboard({
        method: "POST",
        searchParams: new URLSearchParams(),
        body: JSON.parse(init.body),
        ip: "203.0.113.4",
        store,
        now: 1_700_000_500_000
      });
      return jsonResponse(result);
    }
  });
  assert.equal(online.posted, true);
  assert.equal(online.profile.pending, false);
  assert.equal(JSON.stringify(local), before);
  const saved = await store.get(`p:${DEVICE}`);
  assert.equal(saved.songs["soft|lany"].score, 40);
  assert.equal(JSON.stringify(saved).includes(SENTINEL), false);

  const viewed = await fetchBoard({
    deviceId: DEVICE,
    songId: "soft|lany",
    fetchImpl: async (url) => {
      const params = new URL(url, "http://local").searchParams;
      const result = await handleLeaderboard({
        method: "GET",
        searchParams: params,
        ip: "203.0.113.4",
        store,
        now: 1_700_000_600_000
      });
      return jsonResponse(result);
    }
  });
  assert.equal(viewed.you.song.rank, 1);
  assert.equal(viewed.you.song.score, 40);
  const screen = boardScreen({
    profile: online.profile,
    remote: null,
    local: buildSubmission(local, profile),
    offline: true
  });
  assert.match(screen.status, /Saved here/);
  assert.equal(screen.you.score, 40);
  assert.equal(screen.you.rank, null);
  assert.equal(calls, 1);
});

test("the offline screen keeps your rank from the last board", () => {
  const remote = {
    overall: [{ rank: 21, name: "Ada", score: 10, xp: 2, you: false }],
    you: { overall: { rank: 21, score: 10, xp: 2 }, song: null },
    song: null,
    songs: [{ id: "soft|lany", title: "Soft", artist: "LANY" }]
  };
  const screen = boardScreen({
    profile: { name: "Ada", pending: true },
    remote,
    local: { songs: [{ id: "soft|lany", title: "Soft", artist: "LANY", score: 15, xp: 4 }], overallScore: 15, overallXp: 4 },
    offline: true
  });
  assert.equal(screen.you.rank, 21);
  assert.equal(screen.you.score, 15);
  assert.equal(screen.you.showRow, true);
  assert.match(screen.status, /Last saved board/);
});

test("a name is saved once in local storage and a bad name is refused", () => {
  const store = memory();
  const bad = saveBoardName("x", store, progress(), () => DEVICE);
  assert.equal(bad.ok, false);
  assert.equal(store.getItem("lyric-trainer-board"), null);
  const saved = saveBoardName("Ada", store, progress(), () => DEVICE);
  assert.equal(saved.ok, true);
  assert.equal(saved.profile.pending, true);
  const raw = JSON.parse(store.getItem("lyric-trainer-board"));
  assert.equal(raw.name, "Ada");
  assert.equal(raw.deviceId, DEVICE);
  assert.equal(JSON.stringify(raw).includes(SENTINEL), false);
});

test("the function store adapter reads json and lists keys", async () => {
  const blobs = new Map();
  const fake = {
    async get(key, options) {
      assert.equal(options.type, "json");
      assert.equal(options.consistency, "strong");
      return blobs.get(key) || null;
    },
    async setJSON(key, value) { blobs.set(key, value); },
    async list() { return { blobs: [...blobs.keys()].map((key) => ({ key })) }; }
  };
  const store = adaptStore(fake);
  await store.set("p:1", { name: "Ada" });
  assert.deepEqual(await store.list("p:"), ["p:1"]);
  assert.equal((await store.get("p:1")).name, "Ada");
});

test("the leaderboard function does not require environment variables", async () => {
  const source = await readFile(new URL("../netlify/functions/leaderboard.js", import.meta.url), "utf8");
  assert.match(source, /getStore\(\{ name: "verse-board", consistency: "strong" \}\)/);
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("NETLIFY_"), false);
  assert.equal(source.includes(SENTINEL), false);
});
