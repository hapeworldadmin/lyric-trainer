import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const port = 5198;
const lyricPaste = "[Verse]\nalpha one two\nbeta three four\n\n[Chorus]\ngamma five six";

function lessonDockMetrics() {
  const bar = document.querySelector(".lesson-bar");
  const next = bar?.nextElementSibling;
  const check = document.querySelector("[data-testid=check], [data-testid=continue]");
  const chips = document.querySelector(".answer-dock .pool, .answer-dock .choices");
  const line = document.querySelector(".target-line");
  const scroll = document.querySelector(".play-scroll");
  const dock = document.querySelector(".answer-dock");
  const rule = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules].map((item) => item.cssText)).join("\n");
  const box = (el) => {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right };
  };
  const scrollBox = box(scroll);
  const chipBox = box(chips);
  const checkBox = box(check);
  const lineBox = box(line);
  return {
    gap: bar && next ? next.getBoundingClientRect().top - bar.getBoundingClientRect().bottom : null,
    line: lineBox,
    chips: chipBox,
    check: checkBox,
    scroll: scrollBox,
    checkPadding: dock ? getComputedStyle(dock).paddingBottom : "",
    safeArea: /\.answer-dock\{[^}]*env\(safe-area-inset-bottom\)/.test(rule.replace(/\s+/g, ""))
      && /env\(safe-area-inset-top\)/.test(rule)
      && /env\(safe-area-inset-left\)/.test(rule)
      && /env\(safe-area-inset-right\)/.test(rule),
    overlaps: Boolean(scrollBox && chipBox && scrollBox.bottom > chipBox.top + 1),
    vh: window.innerHeight,
    vw: window.innerWidth
  };
}

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
    assert.equal(look.token.bg, "rgb(38, 38, 50)");
    assert.equal(look.token.border, "rgb(92, 92, 112)");
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
    const dock = await page.evaluate(lessonDockMetrics);
    assert.ok(dock.gap >= 16, `progress gap ${dock.gap}`);
    assert.ok(dock.line.bottom <= dock.scroll.bottom + 1);
    assert.ok(dock.scroll.bottom <= dock.chips.top + 1);
    assert.ok(dock.chips.bottom <= dock.check.top + 1);
    assert.ok(dock.vh - dock.check.bottom >= 12 && dock.vh - dock.check.bottom <= 24, `check bottom gap ${dock.vh - dock.check.bottom}`);
    assert.equal(dock.checkPadding, "16px");
    assert.equal(dock.safeArea, true);
    assert.equal(dock.overlaps, false);
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

