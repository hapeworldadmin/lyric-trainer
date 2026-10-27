import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { buildLesson, seededRng, singingMatch } from "../js/games.js";
import { SAMPLE_SONG } from "../js/sample.js";

const root = path.resolve(import.meta.dirname, "..");
const port = 5221;
const shots = "/opt/cursor/artifacts";

let webkit = null;
try {
  ({ webkit } = await import("playwright"));
} catch {
  webkit = null;
}

function startServer() {
  return spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: "ignore"
  });
}

function waitForServer() {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.on("connect", () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - started > 4000) reject(new Error("preview server did not start"));
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

function installRecognition(page, { deny = false } = {}) {
  return page.addInitScript((denied) => {
    window.__built = 0;
    window.__starts = 0;
    window.__deny = denied;
    class FakeRecognition {
      constructor() {
        window.__built += 1;
        window.__last = this;
      }
      start() {
        window.__starts += 1;
        if (window.__deny) {
          this.onerror?.({ error: "not-allowed" });
          this.onend?.();
          return;
        }
        const text = window.__heard || "";
        if (!text) return;
        this.onresult?.({
          resultIndex: 0,
          results: [{ 0: { transcript: text }, isFinal: true, length: 1 }]
        });
      }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    window.webkitSpeechRecognition = FakeRecognition;
    try { delete window.SpeechRecognition; } catch { /* already absent */ }
    window.SpeechRecognition = undefined;
  }, deny);
}

function roughLine(answer) {
  const words = String(answer).split(/\s+/).filter(Boolean);
  if (words.length >= 4) return words.slice(1).join(" ");
  return words.join(" ");
}

test("webkit sing or type questions on iPhone and Mac", async (t) => {
  if (!webkit) {
    t.skip("playwright is not installed");
    return;
  }
  let browser;
  try {
    browser = await webkit.launch();
  } catch (error) {
    t.skip(`webkit browser is not installed (${error.message})`);
    return;
  }
  const lesson = buildLesson(SAMPLE_SONG.lines, "next", seededRng(4), SAMPLE_SONG.sections, {
    forceSing: true,
    skipIds: [],
    roundId: ""
  });
  const question = lesson[0];
  assert.equal(question.sing, true);
  const heard = roughLine(question.answer);
  assert.equal(singingMatch(question.answer, heard), true);
  assert.equal(singingMatch(question.answer, "nope nope nope nope"), false);
  const server = startServer();
  const viewports = [
    {
      name: "iphone",
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
    },
    {
      name: "mac",
      width: 1280,
      height: 800,
      isMobile: false,
      hasTouch: false,
      deviceScaleFactor: 1,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
    }
  ];
  try {
    await waitForServer();
    await mkdir(shots, { recursive: true });
    const url = `http://127.0.0.1:${port}/#/play/sample-banana-flashlight/next?sing=1&seed=4`;
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
        deviceScaleFactor: viewport.deviceScaleFactor,
        userAgent: viewport.userAgent
      });
      const page = await context.newPage();
      await installRecognition(page);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.getByTestId("sing-input").waitFor();
      const beforeMic = await page.evaluate(() => ({ built: window.__built || 0, starts: window.__starts || 0 }));
      assert.equal(beforeMic.built, 0, "mic permission must wait for a tap");
      assert.equal(beforeMic.starts, 0);
      const idleText = await page.locator("body").innerText();
      assert.equal(idleText.includes(question.answer), false);
      assert.equal(await page.getByTestId("context-previous").innerText(), question.prompt);
      assert.equal(await page.getByTestId("context-next").count(), 0);
      assert.match(await page.getByTestId("question").innerText(), /Sing or type the next line/);
      assert.equal(await page.locator(".btn-primary").count(), 1);
      assert.equal(await page.getByTestId("cant-sing").innerText(), "Can't sing now");
      const hint = await page.locator(".btn-primary .key-hint").evaluate((el) => getComputedStyle(el).display);
      if (viewport.isMobile) assert.equal(hint, "none");
      else assert.notEqual(hint, "none");
      const idleBox = await page.evaluate(() => {
        const previous = document.querySelector("[data-testid=context-previous]").getBoundingClientRect();
        const dock = document.querySelector("[data-testid=answer-dock]").getBoundingClientRect();
        const check = document.querySelector("[data-testid=check]").getBoundingClientRect();
        const input = document.querySelector("[data-testid=sing-input]").getBoundingClientRect();
        return {
          previousBottom: previous.bottom,
          dockTop: dock.top,
          checkBottom: check.bottom,
          inputRight: input.right,
          vh: window.innerHeight,
          vw: window.innerWidth
        };
      });
      assert.ok(idleBox.previousBottom <= idleBox.dockTop + 1, `context overlaps the dock on ${viewport.name}`);
      assert.ok(idleBox.vh - idleBox.checkBottom >= 12 && idleBox.vh - idleBox.checkBottom <= 24, `check bottom ${idleBox.checkBottom} on ${viewport.name}`);
      assert.ok(idleBox.inputRight <= idleBox.vw - 8);
      await page.screenshot({ path: path.join(shots, `sing_idle_${viewport.name}.png`) });

      await page.evaluate((text) => { window.__heard = text; }, heard);
      await page.getByTestId("mic").click();
      await page.getByTestId("live-transcript").waitFor();
      assert.equal(await page.getByTestId("live-transcript").innerText(), heard);
      assert.equal(await page.getByTestId("sing-input").inputValue(), heard);
      assert.match(await page.getByTestId("listen-status").innerText(), /Listening/i);
      const listening = await page.evaluate(() => ({
        starts: window.__starts,
        continuous: window.__last.continuous,
        interim: window.__last.interimResults,
        pressed: document.querySelector("[data-testid=mic]").getAttribute("aria-pressed"),
        primary: document.querySelectorAll(".btn-primary").length
      }));
      assert.equal(listening.starts, 1);
      assert.equal(listening.continuous, viewport.isMobile ? false : true);
      assert.equal(listening.interim, true);
      assert.equal(listening.pressed, "true");
      assert.equal(listening.primary, 1);
      assert.equal((await page.locator("body").innerText()).includes(question.answer), false);
      await page.screenshot({ path: path.join(shots, `sing_listening_${viewport.name}.png`) });

      await page.getByTestId("cant-sing").click();
      await page.locator(".choice").first().waitFor();
      assert.equal(await page.getByTestId("sing-input").count(), 0);
      assert.equal(await page.getByTestId("mic").count(), 0);
      assert.equal(await page.getByTestId("context-next").count(), 0);
      assert.match(await page.locator("body").innerText(), /What comes next\?/);
      assert.equal(await page.locator(".btn-primary").count(), 0);
      const choiceText = await page.locator(".choice").allInnerTexts();
      assert.equal(choiceText.some((choice) => choice.includes(question.answer)), true);
      await page.screenshot({ path: path.join(shots, `sing_fallback_${viewport.name}.png`) });
      await context.close();
    }

    const graded = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      userAgent: viewports[0].userAgent
    });
    const gradePage = await graded.newPage();
    await installRecognition(gradePage);
    await gradePage.goto(url, { waitUntil: "domcontentloaded" });
    await gradePage.getByTestId("sing-input").waitFor();
    await gradePage.keyboard.press("1");
    assert.equal(await gradePage.getByTestId("sing-input").count(), 1);
    const shaken = await gradePage.evaluate(() => {
      const input = document.getElementById("answer-input");
      input.value = "nope nope nope nope";
      document.querySelector("[data-testid=check]").click();
      return {
        className: document.getElementById("sing-field").className,
        hearts: document.querySelectorAll(".heart.is-empty").length,
        feedback: Boolean(document.querySelector("[data-testid=feedback]"))
      };
    });
    assert.match(shaken.className, /is-reject/);
    assert.equal(shaken.hearts, 1);
    assert.equal(shaken.feedback, false);
    await gradePage.waitForTimeout(400);
    assert.equal(await gradePage.getByTestId("sing-input").count(), 1);
    assert.equal(await gradePage.getByTestId("feedback").count(), 0);
    assert.equal(await gradePage.locator("#sing-field").evaluate((el) => el.className), "sing-field");
    await gradePage.evaluate(() => {
      document.addEventListener("submit", () => {
        window.__flash = document.getElementById("sing-field").className;
      });
    });
    await gradePage.getByTestId("sing-input").fill(heard);
    await gradePage.getByTestId("sing-input").press("Enter");
    assert.match(await gradePage.evaluate(() => window.__flash || ""), /is-accept/);
    await gradePage.getByTestId("feedback").waitFor();
    assert.match(await gradePage.getByTestId("feedback").innerText(), /Correct/);
    assert.match(await gradePage.getByTestId("feedback").innerText(), new RegExp(question.answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await graded.close();

    const plain = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent: viewports[0].userAgent
    });
    const plainPage = await plain.newPage();
    await plainPage.addInitScript(() => {
      const block = { configurable: true, get() { return undefined; } };
      Object.defineProperty(window, "SpeechRecognition", block);
      Object.defineProperty(window, "webkitSpeechRecognition", block);
    });
    await plainPage.goto(url, { waitUntil: "domcontentloaded" });
    await plainPage.getByTestId("sing-input").waitFor();
    assert.equal(await plainPage.getByTestId("mic").count(), 0);
    assert.equal(await plainPage.locator(".error, .toast").count(), 0);
    assert.match(await plainPage.getByTestId("question").innerText(), /Type the next line/);
    assert.equal(await plainPage.getByTestId("cant-sing").count(), 1);
    await plain.close();

    const denied = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      isMobile: false,
      hasTouch: false,
      userAgent: viewports[1].userAgent
    });
    const deniedPage = await denied.newPage();
    await installRecognition(deniedPage, { deny: true });
    await deniedPage.goto(url, { waitUntil: "domcontentloaded" });
    await deniedPage.getByTestId("mic").waitFor();
    await deniedPage.getByTestId("mic").click();
    await deniedPage.getByTestId("mic").waitFor({ state: "detached" });
    assert.equal(await deniedPage.getByTestId("sing-input").count(), 1);
    assert.equal(await deniedPage.locator(".error, .toast").count(), 0);
    assert.match(await deniedPage.getByTestId("question").innerText(), /Type the next line/);
    await deniedPage.getByTestId("sing-input").fill(heard);
    await deniedPage.keyboard.press("Enter");
    await deniedPage.getByTestId("feedback").waitFor();
    assert.match(await deniedPage.getByTestId("feedback").innerText(), /Correct/);
    await denied.close();
  } finally {
    server.kill();
    await browser.close();
  }
});
