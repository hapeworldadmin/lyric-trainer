import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_LIMITS,
  applySharedProgress,
  createMemoryBoardStore,
  handleLeaderboard,
  normalizeCode,
  progressSnapshot
} from "../js/board-logic.js";
import { adaptStore } from "../netlify/functions/leaderboard.js";

const HOST = "11111111-1111-4111-8111-111111111111";
const JOINER = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const LYRIC = "NEVER_LYRIC_LINE";
const NOW = 1_700_000_000_000;

function call(store, { method = "POST", body = null, ip = "203.0.113.10", query = "", now = NOW } = {}) {
  return handleLeaderboard({
    method,
    searchParams: new URLSearchParams(query),
    body,
    ip,
    store,
    now
  });
}

test("a code is six unambiguous characters", () => {
  assert.equal(normalizeCode("ab c-def"), "ABCDEF");
  assert.equal(normalizeCode("ABC DEF"), "ABCDEF");
  assert.equal(normalizeCode("abcde"), "");
  assert.equal(normalizeCode("ABCO12"), "");
  assert.equal(normalizeCode("ABCD1I"), "");
});

test("linking devices keeps one player, the higher score per song, and no lyrics", async () => {
  const store = createMemoryBoardStore();
  const host = await call(store, {
    body: {
      deviceId: HOST,
      name: "Ada",
      songs: [
        { title: "Soft", artist: "LANY", score: 50, xp: 10 },
        { title: "North", artist: "LANY", score: 10, xp: 2 }
      ],
      progress: {
        totalXp: 12,
        streak: { count: 2, lastDate: "2026-10-01" },
        songs: {
          soft: {
            title: "Soft",
            artist: "LANY",
            lines: [LYRIC],
            lyrics: LYRIC,
            sections: [LYRIC],
            rounds: {
              "mix-aaa": { mastered: true, completed: true, mistakes: 0, seen: 1 },
              [LYRIC]: { mastered: true, completed: true, mistakes: 0, seen: 1 }
            },
            chapters: { fade: true, sing: true },
            lineStats: { ab12: { correct: 2, seen: 2 }, [LYRIC]: { correct: 2, seen: 2 } }
          },
          north: {
            title: "North",
            artist: "LANY",
            lyrics: LYRIC,
            rounds: { "mix-ccc": { mastered: true, completed: true, mistakes: 1, seen: 1 } },
            chapters: { think: true }
          }
        }
      }
    }
  });
  assert.equal(host.status, 200);
  const joiner = await call(store, {
    body: {
      deviceId: JOINER,
      name: "Bo",
      songs: [
        { title: "Soft", artist: "LANY", score: 40, xp: 4 },
        { title: "East", artist: "LANY", score: 30, xp: 6 }
      ],
      progress: {
        songs: {
          soft: {
            title: "Soft",
            artist: "LANY",
            lines: [LYRIC],
            rounds: { "mix-bbb": { mastered: true, completed: true, mistakes: 1, seen: 2 } },
            chapters: { concert: true }
          }
        }
      }
    },
    ip: "203.0.113.20"
  });
  assert.equal(joiner.status, 200);
  await call(store, {
    body: {
      deviceId: THIRD,
      name: "Cy",
      songs: [{ title: "Soft", artist: "LANY", score: 1, xp: 1 }]
    },
    ip: "203.0.113.30"
  });

  const code = await call(store, {
    body: { action: "link", deviceId: HOST, playerId: HOST, name: "Ada" }
  });
  assert.equal(code.status, 200);
  assert.equal(normalizeCode(code.body.code), code.body.code);
  assert.equal(code.body.expiresAt, NOW + BOARD_LIMITS.codeTtlMs);

  const replaced = await call(store, {
    body: { action: "link", deviceId: HOST, playerId: HOST, name: "Ada" },
    now: NOW + 1000
  });
  assert.equal(replaced.status, 200);
  assert.notEqual(replaced.body.code, code.body.code);
  const stale = await call(store, {
    body: {
      action: "join",
      code: code.body.code,
      deviceId: JOINER,
      playerId: JOINER,
      library: [{ title: "Soft", artist: "LANY" }]
    },
    ip: "203.0.113.20",
    now: NOW + 1000
  });
  assert.equal(stale.status, 400);

  const joined = await call(store, {
    body: {
      action: "join",
      code: ` ${replaced.body.code.slice(0, 3)}-${replaced.body.code.slice(3)} `,
      deviceId: JOINER,
      playerId: JOINER,
      songs: [{ title: "West", artist: "LANY", score: 15, xp: 3, lyrics: LYRIC, lines: [LYRIC] }],
      progress: {
        streak: { count: 4, lastDate: "2026-10-03" },
        songs: {
          soft: {
            title: "Soft",
            artist: "LANY",
            lyrics: LYRIC,
            lines: [LYRIC],
            rounds: { "mix-bbb": { mastered: true, completed: true, mistakes: 0, seen: 3 } },
            chapters: { concert: true },
            lineStats: { ab12: { correct: 1, seen: 4 } }
          },
          north: {
            title: "North",
            artist: "LANY",
            lyrics: LYRIC,
            rounds: { "mix-secret": { mastered: true, completed: true, mistakes: 0, seen: 1 } }
          }
        }
      },
      library: [
        { title: "Soft", artist: "LANY", lines: [LYRIC] },
        { title: "East", artist: "LANY" },
        { title: "West", artist: "LANY" }
      ]
    },
    ip: "203.0.113.20",
    now: NOW + 1000
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.playerId, HOST);
  assert.equal(joined.body.name, "Ada");
  assert.equal(joined.body.linked, true);
  assert.equal(joined.body.progress.songs["north|lany"], undefined);
  assert.equal(joined.body.progress.songs["soft|lany"].rounds["mix-aaa"].mastered, true);
  assert.equal(joined.body.progress.songs["soft|lany"].rounds["mix-bbb"].mastered, true);
  assert.equal(joined.body.progress.songs["soft|lany"].rounds["mix-bbb"].mistakes, 0);
  assert.equal(joined.body.progress.songs["soft|lany"].chapters.fade, true);
  assert.equal(joined.body.progress.songs["soft|lany"].chapters.concert, true);
  assert.equal(joined.body.progress.songs["soft|lany"].chapters.sing, undefined);
  assert.equal(joined.body.progress.songs["soft|lany"].lineStats.ab12.correct, 2);
  assert.equal(joined.body.progress.streak.lastDate, "2026-10-03");
  assert.equal(JSON.stringify(joined.body).includes(LYRIC), false);
  assert.equal(JSON.stringify(joined.body).includes(JOINER), false);

  const again = await call(store, {
    body: { action: "join", code: replaced.body.code, deviceId: THIRD, playerId: THIRD },
    ip: "203.0.113.31",
    now: NOW + 2000
  });
  assert.equal(again.status, 400);

  const saved = await store.get(`p:${HOST}`);
  assert.equal(saved.name, "Ada");
  assert.equal(saved.songs["soft|lany"].score, 50);
  assert.equal(saved.songs["soft|lany"].xp, 10);
  assert.equal(saved.songs["north|lany"].score, 10);
  assert.equal(saved.songs["east|lany"].score, 30);
  assert.equal(saved.songs["west|lany"].score, 15);
  assert.equal(saved.progress.songs["north|lany"].rounds["mix-ccc"].mastered, true);
  assert.equal(saved.progress.songs["soft|lany"].rounds["mix-secret"], undefined);
  assert.equal(saved.devices.includes(JOINER), true);
  assert.equal(await store.get(`p:${JOINER}`), null);
  assert.equal(JSON.stringify(saved).includes(LYRIC), false);

  const keys = await store.list("p:");
  assert.deepEqual(keys.sort(), [`p:${HOST}`, `p:${THIRD}`]);

  const fromPhone = await call(store, {
    method: "GET",
    query: `device=${encodeURIComponent(JOINER)}`,
    ip: "203.0.113.21",
    now: NOW + 3000
  });
  const fromMac = await call(store, {
    method: "GET",
    query: `device=${encodeURIComponent(HOST)}`,
    ip: "203.0.113.11",
    now: NOW + 3000
  });
  assert.equal(fromPhone.body.you.overall.score, 105);
  assert.equal(fromMac.body.you.overall.score, 105);
  assert.equal(fromPhone.body.you.overall.rank, fromMac.body.you.overall.rank);
  assert.equal(fromPhone.body.overall.filter((row) => row.name === "Ada").length, 1);
  assert.equal(fromPhone.body.overall.some((row) => row.name === "Bo"), false);
  assert.equal(JSON.stringify(fromPhone.body).includes(HOST), false);
  assert.equal(JSON.stringify(fromPhone.body).includes(JOINER), false);
  assert.equal(JSON.stringify(fromPhone.body).includes(replaced.body.code), false);
  assert.equal(JSON.stringify(fromPhone.body).includes("mix-ccc"), false);
  assert.equal(fromPhone.body.progress, undefined);

  const local = {
    totalXp: 4,
    streak: { count: 1, lastDate: "2026-10-02" },
    songs: {
      "soft|lany": {
        title: "Soft",
        artist: "LANY",
        bestScore: 40,
        xp: 4,
        rounds: { "mix-ddd": { mastered: true, completed: true, mistakes: 0, seen: 1 } },
        chapters: { think: true },
        lineStats: { ab12: { correct: 1, seen: 1 } }
      }
    }
  };
  const library = [
    { title: "Soft", artist: "LANY", lines: [LYRIC] },
    { title: "East", artist: "LANY" }
  ];
  const applied = applySharedProgress(local, joined.body.progress, library);
  assert.equal(applied.changed, true);
  assert.equal(local.songs["soft|lany"].rounds["mix-ddd"].mastered, true);
  assert.equal(local.songs["soft|lany"].rounds["mix-aaa"].mastered, true);
  assert.equal(local.songs["soft|lany"].rounds["mix-bbb"].mastered, true);
  assert.equal(local.songs["soft|lany"].chapters.think, true);
  assert.equal(local.songs["soft|lany"].chapters.fade, true);
  assert.equal(local.songs["soft|lany"].chapters.concert, true);
  assert.equal(local.songs["soft|lany"].lineStats.ab12.correct, 2);
  assert.equal(local.songs["soft|lany"].bestScore, 50);
  assert.equal(local.songs["east|lany"].bestScore, 30);
  assert.equal(local.songs["north|lany"], undefined);
  assert.equal(local.songs["west|lany"], undefined);
  assert.equal(local.streak.lastDate, "2026-10-03");
  assert.equal(JSON.stringify(local).includes(LYRIC), false);
  assert.equal(JSON.stringify(library).includes(LYRIC), true);
});

test("a code expires after ten minutes and attempts are rate limited", async () => {
  const store = createMemoryBoardStore();
  await call(store, {
    body: { deviceId: HOST, name: "Ada", songs: [{ title: "Soft", artist: "LANY", score: 5, xp: 1 }] }
  });
  const code = await call(store, {
    body: { action: "link", deviceId: HOST, name: "Ada" },
    ip: "198.51.100.8"
  });
  assert.equal(code.status, 200);
  const expired = await call(store, {
    body: { action: "join", code: code.body.code, deviceId: "44444444-4444-4444-8444-444444444444", playerId: "44444444-4444-4444-8444-444444444444" },
    ip: "198.51.100.12",
    now: NOW + BOARD_LIMITS.codeTtlMs
  });
  assert.equal(expired.status, 400);
  assert.equal((await store.get(`c:${code.body.code}`)).used, false);

  const fresh = await call(store, {
    body: { action: "link", deviceId: HOST, name: "Ada" },
    ip: "198.51.100.8",
    now: NOW + 1000
  });
  for (let index = 0; index < BOARD_LIMITS.joinPerDevice; index += 1) {
    const missed = await call(store, {
      body: { action: "join", code: index % 2 ? "nope" : "AAAAAA", deviceId: JOINER, playerId: JOINER },
      ip: "198.51.100.9",
      now: NOW + 1000 + index
    });
    assert.equal(missed.status, 400);
  }
  const blocked = await call(store, {
    body: { action: "join", code: fresh.body.code, deviceId: JOINER, playerId: JOINER },
    ip: "198.51.100.9",
    now: NOW + 2000
  });
  assert.equal(blocked.status, 429);
  assert.equal((await store.get(`c:${fresh.body.code}`)).used, false);
  const otherDevice = await call(store, {
    body: { action: "join", code: "BBBBBB", deviceId: THIRD, playerId: THIRD },
    ip: "198.51.100.10",
    now: NOW + 2000
  });
  assert.equal(otherDevice.status, 400);
  const later = await call(store, {
    body: {
      action: "join",
      code: fresh.body.code,
      deviceId: JOINER,
      playerId: JOINER,
      library: [{ title: "Soft", artist: "LANY" }]
    },
    ip: "198.51.100.9",
    now: NOW + 1000 + BOARD_LIMITS.codeWindowMs
  });
  assert.equal(later.status, 200);
  assert.equal(later.body.playerId, HOST);
  const used = await call(store, {
    body: { action: "join", code: fresh.body.code, deviceId: THIRD, playerId: THIRD },
    ip: "198.51.100.10",
    now: NOW + 1000 + BOARD_LIMITS.codeWindowMs + 1
  });
  assert.equal(used.status, 400);
});

test("progress sent to the board keeps section hashes and drops lyric fields", () => {
  const snapshot = progressSnapshot({
    totalXp: 9,
    streak: { count: 1, lastDate: "2026-10-04" },
    songs: {
      "soft|lany": {
        title: "Soft",
        artist: "LANY",
        lines: [LYRIC],
        lyrics: LYRIC,
        sections: [LYRIC],
        rounds: { "mix-aaa": { mastered: true, completed: true, mistakes: 0, seen: 1 } },
        chapters: { concert: true },
        lineStats: { ab12: { correct: 2, seen: 2 } }
      }
    }
  });
  assert.equal(JSON.stringify(snapshot).includes(LYRIC), false);
  assert.equal(snapshot.songs["soft|lany"].rounds["mix-aaa"].mastered, true);
  assert.equal(snapshot.songs["soft|lany"].chapters.concert, true);
  assert.equal(snapshot.songs["soft|lany"].lineStats.ab12.correct, 2);
  const local = { totalXp: 1, songs: {} };
  applySharedProgress(local, {
    totalXp: 9,
    songs: {
      "soft|lany": snapshot.songs["soft|lany"],
      "north|lany": {
        title: "North",
        artist: "LANY",
        lyrics: LYRIC,
        rounds: { "mix-ccc": { mastered: true, completed: true, mistakes: 0, seen: 1 } }
      }
    },
    scores: [
      { id: "soft|lany", title: "Soft", artist: "LANY", score: 12, xp: 3 },
      { id: "north|lany", title: "North", artist: "LANY", score: 99, xp: 9 }
    ]
  }, [{ title: "Soft", artist: "LANY" }]);
  assert.deepEqual(Object.keys(local.songs), ["soft|lany"]);
  assert.equal(local.songs["soft|lany"].bestScore, 12);
  assert.equal(local.songs["soft|lany"].chapters.concert, true);
  assert.equal(JSON.stringify(local).includes(LYRIC), false);
});

test("the blob adapter can delete a used code key", async () => {
  const blobs = new Map();
  const store = adaptStore({
    async get(key) { return blobs.get(key) || null; },
    async setJSON(key, value) { blobs.set(key, value); },
    async list() { return { blobs: [...blobs.keys()].map((key) => ({ key })) }; },
    async delete(key) { blobs.delete(key); }
  });
  await store.set("c:ABCDEF", { used: false });
  await store.delete("c:ABCDEF");
  assert.equal(await store.get("c:ABCDEF"), null);
});
