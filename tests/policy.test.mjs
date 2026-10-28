import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { shareText } from "../js/share.js";
import { SAMPLE_SONG } from "../js/sample.js";

const root = path.resolve(import.meta.dirname, "..");
const bannedHosts = [
  "genius" + ".com",
  "az" + "lyrics",
  "musix" + "match",
  "lyrics" + ".ovh",
  "metro" + "lyrics",
  "song" + "lyrics.com",
  "lyric" + "find"
];

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(full));
    else found.push(full);
  }
  return found;
}

test("the repo does not bundle real lyric-site hosts or the sample lines outside the sample song", async () => {
  const files = await filesUnder(root);
  assert.ok(files.length > 5);
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const relative = path.relative(root, file);
    for (const host of bannedHosts) {
      assert.equal(text.toLowerCase().includes(host), false, `${relative} mentions ${host}`);
    }
    if (relative !== path.join("js", "sample.js")) {
      for (const line of SAMPLE_SONG.lines) {
        assert.equal(text.includes(line), false, `${relative} contains a bundled lyric line`);
      }
    }
    if (relative.endsWith(".js") || relative.endsWith(".mjs") || relative.endsWith(".html")) {
      assert.equal(text.includes("XMLHttp" + "Request"), false, relative);
      const fetches = text.match(/fetch\s*\(/g) || [];
      if (fetches.length) {
        const concerts = text.includes("concerts.json") && fetches.length === 1;
        const board = text.includes("/.netlify/functions/leaderboard") && fetches.length === 1 && !text.includes("concerts.json");
        assert.equal(concerts || board, true, `${relative} should only read concerts.json or the shared score board`);
      }
    }
  }
});

test("share text is score, title, and streak", () => {
  const text = shareText({
    kind: "song",
    playerName: "Alex",
    title: SAMPLE_SONG.title,
    artist: SAMPLE_SONG.artist,
    score: 420,
    streak: 3,
    detail: "Fill the blank"
  });
  assert.match(text, /Alex scored 420/);
  assert.match(text, /3 days/);
  for (const line of SAMPLE_SONG.lines) assert.equal(text.includes(line), false);
  const concert = shareText({
    kind: "concert",
    playerName: "Alex",
    title: "LANY Soft World Tour",
    score: 80,
    streak: 1,
    detail: "0 of 0 songs mastered"
  });
  assert.match(concert, /LANY Soft World Tour/);
  assert.match(concert, /1 day\./);
});
