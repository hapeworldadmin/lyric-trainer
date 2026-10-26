import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const port = 5198;
const lyricPaste = "[Verse]\nalpha one two\nbeta three four\n\n[Chorus]\ngamma five six";

let webkit = null;
try {
  ({ webkit } = await import("playwright"));
} catch {
  webkit = null;
}

function startServer() {
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: "ignore"
  });
  return server;
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
        if (Date.now() - started > 2000) reject(new Error("preview server did not start"));
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

async function openSheet(page) {
  await page.goto(`http://127.0.0.1:${port}/#/concert/lany-soft-world-tour`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("setlist-slot").first().click();
  await page.getByTestId("paste-sheet").waitFor();
  await page.getByTestId("paste-clipboard").waitFor();
}

test("webkit paste reads the clipboard inside the click and previews from a paste event", async (t) => {
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
  const server = startServer();
  try {
    await waitForServer();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      window.__clip = { calls: [] };
      const clipboard = {
        readText() {
          const stack = new Error().stack || "";
          window.__clip.calls.push({ inClickHandler: stack.includes("onClick"), stack });
          return Promise.resolve("[Verse]\nalpha one two\nbeta three four\n\n[Chorus]\ngamma five six");
        }
      };
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
    });
    const page = await context.newPage();
    await openSheet(page);

    const find = page.getByTestId("find-lyrics");
    const border = await find.evaluate((el) => getComputedStyle(el).borderTopWidth);
    assert.notEqual(border, "0px");
    assert.match(await find.getAttribute("class"), /btn-secondary/);

    await page.getByTestId("paste-clipboard").click();
    await page.getByTestId("looks-right").waitFor();
    const calls = await page.evaluate(() => window.__clip.calls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].inClickHandler, true, calls[0].stack);
    assert.equal(await page.getByTestId("use-fallback").count(), 0);

    await page.getByTestId("try-again").click();
    await page.evaluate(() => {
      navigator.clipboard.readText = () => Promise.reject(new Error("denied"));
    });
    await page.getByTestId("paste-clipboard").click();
    const box = page.getByTestId("lyrics");
    await box.waitFor();
    assert.equal(await page.getByTestId("paste-debug").innerText(), "Error");
    await page.getByTestId("paste-hint").waitFor();
    assert.equal(await page.getByTestId("paste-hint").innerText(), "Press Cmd+V (or long-press, Paste)");
    assert.equal(await page.getByTestId("use-fallback").isHidden(), true);
    assert.equal(await box.evaluate((el) => el === document.activeElement), true);

    await page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: data });
      document.body.dispatchEvent(event);
    }, lyricPaste);
    await page.getByTestId("looks-right").waitFor();

    await page.getByTestId("try-again").click();
    await page.evaluate(() => {
      navigator.clipboard.readText = () => Promise.reject(new Error("denied"));
    });
    await page.getByTestId("paste-clipboard").click();
    await page.getByTestId("lyrics").waitFor();
    await page.getByTestId("lyrics").fill("alpha one two\nbeta three four");
    assert.equal(await page.getByTestId("use-fallback").isHidden(), false);
    await page.getByTestId("use-fallback").click();
    await page.getByTestId("looks-right").waitFor();
    await context.close();
  } finally {
    server.kill();
    await browser.close();
  }
});

test("webkit word order accepts number keys and Enter, and ignores keys in a field", async (t) => {
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
  const keyboardPort = port + 1;
  const server = spawn("python3", ["-m", "http.server", String(keyboardPort), "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: "ignore"
  });
  const wait = () => new Promise((resolve, reject) => {
    const started = Date.now();
    const attempt = () => {
      const socket = net.connect(keyboardPort, "127.0.0.1");
      socket.on("connect", () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - started > 2000) reject(new Error("preview server did not start"));
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });
  try {
    await wait();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${keyboardPort}/#/play/sample-banana-flashlight/order`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("check").waitFor();
    assert.equal(await page.getByTestId("next-lyrics").count(), 0);
    const look = await page.evaluate(() => {
      const read = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const style = getComputedStyle(el);
        return {
          color: style.color,
          size: style.fontSize,
          weight: style.fontWeight,
          bg: style.backgroundColor,
          border: style.borderTopColor,
          borderStyle: style.borderTopStyle,
          minHeight: style.minHeight,
          width: style.width,
          height: style.height,
          display: style.display,
          text: el.textContent
        };
      };
      return {
        line: read(".target-line"),
        blank: read(".target-blank"),
        token: read(".pool .token"),
        tray: read("[data-testid=tray]"),
        crumb: read("[data-testid=play-crumb]"),
        heart: read(".heart"),
        hint: read(".key-hint"),
        check: read("[data-testid=check]")
      };
    });
    assert.equal(look.line.color, "rgb(245, 245, 247)");
    assert.equal(look.line.size, "22px");
    assert.equal(look.line.weight, "700");
    assert.equal(look.blank.color, "rgb(139, 111, 255)");
    assert.equal(look.token.bg, "rgb(31, 31, 40)");
    assert.equal(look.token.border, "rgb(42, 42, 53)");
    assert.equal(look.token.size, "17px");
    assert.equal(look.token.weight, "600");
    assert.equal(look.token.minHeight, "48px");
    assert.equal(look.tray.minHeight, "56px");
    assert.equal(look.tray.borderStyle, "dashed");
    assert.equal(look.tray.border, "rgb(124, 92, 255)");
    assert.equal(look.crumb.size, "12px");
    assert.equal(look.crumb.weight, "600");
    assert.match(look.crumb.text, /Word order/);
    assert.equal(look.heart.width, "16px");
    assert.equal(look.heart.height, "16px");
    assert.equal(look.heart.color, "rgb(255, 77, 109)");
    assert.ok(look.hint.display === "inline-flex" || look.hint.display === "flex");
    assert.equal(look.check.bg, "rgb(139, 111, 255)");
    await page.evaluate(() => {
      const badge = document.createElement("div");
      badge.id = "netlify-drawer";
      document.body.appendChild(badge);
    });
    await page.waitForFunction(() => !document.getElementById("netlify-drawer"));

    await page.keyboard.press("1");
    await page.waitForTimeout(400);
    await page.keyboard.press("Enter");
    await page.locator("#play-note").waitFor();
    assert.match(await page.locator("#play-note").innerText(), /Place every word first/);
    assert.equal(await page.getByTestId("feedback").count(), 0);

    await page.goto(`http://127.0.0.1:${keyboardPort}/#/me`, { waitUntil: "domcontentloaded" });
    const name = page.getByTestId("player-name");
    await name.waitFor();
    await name.click();
    await page.keyboard.press("1");
    assert.equal(await name.inputValue(), "1");
    assert.match(page.url(), /#\/me/);
    await context.close();
  } finally {
    server.kill();
    await browser.close();
  }
});