test("webkit first lesson is line order, not section order, on iPhone and Mac", async (t) => {
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
  const flowPort = port + 3;
  const server = spawn("python3", ["-m", "http.server", String(flowPort), "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: "ignore"
  });
  const wait = () => new Promise((resolve, reject) => {
    const started = Date.now();
    const attempt = () => {
      const socket = net.connect(flowPort, "127.0.0.1");
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
    const viewports = [
      { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      { width: 1280, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }
    ];
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
        deviceScaleFactor: viewport.deviceScaleFactor
      });
      const page = await context.newPage();
      const base = `http://127.0.0.1:${flowPort}`;
      await page.goto(`${base}/#/song/sample-banana-flashlight`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("game-lines").waitFor();
      const songText = await page.locator("body").innerText();
      assert.equal(songText.includes("Flow"), false);
      assert.equal(songText.includes("Tap the opening lines"), false);
      assert.match(await page.getByTestId("chapter-progress").innerText(), /0 of 3 chapters/);
      assert.match(await page.getByTestId("game-lines").innerText(), /Build/);
      assert.equal(await page.getByTestId("game-sections").count(), 0);

      await page.getByTestId("game-lines").click();
      await page.getByTestId("play").waitFor();
      const ask = await page.getByTestId("question").innerText();
      assert.match(ask, /tap the lines in order/i);
      assert.equal(ask.includes("opening lines"), false);
      assert.equal(await page.getByText("The order appears here").count(), 0);
      assert.doesNotMatch(await page.locator(".play-crumb").innerText(), /Flow/);
      const tapped = await page.locator(".pool .token").first().evaluate((el) => {
        el.click();
        return el.className;
      });
      assert.match(tapped, /is-accept|is-reject/);

      await page.goto(`${base}/#/play/sample-banana-flashlight/concert`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("play").waitFor();
      const finalText = await page.locator("body").innerText();
      assert.equal(finalText.includes("Tap the opening lines"), false);
      assert.equal(finalText.includes("The order appears here"), false);
      assert.equal(finalText.includes("Flow"), false);
      assert.equal(await page.getByTestId("question").count(), 1);
      await context.close();
    }
  } finally {
    server.kill();
    await browser.close();
  }
});

test("webkit lesson dock, hero contrast, and answer type hold on iPhone and Mac", async (t) => {
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
  const layoutPort = port + 2;
  const server = spawn("python3", ["-m", "http.server", String(layoutPort), "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: "ignore"
  });
  const wait = () => new Promise((resolve, reject) => {
    const started = Date.now();
    const attempt = () => {
      const socket = net.connect(layoutPort, "127.0.0.1");
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
    const viewports = [
      { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      { width: 1280, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
      { width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    ];
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
        deviceScaleFactor: viewport.deviceScaleFactor
      });
      const page = await context.newPage();
      const base = `http://127.0.0.1:${layoutPort}`;
      await page.goto(`${base}/#/`, { waitUntil: "domcontentloaded" });
      await page.locator(".hero").waitFor();
      const hero = await page.locator(".hero").evaluate((el) => getComputedStyle(el).backgroundImage);
      assert.match(hero, /rgb\(110,\s*79,\s*240\)/, hero);

      await page.goto(`${base}/#/play/sample-banana-flashlight/order`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("check").waitFor();
      const order = await page.evaluate(lessonDockMetrics);
      assert.equal(await page.locator(".target-line").evaluate((el) => getComputedStyle(el).fontSize), "22px");
      assert.equal(await page.locator(".target-line").evaluate((el) => getComputedStyle(el).fontWeight), "700");
      assert.ok(order.gap >= 16, `progress gap ${order.gap}`);
      assert.equal(order.overlaps, false);
      assert.ok(order.scroll.bottom <= order.chips.top + 1);
      assert.ok(order.chips.bottom <= order.check.top + 1);
      assert.ok(order.vh - order.check.bottom >= 12 && order.vh - order.check.bottom <= 24);
      assert.equal(order.safeArea, true);
      const chip = await page.locator(".pool .token").first().evaluate((el) => {
        const style = getComputedStyle(el);
        return { bg: style.backgroundColor, border: style.borderTopColor };
      });
      assert.equal(chip.bg, "rgb(38, 38, 50)");
      assert.equal(chip.border, "rgb(92, 92, 112)");

      const tapped = await page.locator(".pool .token").first().evaluate((el) => {
        el.click();
        return el.className;
      });
      assert.match(tapped, /is-accept|is-reject/);
      const built = await page.locator("[data-testid=tray]").evaluate((tray) => {
        const probe = document.createElement("span");
        probe.className = "token is-set";
        probe.textContent = "line";
        tray.appendChild(probe);
        const style = getComputedStyle(probe);
        const result = { size: style.fontSize, weight: style.fontWeight };
        probe.remove();
        return result;
      });
      assert.equal(built.size, "22px");
      assert.equal(built.weight, "700");

      await page.evaluate(() => {
        const spacer = document.createElement("div");
        spacer.style.height = "1400px";
        document.querySelector(".play-scroll")?.appendChild(spacer);
      });
      const tall = await page.evaluate(lessonDockMetrics);
      assert.equal(tall.overlaps, false);
      assert.ok(tall.check.bottom <= tall.vh);
      assert.ok(tall.vh - tall.check.bottom <= 24);

      let choicesReady = false;
      for (const seed of ["", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
        const query = seed ? `?seed=${seed}` : "";
        await page.goto(`${base}/#/play/sample-banana-flashlight/next${query}`, { waitUntil: "domcontentloaded" });
        await page.getByTestId("play").waitFor();
        if (await page.getByTestId("cant-sing").count()) await page.getByTestId("cant-sing").click();
        if (await page.locator(".choice").count()) {
          choicesReady = true;
          break;
        }
      }
      assert.equal(choicesReady, true);
      await page.locator(".choice").first().waitFor();
      const next = await page.evaluate(lessonDockMetrics);
      assert.equal(next.overlaps, false);
      assert.ok(next.chips.bottom > next.vh * 0.45, `chips should sit in the lower half, bottom ${next.chips.bottom}`);
      await page.keyboard.press("1");
      await page.getByTestId("feedback").waitFor();
      const answer = await page.locator(".feedback .answer").evaluate((el) => {
        const style = getComputedStyle(el);
        return { size: style.fontSize, weight: style.fontWeight };
      });
      assert.equal(answer.size, "22px");
      assert.equal(answer.weight, "700");
      const after = await page.evaluate(lessonDockMetrics);
      assert.equal(after.overlaps, false);
      assert.ok(after.vh - after.check.bottom >= 12 && after.vh - after.check.bottom <= 24);
      await page.keyboard.press("Enter");
      await page.locator(".choice, [data-testid=final-score], [data-testid=sing-input]").first().waitFor();
      await context.close();
    }
  } finally {
    server.kill();
    await browser.close();
  }
});
