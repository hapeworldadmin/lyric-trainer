import { blip } from "./audio.js?v=9";
import { readClipboardFromGesture } from "./clipboard.js?v=9";
import { activeConcertSummary, concertStatusLine, concertsForSong, leaderboardFromSongScores, normalizeConcerts } from "./concerts.js?v=10";
import {
  GAMES,
  advanceFade,
  answersMatch,
  applyThink,
  buildLesson,
  chapterPlan,
  correctLine,
  fadeLessonFraction,
  fadePassLabel,
  firstLessonId,
  gameAvailability,
  gradeAnswer,
  initialThink,
  judgeOrderTap,
  lessonBonus,
  nextPractice,
  pointsFor,
  questionSeconds,
  sectionProgress,
  seededRng,
  singingMatch,
  studyFrame
} from "./games.js?v=13";
import { analyzePaste, choosePasteSource, cleanPastedPage, draftLyrics, searchLyricsUrl } from "./parse.js?v=9";
import {
  addBonusXp,
  buildExport,
  emptyProgress,
  finishStreak,
  mergeImport,
  markChapter,
  masteredRoundIds,
  recordLineResult,
  recordRoundResult,
  recordRun,
  resetLineMasteryIfChanged,
  retitleSongProgress,
  songStats
} from "./progress.js?v=10";
import { SAMPLE_SONG } from "./sample.js?v=9";
import { createScoreProvider, sanitizeRun } from "./scores.js?v=10";
import { drawShareCard, shareText } from "./share.js?v=9";
import {
  activePlayer,
  activeProgress as progressOf,
  blankState,
  loadState,
  sampleRecord,
  saveState,
  seedSample
} from "./storage.js?v=10";
import { createLineRecognizer, speechRecognitionSupported } from "./speech.js?v=11";
import { clip, escapeHtml, normalizeAnswer, songKey, songsMatch, uid } from "./text.js?v=11";
import { interpretHearing } from "./voice.js?v=11";

const session = {
  state: null,
  concerts: [],
  concertsError: "",
  route: { name: "home", params: {} },
  play: null,
  results: null,
  form: null,
  modal: null,
  toast: "",
  toastTimer: 0,
  boardFilter: "",
  renaming: "",
  shareUrl: ""
};

let renderToken = 0;
let timerId = null;
let ear = null;

const ICONS = {
  note: '<path fill="currentColor" d="M9 17.5a2.5 2.5 0 1 1-2.2-2.48V6.1l9-1.8v8.2a2.5 2.5 0 1 1-2-2.45V6.4l-4.8 1V17.5z"/>',
  flame: '<path fill="currentColor" d="M12.2 2c.4 3-1.2 4.4-1.2 6.2 0 1.2.7 2 1.6 2.6C10.2 9.2 8 8.2 8 5.6 5.4 7.4 4 10 4 12.8 4 17.3 7.4 21 12 21s8-3.6 8-8.2c0-4.2-3.2-6.6-4.4-8.6-.4 1.6-1.6 2.6-2.6 2.8.2-2 .2-3.6-.8-5z"/>',
  heart: '<path fill="currentColor" d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z"/>',
  plus: '<path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>',
  home: '<path fill="currentColor" d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
  list: '<path fill="currentColor" d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/>',
  trophy: '<path fill="currentColor" d="M7 4h10v3a5 5 0 0 1-3 4.6V16h3v2H7v-2h3v-4.4A5 5 0 0 1 7 7V4zm0 2v1a3 3 0 0 0 3 3h1V6zm10 0h-4v4h1a3 3 0 0 0 3-3z"/>',
  user: '<path fill="currentColor" d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2-7 4.5V21h14v-2.5C19 16 16 14 12 14z"/>',
  back: '<path fill="currentColor" d="M14.5 5 7.5 12l7 7 1.4-1.4L10.3 12l5.6-5.6z"/>',
  close: '<path fill="currentColor" d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"/>',
  mic: '<path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-4 4.9V19h3v2H8v-2h3v-2.1A5 5 0 0 1 7 12H5a7 7 0 0 0 6 6.7V21h2v-2.3A7 7 0 0 0 19 12h-2z"/>',
  lock: '<path fill="currentColor" d="M8 10V8a4 4 0 0 1 8 0v2h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h1zm2 0h4V8a2 2 0 0 0-4 0v2z"/>'
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

function persist() {
  try {
    saveState(session.state);
  } catch {
    armToast("This browser could not save more data.");
  }
}

function providerFor() {
  return createScoreProvider(() => session.state, persist);
}

function armToast(message) {
  session.toast = message;
  clearTimeout(session.toastTimer);
  session.toastTimer = setTimeout(() => {
    session.toast = "";
    document.querySelector(".toast")?.remove();
  }, 2800);
}

async function boot() {
  session.state = loadState();
  persist();
  try {
    const response = await fetch(new URL("../concerts.json", import.meta.url));
    if (!response.ok) throw new Error("missing");
    session.concerts = normalizeConcerts(await response.json());
    session.concertsError = session.concerts.length ? "" : "No concerts are listed in concerts.json yet.";
  } catch {
    session.concerts = [];
    session.concertsError = "Concerts could not be loaded. Open Know the Verse through a local server or GitHub Pages.";
  }
  window.addEventListener("hashchange", sync);
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("paste", onSheetPaste);
  watchNetlifyBadge();
  document.addEventListener("input", onInput);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("change", onChange);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") stopListening();
  });
  bindPlayViewport();
  if (!location.hash) location.hash = "#/";
  sync();
}

function fitPlayViewport() {
  const app = document.querySelector(".app.is-play");
  if (!app) return;
  const viewport = window.visualViewport;
  if (!viewport) {
    app.style.height = "";
    app.style.transform = "";
    return;
  }
  const top = viewport.offsetTop || 0;
  app.style.height = `${Math.round(viewport.height)}px`;
  app.style.transform = top ? `translateY(${top}px)` : "";
}

let viewportBound = false;

function bindPlayViewport() {
  if (viewportBound) return;
  viewportBound = true;
  window.visualViewport?.addEventListener("resize", fitPlayViewport);
  window.visualViewport?.addEventListener("scroll", fitPlayViewport);
  window.addEventListener("resize", fitPlayViewport);
}

function parseHash() {
  const raw = (location.hash || "#/").slice(1);
  const queryAt = raw.indexOf("?");
  const path = queryAt >= 0 ? raw.slice(0, queryAt) : raw;
  const params = Object.fromEntries(new URLSearchParams(queryAt >= 0 ? raw.slice(queryAt + 1) : ""));
  const parts = path.split("/").filter(Boolean);
  const head = parts[0] || "home";
  if (head === "song" && parts[1]) return { name: "song", songId: safeDecode(parts[1]), params };
  if (head === "edit" && parts[1]) return { name: "edit", songId: safeDecode(parts[1]), params };
  if (head === "play" && parts[1] && parts[2]) return { name: "play", songId: safeDecode(parts[1]), gameId: parts[2], params };
  if (head === "concert" && parts[1]) return { name: "concert", concertId: safeDecode(parts[1]), params };
  if (["add", "board", "me", "concerts", "results"].includes(head)) return { name: head, params };
  return { name: "home", params };
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function sync() {
  session.route = parseHash();
  if (session.route.name !== "play") {
    stopTimer();
    stopListening();
  }
  if (session.route.name === "add" || session.route.name === "edit") ensureForm();
  if (session.route.name === "results" && !session.results) {
    location.hash = "#/";
    return;
  }
  if (session.route.name === "play" && !ensurePlay()) return;
  render();
}

function go(hash) {
  if ((location.hash || "#/") === hash) sync();
  else location.hash = hash;
}

async function render() {
  const token = ++renderToken;
  const route = session.route;
  let body = "";
  const play = route.name === "play";
  try {
    if (route.name === "home") body = viewHome();
    else if (route.name === "add" || route.name === "edit") body = viewForm();
    else if (route.name === "song") body = viewSong();
    else if (route.name === "play") body = viewPlay();
    else if (route.name === "results") body = viewResults();
    else if (route.name === "concerts") body = viewConcerts();
    else if (route.name === "concert") body = await viewConcert();
    else if (route.name === "board") body = await viewBoard();
    else if (route.name === "me") body = viewMe();
    else body = viewHome();
  } catch (error) {
    body = `<section class="screen"><h1>Something went wrong</h1><p>${escapeHtml(error.message || "Try again.")}</p></section>`;
  }
  if (token !== renderToken) return;
  document.querySelector("dialog[open]")?.close();
  document.getElementById("app").innerHTML = shell(body, { play });
  afterRender();
}

const ACCENTS = ["violet", "coral", "cyan"];

function toneFor(name) {
  if (name === "concerts" || name === "concert") return "concerts";
  if (name === "board") return "board";
  if (name === "me") return "me";
  return "songs";
}

function accentForId(concertId) {
  const index = session.concerts.findIndex((item) => item.id === concertId);
  return ACCENTS[(index >= 0 ? index : 0) % ACCENTS.length];
}

function shellAccent() {
  const route = session.route;
  if (route.name === "concert") return accentForId(route.concertId);
  if (route.name === "song" || route.name === "play" || route.name === "edit" || route.name === "results") {
    const songId = route.songId || session.play?.songId || session.results?.songId;
    const song = findSong(songId);
    const concert = song ? concertsForSong(session.concerts, song.title, song.artist)[0] : null;
    if (concert) return accentForId(concert.id);
  }
  return session.concerts[0] ? accentForId(session.concerts[0].id) : "violet";
}

function accentStyle(concert) {
  const hex = concert?.accent || "";
  if (!/^#[0-9A-F]{6}$/.test(hex)) return "";
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.round(((value >> shift) & 255) * 0.55).toString(16).padStart(2, "0");
  const mid = `#${channel(16)}${channel(8)}${channel(0)}`;
  return `--accent:${hex};--hero-mid:${mid};--glow:${hex}73;--on-accent:#0b0b0f`;
}

function shell(body, { play }) {
  const tone = toneFor(session.route.name);
  const tabs = !play && session.route.name !== "results";
  const route = session.route;
  const song = findSong(route.songId || session.play?.songId || session.results?.songId);
  const concert = route.name === "concert"
    ? session.concerts.find((item) => item.id === route.concertId)
    : (song ? concertsForSong(session.concerts, song.title, song.artist)[0] : session.concerts[0]);
  return `
    <div class="app tone-${tone} accent-${shellAccent()} ${play ? "is-play" : ""} ${tabs ? "has-tabs" : ""}" style="${accentStyle(concert)}">
      ${play ? "" : topbar()}
      <main>${body}</main>
      ${tabs ? tabbar() : ""}
    </div>
    ${modalHtml()}
    ${session.toast ? `<p class="toast" role="status">${escapeHtml(session.toast)}</p>` : ""}
  `;
}

function topbar() {
  const progress = progressOf(session.state);
  const streak = progress.streak?.count || 0;
  const xp = progress.totalXp || 0;
  const pills = [
    streak > 0 ? `<span class="pill" data-testid="streak-count">${icon("flame")} ${streak} streak</span>` : "",
    xp > 0 ? `<span class="pill" data-testid="xp-total">${formatScore(xp)} XP</span>` : ""
  ].join("");
  return `
    <header class="topbar">
      <a class="brand" href="#/">Know the Verse</a>
      ${pills ? `<div class="pills">${pills}</div>` : ""}
    </header>
  `;
}

function tabbar() {
  const tabs = [
    ["home", "#/", "Home", "home"],
    ["concerts", "#/concerts", "Concerts", "list"],
    ["board", "#/board", "Board", "trophy"],
    ["me", "#/me", "Me", "user"]
  ];
  return `<nav class="tabbar">${tabs.map(([id, href, label, glyph]) => `
    <a href="${href}" class="${tabOn(id) ? "is-on" : ""}" data-testid="nav-${id}">${icon(glyph)} ${label}</a>
  `).join("")}</nav>`;
}

function tabOn(id) {
  const name = session.route.name;
  const section = navSection();
  if (id === "home") {
    if (name === "song") return false;
    if (["add", "edit", "play", "results"].includes(name)) return section === "home";
    return name === "home";
  }
  if (id === "concerts") {
    if (["song", "add", "edit", "play", "results"].includes(name)) return section === "concerts";
    return name === "concerts" || name === "concert";
  }
  return name === id;
}

function navSection() {
  if (session.section) return session.section;
  const route = session.route;
  if (route.name === "add" && session.form?.fromConcert) return "concerts";
  if (["song", "edit", "play", "results"].includes(route.name)) {
    const song = findSong(route.songId || session.play?.songId || session.results?.songId);
    if (song && concertsForSong(session.concerts, song.title, song.artist).length) return "concerts";
  }
  return "home";
}

function viewHome() {
  const songs = [...session.state.songs].sort((a, b) => b.updatedAt - a.updatedAt);
  const concert = session.concerts[0];
  const summary = concert ? activeConcertSummary(concert, session.state.songs, progressOf(session.state)) : null;
  const upcoming = (summary?.slots || []).filter((slot) => !slot.mastered).slice(0, 3);
  const upNext = upcoming.length ? `
    <p class="kicker">Up next</p>
    <div class="rows" data-testid="up-next">${upcoming.map((slot) => upNextRow(concert, slot)).join("")}</div>` : "";
  const hero = concert && summary?.total ? `
    <header class="hero" style="${accentStyle(concert)}">
      <p class="kicker">Next up</p>
      <h1>${escapeHtml(concert.name)}</h1>
      <p class="hero-stat" data-testid="home-status">${escapeHtml(concertStatusLine(summary))}</p>
      <a class="btn btn-hero" href="#/concert/${encodeURIComponent(concert.id)}">Continue</a>
      <a class="btn btn-text btn-text-on-hero" href="#/add" data-testid="add-song">Add song</a>
    </header>` : `
    <header class="page-head">
      <h1>Songs</h1>
      <a class="btn btn-primary" href="#/add" data-testid="add-song">Add song</a>
    </header>`;
  const list = songs.length
    ? `<div class="rows" data-testid="song-list">${songs.map((song) => songCard(song)).join("")}</div>`
    : `
    <div class="empty">
      <p>No songs on this device yet.</p>
      <button class="btn btn-text" type="button" data-action="restore-sample">Restore the sample song</button>
    </div>`;
  return `
    <section class="screen">
      ${hero}
      ${upNext}
      <p class="kicker">Songs</p>
      ${list}
    </section>
  `;
}

function upNextRow(concert, slot) {
  const href = slot.status === "needs-lyrics"
    ? `#/add?title=${encodeURIComponent(slot.title)}&artist=${encodeURIComponent(slot.artist)}&concert=${encodeURIComponent(concert.id)}`
    : `#/song/${encodeURIComponent(slot.songId)}`;
  return `
    <a class="set-row up-row" data-testid="up-next-row" href="${href}">
      <span class="set-num">${slot.index + 1}</span>
      <span class="row-main"><strong>${escapeHtml(slot.title)}</strong><span class="sub">${escapeHtml(slot.artist)}</span></span>
    </a>`;
}

function songCard(song) {
  const stats = songStats(progressOf(session.state), song);
  const sample = song.sample ? " · Sample" : "";
  const detail = stats.linesMastered > 0
    ? `${stats.linesMastered} of ${stats.lineCount} lines mastered`
    : `${song.artist}${sample}`;
  return `
    <a class="row" href="#/song/${encodeURIComponent(song.id)}" data-testid="song-card">
      <span class="tile tile-song accent-${shellAccent()}" aria-hidden="true">${escapeHtml(initial(song.title))}</span>
      <span class="row-main">
        <strong>${escapeHtml(song.title)}</strong>
        <span class="sub" data-testid="mastery">${escapeHtml(detail)}</span>
      </span>
    </a>
  `;
}

function initial(value) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 1).toUpperCase() : "?";
}

function viewForm() {
  if (session.route.name === "add") return viewPaste();
  const form = session.form;
  const parsed = analyzePaste(form.raw || "", { detectTitle: false });
  return `
    <section class="screen">
      <a class="back" href="#/song/${encodeURIComponent(form.songId)}">${icon("back")} Back</a>
      <header class="page-head">
        <h1>Edit song</h1>
      </header>
      <div class="stack">
        <label class="field">Lyrics
          <textarea id="lyrics" data-testid="lyrics" spellcheck="false" placeholder="Paste lyrics here.">${escapeHtml(form.raw || "")}</textarea>
        </label>
        <div id="paste-status">${pasteStatusHtml(parsed)}</div>
        <label class="field">Title
          <input id="title" data-testid="title" type="text" maxlength="120" autocomplete="off" value="${escapeHtml(form.title || "")}">
        </label>
        <label class="field">Artist
          <input id="artist" data-testid="artist" type="text" maxlength="120" autocomplete="off" value="${escapeHtml(form.artist || "")}">
        </label>
        <p id="form-error" class="error" role="alert">${escapeHtml(form.error || "")}</p>
        <button class="btn btn-primary" type="button" data-action="save-song" data-testid="save-song">Save song</button>
        <button class="btn btn-text btn-danger" type="button" data-action="ask-delete" data-id="${escapeHtml(form.songId)}">Delete song</button>
        <p class="fine">Lyrics you paste never leave this browser.</p>
      </div>
    </section>
  `;
}

function viewPaste() {
  const form = session.form;
  if (!form) return "";
  const known = Boolean(form.lockMeta && form.title && form.artist);
  const back = form.fromConcert ? `#/concert/${encodeURIComponent(form.fromConcert)}` : "#/";
  const find = searchLyricsUrl(form.title, form.artist);
  const preview = form.preview;
  const previewLines = preview ? preview.lines.slice(0, 3).map((line) => `<span>${escapeHtml(line)}</span>`).join("") : "";
  const metaFields = !known && (form.needMeta || (preview && !preview.detected)) ? `
    <label class="field">Title
      <input id="title" data-testid="title" type="text" maxlength="120" autocomplete="off" value="${escapeHtml(form.title || "")}">
    </label>
    <label class="field">Artist
      <input id="artist" data-testid="artist" type="text" maxlength="120" autocomplete="off" value="${escapeHtml(form.artist || "")}">
    </label>` : "";
  const body = preview ? `
    <p class="sub" data-testid="lyric-preview">${preview.lines.length} lines</p>
    <div class="preview">${previewLines}</div>
    ${metaFields}
    <button class="btn btn-primary" type="button" data-action="confirm-paste" data-testid="looks-right">Looks right</button>
    <button class="btn btn-text" type="button" data-action="retry-paste" data-testid="try-again">Try again</button>
  ` : `
    ${known ? `<a class="btn btn-secondary" id="find-lyrics" data-testid="find-lyrics" href="${escapeHtml(find)}" target="_blank" rel="noopener noreferrer">Find lyrics</a>` : ""}
    <button class="btn btn-primary" type="button" data-action="paste-clipboard" data-testid="paste-clipboard">Paste</button>
    ${form.fallback ? `
      <label class="field">Lyrics
        <textarea id="lyrics" data-testid="lyrics" spellcheck="false" placeholder="Paste lyrics here.">${escapeHtml(form.raw || "")}</textarea>
      </label>
      <p class="fine" data-testid="paste-hint">Press Cmd+V (or long-press, Paste)</p>
      <button class="btn btn-text" type="button" data-action="use-fallback" data-testid="use-fallback" ${form.manual ? "" : "hidden"}>Use this paste</button>
    ` : ""}
    <p class="fine">Lyrics you paste never leave this browser.</p>
  `;
  return `
    <section class="screen" data-testid="paste-sheet">
      <a class="back" href="${back}">${icon("back")} Back</a>
      <header class="page-head">
        <h1>${escapeHtml(known ? form.title : "Add a song")}</h1>
        ${known ? `<p class="sub">${escapeHtml(form.artist)}</p>` : ""}
      </header>
      <div class="stack">
        ${body}
        <p id="form-error" class="error" role="alert">${escapeHtml(form.error || "")}</p>
        ${form.fallback && form.debug ? `<p class="fine" data-testid="paste-debug">${escapeHtml(form.debug)}</p>` : ""}
      </div>
    </section>
  `;
}

function pasteStatusHtml(parsed) {
  if (!session.form?.raw?.trim()) {
    return `<p class="hint">Paste the words, then save. A first line like <strong>Title - Artist</strong> fills the name in.</p>`;
  }
  const junk = parsed.removedJunk ? ` · removed ${parsed.removedJunk} junk ${parsed.removedJunk === 1 ? "line" : "lines"}` : "";
  const preview = parsed.lines.slice(0, 2).map((line) => `<span>${escapeHtml(line)}</span>`).join("");
  return `<p class="hint">${parsed.lines.length} ${parsed.lines.length === 1 ? "line" : "lines"} ready${junk}</p>${preview ? `<div class="preview">${preview}</div>` : ""}`;
}

function detectChipHtml(parsed) {
  if (!parsed.detected || titleFieldsVisible(parsed)) return "";
  return `
    <div class="chip-row">
      <span>Using <strong>${escapeHtml(parsed.title)}</strong> · ${escapeHtml(parsed.artist)}</span>
      <button type="button" data-action="edit-title">Edit</button>
      <button type="button" data-action="reject-title">Keep this line</button>
    </div>
  `;
}

function titleFieldsVisible(parsed) {
  const form = session.form;
  if (!form) return true;
  if (form.lockMeta || form.forceFields || form.rejectDetection) return true;
  if (!form.raw?.trim()) return false;
  if (parsed?.detected && !form.titleTouched) return false;
  return true;
}

function viewSong() {
  const song = findSong(session.route.songId);
  if (!song) return missing("That song is not on this device.", "#/");
  const progress = progressOf(session.state);
  const stats = songStats(progress, song);
  const availability = gameAvailability(song.lines, song.sections || []);
  const plan = chapterPlan(song.lines, song.sections || [], stats.chapters || {});
  const playable = plan.filter((chapter) => chapter.status !== "unavailable");
  const doneCount = playable.filter((chapter) => chapter.status === "done").length;
  const reasons = {
    fill: "Needs a line with a word to hide",
    order: "Needs a line with at least 3 words",
    letters: "Needs a line to hint"
  };
  const chapters = plan.map((chapter, index) => {
    const testid = `data-testid="game-${chapter.id}"`;
    if (chapter.status === "unavailable") {
      return `<button class="game" type="button" disabled ${testid}><span>${index + 1} ${escapeHtml(chapter.name)}<small>Not enough lines</small></span></button>`;
    }
    if (chapter.status === "locked") {
      return `<button class="game is-locked" type="button" disabled ${testid}><span class="game-name">${index + 1} ${escapeHtml(chapter.name)}</span><span class="lock-mark">${icon("lock")} Locked</span></button>`;
    }
    const mark = chapter.status === "done" ? "Done" : "Open";
    return `
      <a class="game${chapter.id === "concert" ? " is-final" : ""}" ${testid} href="#/play/${encodeURIComponent(song.id)}/${chapter.id}">
        <span>${index + 1} ${escapeHtml(chapter.name)}<small>${escapeHtml(chapter.detail)} · ${mark}</small></span>
      </a>`;
  }).join("");
  const warm = GAMES.filter((game) => game.group === "warm").map((game) => {
    if (!availability[game.id]) {
      return `<button class="game" type="button" disabled><span>${escapeHtml(game.name)}<small>${reasons[game.id]}</small></span></button>`;
    }
    return `
      <a class="game" data-testid="game-${game.id}" href="#/play/${encodeURIComponent(song.id)}/${game.id}">
        <span>${escapeHtml(game.name)}<small>${escapeHtml(game.detail)}</small></span>
      </a>`;
  }).join("");
  const concerts = concertsForSong(session.concerts, song.title, song.artist);
  const concert = concerts[0];
  const links = concerts.map((item) => `<a class="text-link" href="#/concert/${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a>`).join("");
  const progressLine = stats.songMastered
    ? "Song mastered"
    : `${doneCount} of ${playable.length} chapters`;
  return `
    <section class="screen">
      <header class="hero hero-song" style="${accentStyle(concert)}">
        <a class="back back-on-hero" href="${concert ? `#/concert/${encodeURIComponent(concert.id)}` : "#/"}">${icon("back")} ${concert ? "Concert" : "Songs"}</a>
        <h1>${escapeHtml(song.title)}</h1>
        <p class="hero-stat">${escapeHtml(song.artist)}${song.sample ? " · Sample" : ""}</p>
      </header>
      <div class="meter-block">
        <p class="sub" data-testid="chapter-progress">${progressLine}</p>
        <p class="sub" data-testid="song-mastery">${stats.linesMastered} of ${stats.lineCount} lines mastered</p>
        ${meter(stats.masteryPercent)}
      </div>
      ${links ? `<p class="sub">On the setlist: ${links}</p>` : ""}
      <p class="kicker">Chapters</p>
      <div class="game-list">${chapters}</div>
      ${plan.some((chapter) => chapter.status === "locked") ? `<p class="chapter-note" data-testid="chapter-lock-note">Finish the previous chapter</p>` : ""}
      <p class="kicker">Tricky lines</p>
      <div class="game-list">${warm}</div>
      <div class="dock">
        <a class="btn btn-text" href="#/edit/${encodeURIComponent(song.id)}">Edit lyrics</a>
        <button class="btn btn-text btn-danger" type="button" data-action="ask-delete" data-id="${escapeHtml(song.id)}">Delete song</button>
      </div>
    </section>
  `;
}

function viewPlay() {
  const play = session.play;
  if (!play) return `<section class="screen"><p>That lesson is over.</p></section>`;
  ensureStudy();
  const question = play.questions[play.index];
  const meterNow = lessonMeter(play, question);
  const showHearts = play.gameId !== "fade" && play.gameId !== "think";
  const hearts = showHearts ? Array.from({ length: play.maxHearts }, (_, index) => `
    <span class="heart ${index < play.hearts ? "" : "is-empty"}">${icon("heart")}</span>
  `).join("") : "";
  const seconds = questionSeconds(question);
  const timer = play.gameId === "concert" && !play.feedback ? `
    <div class="timer" data-testid="timer">
      <div class="timer-track"><span id="timer-bar"></span></div>
      <span class="timer-label" id="timer-label">${formatSeconds(seconds)}</span>
    </div>
  ` : "";
  const around = contextHtml(question);
  const parts = play.feedback ? { tray: "", chips: "" } : answerParts(question);
  const action = play.feedback ? continueControl(play) : studyOrCheck(question);
  const dock = `${play.feedback ? feedbackBody(play) : parts.chips}${action}`;
  return `
    <section class="screen play-screen" data-testid="play">
      <div class="play-scroll">
        <div class="play-top">
          <button class="icon-btn" type="button" data-action="leave" data-testid="leave-lesson" aria-label="Close lesson">${icon("close")}</button>
          <p class="play-crumb" data-testid="play-crumb">${escapeHtml(playCrumb(play, question))}</p>
          <div class="play-meta">
            <span class="score-pill" data-testid="score-pill" aria-label="Score ${formatScore(play.score)}">${formatScore(play.score)}</span>
            ${showHearts ? `<div class="hearts" data-testid="hearts" aria-label="${play.hearts} of ${play.maxHearts} lives">${hearts}</div>` : ""}
          </div>
        </div>
        <div class="lesson-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${meterNow.now}" aria-label="Lesson progress" data-testid="lesson-progress">
          <span style="width:${meterNow.width}%"></span>
        </div>
        ${timer}
        <div class="play-body">
          ${around.before}
          ${questionHtml(question)}
          ${around.after}
          ${parts.tray}
        </div>
      </div>
      ${dock ? `<div class="answer-dock" data-testid="answer-dock">${dock}</div>` : ""}
    </section>
  `;
}

function lessonMeter(play, question) {
  const total = Math.max(play.questions.length, 1);
  let done = play.feedback ? play.index + 1 : play.index;
  if (!play.feedback && question?.kind === "fade") done += fadeLessonFraction(question, play.study || {});
  const width = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  return { width, now: width };
}

function formatSeconds(seconds) {
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

function playCrumb(play, question) {
  const context = question?.context || {};
  let position = context.position || 0;
  if (question?.kind === "fade" && play?.study?.kind === "fade") {
    const step = question.steps?.[play.study.line];
    if (step) position = step.id + 1;
  }
  if (question?.kind === "think" && play?.study?.queue?.[0]) position = play.study.queue[0].id + 1;
  const study = question?.kind === "fade" || question?.kind === "think";
  let place = "";
  if (context.section && position) place = `${context.section}, line ${position}`;
  else if (!study && context.rangeLabel) place = context.rangeLabel;
  else if (position) place = `line ${position}`;
  return place ? `${play.gameName} · ${place}` : play.gameName;
}

function qLabel(text, testid = "") {
  const attr = testid ? ` data-testid="${testid}"` : "";
  return `<p class="q-label"${attr}>${escapeHtml(text)}</p>`;
}

function lyricBlock(text, testid = "", extra = "") {
  const attr = testid ? ` data-testid="${testid}"` : "";
  const cls = extra ? ` ${extra}` : "";
  return `<div class="lyric-block${cls}"><p class="lyric-line"${attr}>${escapeHtml(text)}</p></div>`;
}

function contextHtml(question) {
  const context = question?.context;
  if (!context || question?.kind === "fade" || question?.kind === "think") return { before: "", after: "" };
  const showPrevious = context.previous && question.kind !== "next" && !question.hidesPrevious && !question.sing;
  let previous = showPrevious ? `${qLabel("Previous line")}${lyricBlock(context.previous, "context-previous")}` : "";
  if (question.sing && question.prompt) {
    previous = `${qLabel("Previous line")}${lyricBlock(question.prompt, "context-previous")}`;
  }
  const allowNext = session.play?.gameId === "lines" && question.kind === "lines";
  const next = allowNext && context.next ? lyricBlock(context.next, "context-next") : "";
  return { before: previous, after: next };
}

function voiceReady() {
  return speechRecognitionSupported() && !session.play?.voiceOff;
}

function questionHtml(question) {
  if (question.kind === "fade" || question.kind === "think") return studyHtml(question);
  if (question.sing) {
    const ask = voiceReady() ? "Sing or type the next line" : "Type the next line";
    return qLabel(ask, "question");
  }
  if (question.kind === "order") return orderTargetHtml(question);
  if (question.kind === "fill") {
    const picked = session.play.picked;
    const before = question.before ? `${escapeHtml(question.before)} ` : "";
    const after = question.after ? ` ${escapeHtml(question.after)}` : "";
    const blank = picked ? escapeHtml(picked) : "";
    return `${qLabel("Fill the blank")}<p class="target-line" data-testid="question">${before}<span class="target-blank ${picked ? "filled" : ""}">${blank}</span>${after}</p>`;
  }
  if (question.kind === "next") {
    return `<div class="lyric-block"><p class="lyric-line target-line" data-testid="question">${escapeHtml(question.prompt)}</p></div>${qLabel("What comes next?")}`;
  }
  if (question.kind === "previous") {
    return `<div class="lyric-block"><p class="lyric-line target-line" data-testid="question">${escapeHtml(question.prompt)}</p></div>${qLabel("What comes before?")}`;
  }
  if (question.kind === "letters") {
    return `<p class="hint-line" data-testid="question">${escapeHtml(question.hint)}</p>${qLabel("Pick the line")}`;
  }
  if (question.kind === "truth") {
    return `<div class="lyric-block"><p class="lyric-line target-line" data-testid="question">${escapeHtml(question.prompt)}</p></div>${qLabel("Does this line come right after?")}<div class="lyric-block"><p class="lyric-line target-line">${escapeHtml(question.claim)}</p></div>`;
  }
  if (question.kind === "which") {
    return `<div class="lyric-block"><p class="lyric-line target-line" data-testid="question">${escapeHtml(question.prompt)}</p></div>${qLabel("Which section is this?")}`;
  }
  if (question.kind === "intruder") return qLabel("Which line does not belong?", "question");
  if (question.kind === "lines") return qLabel("Tap the lines in order", "question");
  return qLabel("Tap the words in order", "question");
}

function studyHtml(question) {
  const frame = studyFrame(question, ensureStudy() || {});
  if (!frame) return qLabel("Read this line", "question");
  const previous = frame.previous
    ? `${qLabel("Previous line")}${lyricBlock(frame.previous, "context-previous", "is-context")}`
    : "";
  if (frame.kind === "think") {
    const target = frame.target ? lyricBlock(frame.target, "think-line") : "";
    const place = frame.place ? `<p class="hint" data-testid="think-place">${escapeHtml(frame.place)}</p>` : "";
    return `${previous}${qLabel(frame.prompt, "question")}${place}${target}`;
  }
  const words = frame.words.map((word) => (
    word
      ? `<span class="target-word">${escapeHtml(word)}</span>`
      : `<span class="target-blank" data-testid="fade-blank"></span>`
  )).join(" ");
  const place = `${fadePassLabel(frame.pass)} · line ${frame.line + 1} of ${frame.lineCount}`;
  return `${previous}${qLabel(frame.prompt, "question")}<div class="lyric-block"><p class="target-line" data-testid="fade-line">${words}</p></div><p class="hint" data-testid="fade-pass">${escapeHtml(place)}</p>`;
}

function orderTargetHtml(question) {
  const order = session.play?.order;
  const arranged = order && order.index === session.play.index ? order.arranged : [];
  const byId = new Map(question.tokens.map((token) => [token.id, token.text]));
  const words = question.tokens.map((token, index) => {
    const placed = byId.get(arranged[index] || "");
    if (!placed) return `<span class="target-blank"></span>`;
    return `<span class="target-word">${escapeHtml(placed)}</span>`;
  }).join(" ");
  return `${qLabel("Put the words in order")}<div class="lyric-block"><p class="target-line" data-testid="question">${words}</p></div><p class="play-status" data-testid="order-status" role="status"></p>`;
}

function keyHint(index) {
  if (index > 8) return "";
  return `<span class="key-hint">${index + 1}</span>`;
}

function singAnswerParts() {
  const play = session.play;
  const voice = voiceReady();
  const listening = Boolean(play?.listening) && voice;
  const transcript = escapeHtml(listening ? (play?.voiceDisplay || "") : "");
  const fieldValue = escapeHtml(listening ? "" : (play?.typed || ""));
  const wrong = Boolean(play?.miss);
  const mic = voice ? `
    <button class="mic-btn${listening ? " is-listening" : ""}" type="button" data-action="toggle-mic" data-testid="mic" aria-pressed="${listening ? "true" : "false"}" aria-label="${listening ? "Stop listening" : "Sing or speak"}">${icon("mic")}</button>` : "";
  const choices = voice ? `<button class="btn btn-ghost" type="button" data-action="cant-sing" data-testid="cant-sing">Show choices</button>` : "";
  const heard = wrong && play.miss.heard
    ? `<span class="heard-note" data-testid="heard-note">Heard: ${escapeHtml(play.miss.heard)}</span>` : "";
  const missBody = [wrong ? escapeHtml(play.miss.message) : "", heard].filter(Boolean).join(" ");
  const listenSlot = voice ? `
        <div class="listen-slot" data-testid="listen-slot">
          <p class="sing-status" data-testid="listen-status" ${listening ? "" : "hidden"}>Listening</p>
          <p class="live-transcript" data-testid="live-transcript" ${listening && play?.voiceDisplay ? "" : "hidden"}>${transcript}</p>
        </div>` : "";
  const reveal = (play?.questionMistakes || 0) >= 2
    ? `<button class="btn btn-ghost" type="button" data-action="show-answer" data-testid="show-answer">Show answer</button>` : "";
  return {
    tray: "",
    chips: `
      <form id="answer-form" class="sing-form" data-testid="sing-form">
        ${listenSlot}
        <p class="sing-miss" data-testid="sing-miss" role="status">${missBody}</p>
        <div class="sing-field${wrong ? " is-wrong" : ""}" id="sing-field" data-testid="sing-field">
          <div class="sing-row">
            <input class="sing-input" id="answer-input" data-testid="sing-input" type="text" enterkeyhint="done" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Next line" value="${fieldValue}">
            ${mic}
          </div>
        </div>
        ${choices}
        ${reveal}
        <button class="btn btn-primary" type="submit" data-action="check" data-primary data-testid="check">Check <span class="key-hint">Enter</span></button>
      </form>`
  };
}

function answerParts(question) {
  if (question.kind === "fade" || question.kind === "think") return { tray: "", chips: "" };
  if (question.sing) return singAnswerParts();
  if (question.choices && question.kind !== "order") {
    return {
      tray: "",
      chips: `<div class="choices">${question.choices.map((choice, index) => `
        <button class="choice" type="button" data-action="choose" data-option="${index}" data-choice="${index}">${keyHint(index)}${escapeHtml(choice)}</button>
      `).join("")}</div>`
    };
  }
  if (question.kind === "order" || question.kind === "lines") {
    const order = ensureOrder();
    const stacked = question.kind === "order" ? "" : " is-stacked";
    const byId = new Map(question.tokens.map((token) => [token.id, token]));
    const placed = order.arranged.map((id) => {
      const token = byId.get(id);
      return `<span class="token is-set${order.justPlaced === id ? " is-placed" : ""}">${escapeHtml(token?.text || "")}</span>`;
    }).join("");
    const pool = order.pool.map((id, index) => `
      <button class="token" type="button" data-action="pick-token" data-option="${index}" data-token="${escapeHtml(id)}">${keyHint(index)}${escapeHtml(byId.get(id)?.text || "")}</button>
    `).join("");
    const tray = question.kind === "lines" && placed
      ? `<div class="built-lines" data-testid="built-lines">${placed}</div>`
      : "";
    return {
      tray,
      chips: `<div class="pool${stacked}">${pool}</div>`
    };
  }
  return { tray: "", chips: "" };
}

function studyOrCheck(question) {
  if (question?.kind === "fade" || question?.kind === "think") return studyControl(question);
  if (question?.kind === "order") return checkControl();
  return "";
}

function studyControl(question) {
  const frame = studyFrame(question, ensureStudy() || {});
  if (!frame) return "";
  if (question.kind === "fade" || frame.phase === "think") {
    const action = question.kind === "fade" ? "fade-advance" : "think-show";
    const testid = question.kind === "fade" ? "fade-advance" : "think-show";
    return `<div class="dock"><button class="btn btn-primary" type="button" data-action="${action}" data-primary data-option="0" data-testid="${testid}">${escapeHtml(frame.action)} <span class="key-hint">Enter</span></button></div>`;
  }
  return `<div class="dock">
    <button class="btn btn-primary" type="button" data-action="think-rate" data-rate="got" data-primary data-option="0" data-testid="think-got">Got it <span class="key-hint">1</span></button>
    <button class="btn btn-secondary" type="button" data-action="think-rate" data-rate="missed" data-option="1" data-testid="think-missed">Missed it <span class="key-hint">2</span></button>
  </div>`;
}

function checkControl() {
  return `<div class="dock"><button class="btn btn-primary" type="button" data-action="check" data-primary data-testid="check">Check <span class="key-hint">Enter</span></button></div>`;
}

function continueControl(play) {
  const nextLabel = play.hearts <= 0 || play.index >= play.questions.length - 1 ? "See results" : "Continue";
  return `<div class="dock"><button class="btn btn-primary" type="button" data-action="continue" data-primary data-testid="continue">${nextLabel} <span class="key-hint">Enter</span></button></div>`;
}

function feedbackBody(play) {
  const feedback = play.feedback;
  const praise = feedback.correct ? "Correct" : (feedback.timeout ? "Time is up" : "Not quite");
  const xp = feedback.xp ? ` +${feedback.xp} XP` : "";
  return `
    <div class="feedback ${feedback.correct ? "is-good" : "is-bad"}" role="status" data-testid="feedback">
      <p><strong>${praise}${xp}</strong></p>
      <p class="answer">${escapeHtml(feedback.answer)}</p>
    </div>
  `;
}

function viewResults() {
  const results = session.results;
  if (!results) return "";
  const song = findSong(results.songId);
  const progress = progressOf(session.state);
  const stats = song ? songStats(progress, song) : null;
  const sections = song ? sectionProgress(song.lines, song.sections || [], stats?.rounds || {}) : [];
  const open = results.showSections ? `
    <div class="section-list" data-testid="section-list">
      ${sections.map((section) => `
        <button class="choice" type="button" data-action="practice-chunk" data-start="${section.start}" data-round="${escapeHtml(section.roundId)}">
          <span>${escapeHtml(section.opener)}</span>
          <span class="sub">${section.mastered}/${section.total}${section.done ? " · done" : ""}</span>
        </button>
        ${section.done ? `<button class="btn btn-text" type="button" data-action="practice-again" data-round="${escapeHtml(section.roundId)}">Practice again</button>` : ""}
      `).join("")}
    </div>` : "";
  const finalLocked = song ? chapterPlan(song.lines, song.sections || [], stats?.chapters || {}).find((item) => item.id === "concert")?.status === "locked" : false;
  const bits = [];
  if (results.xp > 0) bits.push(`${results.xp} XP`);
  if (results.accuracy > 0) bits.push(`${results.accuracy}% accuracy`);
  if (results.streak > 0) bits.push(`<span data-testid="result-streak">${results.streak}</span> day streak`);
  return `
    <section class="screen">
      <header class="page-head">
        <p class="kicker">${results.songMastered ? "Song mastered" : (results.newBest ? "New best" : "Round complete")}</p>
        <h1 data-testid="final-score">${formatScore(results.score)}</h1>
        <p class="sub">${escapeHtml(results.title)} · ${escapeHtml(results.artist)}</p>
      </header>
      <p class="sub" data-testid="hearts-left">${results.hearts} hearts left</p>
      ${bits.length ? `<p class="sub">${bits.join(" · ")}</p>` : ""}
      <div class="dock">
        <button class="btn btn-primary" type="button" data-action="keep-practicing" data-primary data-testid="keep-practicing">Keep practicing <span class="key-hint">Enter</span></button>
        <button class="btn btn-secondary" type="button" data-action="toggle-sections" data-testid="practice-section">Practice a section</button>
        ${open}
        ${finalLocked
          ? `<button class="btn btn-secondary" type="button" disabled data-testid="final-run">Final run</button>`
          : `<a class="btn btn-secondary" data-testid="final-run" href="#/play/${encodeURIComponent(results.songId)}/concert">Final run</a>`}
        <button class="btn btn-text" type="button" data-action="share-results" data-testid="share-score">Share my score</button>
        <a class="btn btn-text" href="#/song/${encodeURIComponent(results.songId)}">Back to song</a>
        ${nextLyricsLink(results.title, results.artist, "")}
      </div>
    </section>
  `;
}

function viewConcerts() {
  if (session.concertsError && !session.concerts.length) {
    return `<section class="screen"><h1>Concerts</h1><p class="empty">${escapeHtml(session.concertsError)}</p></section>`;
  }
  const cards = session.concerts.map((concert) => {
    const summary = activeConcertSummary(concert, session.state.songs, progressOf(session.state));
    const detail = summary.mastered > 0
      ? `${summary.mastered} of ${summary.total} songs mastered`
      : (concert.label || "Paste lyrics when a song needs them");
    return `
      <a class="row" href="#/concert/${encodeURIComponent(concert.id)}" data-testid="concert-card">
        <span class="tile tile-concert accent-${accentForId(concert.id)}" aria-hidden="true">${escapeHtml(initial(concert.name))}</span>
        <span class="row-main">
          <strong>${escapeHtml(concert.name)}</strong>
          <span class="sub">${escapeHtml(detail)}</span>
        </span>
      </a>
    `;
  }).join("");
  return `
    <section class="screen">
      <header class="page-head">
        <h1>Concerts</h1>
      </header>
      <p class="sub">A concert is a folder of song titles. Paste lyrics here when a slot needs them.</p>
      <div class="rows">${cards || '<p class="empty">No concerts yet.</p>'}</div>
    </section>
  `;
}

async function viewConcert() {
  const concert = session.concerts.find((item) => item.id === session.route.concertId);
  if (!concert) return missing("That concert is not in concerts.json.", "#/concerts");
  const progress = progressOf(session.state);
  const summary = activeConcertSummary(concert, session.state.songs, progress);
  const provider = providerFor();
  const [scores, participants] = await Promise.all([
    provider.songScores({ concert }),
    provider.participantCount({ concert })
  ]);
  const board = leaderboardFromSongScores(scores, concert.setlist);
  const playerNoun = participants === 1 ? "player" : "players";
  const where = provider.source === "device" ? "on this device" : "on the shared board";
  const masteredLine = concertStatusLine(summary);
  const setlist = summary.total ? summary.slots.map((slot) => setlistRow(concert, slot)).join("") : `
    <p class="empty">Add title and artist pairs to concerts.json. Leave lyrics out of that file.</p>
  `;
  const rows = board.length ? board.map((row, index) => `
    <article class="set-row">
      <span class="set-num">${index + 1}</span>
      <div class="row-main"><strong>${escapeHtml(row.playerName)}</strong><span class="sub">${row.played} of ${row.total} scored</span></div>
      <span class="sub">${formatScore(row.score)}</span>
    </article>
  `).join("") : `<p class="empty">No scores on this concert yet.</p>`;
  const people = participants > 0 ? `<p class="sub" data-testid="participants">${participants} ${playerNoun} ${where}</p>` : "";
  return `
    <section class="screen" data-testid="concert-page">
      <header class="hero" style="${accentStyle(concert)}">
        <a class="back back-on-hero" href="#/concerts">${icon("back")} Concerts</a>
        <p class="kicker">Concert</p>
        <h1>${escapeHtml(concert.name)}</h1>
        ${concert.label ? `<p class="hero-stat" data-testid="concert-label">${escapeHtml(concert.label)}</p>` : ""}
        <p class="hero-stat" data-testid="concert-mastered">${escapeHtml(masteredLine)}</p>
        ${summary.total ? meter(summary.total ? Math.round((summary.mastered / summary.total) * 100) : 0) : ""}
      </header>
      ${concert.source ? `<p class="sub"><a class="text-link" data-testid="concert-source" href="${escapeHtml(concert.source)}" target="_blank" rel="noopener noreferrer">Source setlist</a></p>` : ""}
      ${summary.score > 0 ? `<p class="sub" data-testid="concert-score">Your score ${formatScore(summary.score)}</p>` : ""}
      ${people}
      ${nextLyricsLink("", "", concert.id)}
      <p class="kicker">Setlist</p>
      <div data-testid="setlist">${setlist}</div>
      <p class="kicker">Leaderboard</p>
      <p class="footnote" data-testid="leaderboard-source">${escapeHtml(provider.sourceLabel)}. A shared board can plug in later with name, concert, title, artist, and score.</p>
      <div data-testid="concert-board">${rows}</div>
      ${summary.score > 0 ? `<div class="dock"><button class="btn btn-primary" type="button" data-action="share-concert" data-id="${escapeHtml(concert.id)}">Share concert score</button></div>` : ""}
    </section>
  `;
}

function setlistRow(concert, slot) {
  const href = slot.status === "needs-lyrics"
    ? `#/add?title=${encodeURIComponent(slot.title)}&artist=${encodeURIComponent(slot.artist)}&concert=${encodeURIComponent(concert.id)}`
    : `#/song/${encodeURIComponent(slot.songId)}`;
  const status = slot.status === "needs-lyrics"
    ? `<span class="pill-need" data-testid="needs-lyrics">Needs lyrics</span>`
    : `<span class="sub">${slot.linesMastered > 0 ? `${slot.linesMastered}/${slot.lineCount}` : "Ready"}</span>`;
  return `
    <a class="set-row" data-testid="setlist-slot" href="${href}">
      <span class="set-num">${slot.index + 1}</span>
      <span class="row-main"><strong>${escapeHtml(slot.title)}</strong></span>
      ${status}
    </a>
  `;
}

async function viewBoard() {
  const provider = providerFor();
  const runs = await provider.listRuns();
  const filters = [{ id: "", name: "All" }, ...session.concerts.map((concert) => ({ id: concert.id, name: concert.name }))];
  const selected = session.boardFilter;
  const concert = session.concerts.find((item) => item.id === selected);
  const visible = runs.filter((run) => {
    if (!concert) return true;
    return concert.setlist.some((slot) => songsMatch(slot.title, slot.artist, run.songTitle, run.songArtist));
  }).sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  const rows = visible.length ? visible.map((run, index) => `
    <article class="set-row" data-testid="board-row">
      <span class="set-num">${index + 1}</span>
      <div class="row-main">
        <strong>${escapeHtml(run.playerName)}</strong>
        <span class="sub">${escapeHtml(run.songTitle)} · ${escapeHtml(gameName(run.gameId))}</span>
      </div>
      <span class="sub">${formatScore(run.score)}</span>
    </article>
  `).join("") : `<p class="empty">Finish a lesson to post a score on this device.</p>`;
  return `
    <section class="screen">
      <header class="page-head">
        <p class="kicker">${escapeHtml(provider.sourceLabel)}</p>
        <h1>Leaderboard</h1>
      </header>
      <div class="filters">${filters.map((filter) => `
        <button type="button" data-action="filter-board" data-concert="${escapeHtml(filter.id)}" aria-pressed="${filter.id === selected ? "true" : "false"}">${escapeHtml(filter.name)}</button>
      `).join("")}</div>
      <div data-testid="board">${rows}</div>
    </section>
  `;
}

function viewMe() {
  const state = session.state;
  const player = activePlayer(state);
  const progress = progressOf(state);
  const practiced = Object.values(progress.songs || {}).filter((row) => (row.plays || 0) > 0 || (row.bestScore || 0) > 0).length;
  const players = state.players.map((item) => {
    const active = item.id === player.id;
    if (session.renaming === item.id) {
      return `
        <article class="player is-active">
          <form id="rename-form" class="stack">
            <label class="field">Name
              <input id="rename-input" type="text" maxlength="40" value="${escapeHtml(item.name)}">
            </label>
            <button class="btn btn-primary" type="submit">Save name</button>
          </form>
        </article>
      `;
    }
    return `
      <article class="player${active ? " is-active" : ""}">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <span class="sub">${(state.progress[item.id]?.totalXp || 0) > 0 ? `${formatScore(state.progress[item.id].totalXp)} XP` : "No score yet"}</span>
        </div>
        <div class="row-actions">
          ${active ? "" : `<button class="btn btn-text btn-small" type="button" data-action="switch-player" data-id="${escapeHtml(item.id)}">Play as</button>`}
          <button class="btn btn-text btn-small" type="button" data-action="start-rename" data-id="${escapeHtml(item.id)}">Rename</button>
          <button class="btn btn-text btn-small" type="button" data-action="ask-delete-player" data-id="${escapeHtml(item.id)}">Remove</button>
        </div>
      </article>
    `;
  }).join("");
  const facts = [];
  if ((progress.totalXp || 0) > 0) facts.push(`${formatScore(progress.totalXp)} XP`);
  if ((progress.streak?.count || 0) > 0) facts.push(`${progress.streak.count} day streak`);
  if (practiced > 0) facts.push(`${practiced} songs scored`);
  return `
    <section class="screen">
      <header class="page-head">
        <h1>${escapeHtml(player.name)}</h1>
      </header>
      <p class="sub">${facts.length ? facts.join(" · ") : "Finish a lesson to start a score."}</p>
      <p class="fine">Songs are shared on this device. Scores, streaks, and XP belong to the active player.</p>
      <p class="kicker">Players</p>
      <form id="player-form" class="stack">
        <label class="field">New player
          <input id="player-name" data-testid="player-name" type="text" maxlength="40" placeholder="Name" autocomplete="off">
        </label>
        <button class="btn btn-primary" type="submit">Add player</button>
      </form>
      <div>${players}</div>
      <p class="kicker">Progress file</p>
      <p class="sub">Export is scores, mastery counts, and streaks only. It does not include lyrics.</p>
      <div class="stack">
        <button class="btn btn-primary" type="button" data-action="export-progress" data-testid="export-progress">Export progress</button>
        <button class="btn btn-text" type="button" data-action="pick-import" data-testid="import-progress">Import progress</button>
        <input id="import-file" type="file" accept="application/json,.json" hidden>
        <button class="btn btn-text" type="button" data-action="toggle-sound">${state.settings.sound ? "Sound on" : "Sound off"}</button>
        <button class="btn btn-text" type="button" data-action="restore-sample">Restore sample song</button>
        <button class="btn btn-text btn-danger" type="button" data-action="ask-erase">Erase everything on this device</button>
      </div>
    </section>
  `;
}

function missing(message, href) {
  return `<section class="screen"><h1>${escapeHtml(message)}</h1><a class="btn btn-primary" href="${href}">Go back</a></section>`;
}

function ensureForm() {
  const route = session.route;
  const key = route.name === "edit"
    ? `edit:${route.songId}`
    : `add:${route.params.title || ""}:${route.params.artist || ""}:${route.params.concert || ""}`;
  if (session.form?.key === key) return;
  if (route.name === "edit") {
    const song = findSong(route.songId);
    if (!song) {
      session.form = null;
      return;
    }
    session.form = {
      key,
      lockMeta: true,
      forceFields: true,
      rejectDetection: false,
      titleTouched: true,
      songId: song.id,
      title: song.title,
      artist: song.artist,
      raw: draftLyrics(song.lines, song.sections),
      fromConcert: "",
      preview: null,
      fallback: false,
      needMeta: false
    };
    return;
  }
  const fromSetlist = Boolean(route.params.title && route.params.artist);
  session.form = {
    key,
    lockMeta: fromSetlist,
    forceFields: fromSetlist,
    rejectDetection: false,
    titleTouched: fromSetlist,
    songId: null,
    title: route.params.title || "",
    artist: route.params.artist || "",
    raw: "",
    fromConcert: route.params.concert || "",
    preview: null,
    fallback: false,
    needMeta: false
  };
}

function onLyricsInput(event) {
  const lyrics = document.getElementById("lyrics");
  if (!lyrics || !session.form) return;
  if (session.route.name === "add" && session.form.fallback && !session.form.preview) {
    session.form.raw = lyrics.value;
    const button = document.querySelector("[data-testid=use-fallback]");
    if (event?.inputType === "insertFromPaste" || !lyrics.value.trim()) {
      session.form.manual = false;
      if (button) button.hidden = true;
      return;
    }
    session.form.manual = true;
    if (button) button.hidden = false;
    return;
  }
  session.form.raw = lyrics.value;
  const parsed = analyzePaste(lyrics.value, { detectTitle: !(session.form.lockMeta || session.form.rejectDetection) });
  if (parsed.detected && !session.form.titleTouched && !session.form.forceFields && !session.form.lockMeta) {
    session.form.title = parsed.title;
    session.form.artist = parsed.artist;
    const title = document.getElementById("title");
    const artist = document.getElementById("artist");
    if (title) title.value = parsed.title;
    if (artist) artist.value = parsed.artist;
  }
  const status = document.getElementById("paste-status");
  const chip = document.getElementById("detect-chip");
  const fields = document.getElementById("title-fields");
  if (status) status.innerHTML = pasteStatusHtml(parsed);
  if (chip) chip.innerHTML = detectChipHtml(parsed);
  if (fields) fields.hidden = !titleFieldsVisible(parsed);
  updateFindLink();
}

function updateFindLink() {
  const link = document.getElementById("find-lyrics");
  if (!link || !session.form) return;
  const title = document.getElementById("title")?.value.trim() || session.form.title || "";
  const artist = document.getElementById("artist")?.value.trim() || session.form.artist || "";
  if (!title || !artist) {
    link.dataset.disabled = "true";
    link.setAttribute("aria-disabled", "true");
    link.href = "#";
    return;
  }
  link.dataset.disabled = "false";
  link.removeAttribute("aria-disabled");
  link.href = searchLyricsUrl(title, artist);
}

function captureForm() {
  if (!session.form) return;
  const lyrics = document.getElementById("lyrics");
  const title = document.getElementById("title");
  const artist = document.getElementById("artist");
  if (lyrics) session.form.raw = lyrics.value;
  if (title) session.form.title = title.value;
  if (artist) session.form.artist = artist.value;
}

function saveSong() {
  captureForm();
  const form = session.form;
  const parsed = analyzePaste(form.raw, { detectTitle: false });
  const packed = packLines(parsed);
  const title = clip(form.title, 120);
  const artist = clip(form.artist, 120);
  const song = writeSong({ songId: form.songId, title, artist, lines: packed.lines, sections: packed.sections });
  if (song?.error) {
    form.error = song.error;
    showFormError(song.error);
    return;
  }
  persist();
  session.form = null;
  armToast("Saved on this device.");
  go(`#/song/${encodeURIComponent(song.id)}`);
}

function packLines(parsed) {
  const lines = [];
  const sections = [];
  for (let index = 0; index < parsed.lines.length && lines.length < 400; index += 1) {
    const line = clip(parsed.lines[index], 300);
    if (!line) continue;
    lines.push(line);
    sections.push(clip(parsed.sections?.[index] || "", 40));
  }
  return { lines, sections };
}

function writeSong({ songId, title, artist, lines, sections }) {
  if (!normalizeAnswer(title) || !normalizeAnswer(artist)) return { error: "Add a title and an artist." };
  if (lines.length < 2) return { error: "Keep at least two lyric lines." };
  const state = session.state;
  const existing = state.songs.find((song) => songKey(song.title, song.artist) === songKey(title, artist));
  if (songId) {
    const song = findSong(songId);
    if (!song) return { error: "That song is not on this device." };
    if (existing && existing.id !== song.id) return { error: "Another saved song already uses that title and artist." };
    const previousLines = [...song.lines];
    const oldTitle = song.title;
    const oldArtist = song.artist;
    song.title = title;
    song.artist = artist;
    song.lines = lines;
    song.sections = sections;
    song.updatedAt = Date.now();
    if (song.sample && (oldTitle !== title || oldArtist !== artist || previousLines.join("\n") !== lines.join("\n"))) song.sample = false;
    retitleSongProgress(state.progress, oldTitle, oldArtist, title, artist);
    resetLineMasteryIfChanged(state.progress, title, artist, previousLines, lines);
    return song;
  }
  if (existing) {
    const previousLines = [...existing.lines];
    existing.lines = lines;
    existing.sections = sections;
    existing.updatedAt = Date.now();
    if (existing.sample && previousLines.join("\n") !== lines.join("\n")) existing.sample = false;
    resetLineMasteryIfChanged(state.progress, existing.title, existing.artist, previousLines, lines);
    return existing;
  }
  const song = { id: uid(), title, artist, lines, sections, sample: false, createdAt: Date.now(), updatedAt: Date.now() };
  state.songs.push(song);
  return song;
}

function showPasteFallback(error) {
  const form = session.form;
  if (!form) return;
  form.fallback = true;
  form.manual = false;
  form.error = "";
  form.debug = error?.name || "Error";
  render();
}

function onClickPaste(event) {
  event.preventDefault();
  event.stopPropagation();
  const pending = readClipboardFromGesture();
  const form = session.form;
  pending.then((text) => {
    if (!form || session.form !== form) return;
    if (!String(text || "").trim()) {
      if (form.preview) return;
      showPasteFallback(Object.assign(new Error("empty"), { name: "NotFoundError" }));
      return;
    }
    applyPastedText(String(text));
  }).catch((error) => {
    if (!form || session.form !== form || form.preview) return;
    showPasteFallback(error);
  });
}

function applyPastedText(text) {
  const form = session.form;
  if (!form) return;
  const parsed = cleanPastedPage(text, {
    detectTitle: !form.lockMeta,
    title: form.lockMeta ? form.title : "",
    artist: form.lockMeta ? form.artist : ""
  });
  form.raw = text;
  if (parsed.lines.length < 2) {
    form.preview = null;
    form.fallback = true;
    form.error = "That paste did not include enough lyric lines.";
    render();
    return;
  }
  form.preview = parsed;
  form.error = "";
  form.fallback = false;
  if (!form.lockMeta && parsed.detected) {
    form.title = parsed.title || "";
    form.artist = parsed.artist || "";
    form.needMeta = false;
  } else if (!form.lockMeta && (!normalizeAnswer(form.title) || !normalizeAnswer(form.artist))) {
    form.needMeta = true;
  }
  render();
}

function confirmPaste() {
  const form = session.form;
  if (!form?.preview) return;
  captureForm();
  const packed = packLines(form.preview);
  const title = clip(form.lockMeta ? form.title : (form.title || form.preview.title), 120);
  const artist = clip(form.lockMeta ? form.artist : (form.artist || form.preview.artist), 120);
  const song = writeSong({ songId: null, title, artist, lines: packed.lines, sections: packed.sections });
  if (song?.error) {
    form.error = song.error;
    form.needMeta = song.error.startsWith("Add a title");
    showFormError(song.error);
    if (form.needMeta) render();
    return;
  }
  persist();
  const lesson = firstLessonId(song.lines, song.sections);
  session.form = null;
  armToast("Saved on this device.");
  go(`#/play/${encodeURIComponent(song.id)}/${lesson}`);
}

function nextLyricsLink(title, artist, concertId) {
  const ids = [];
  if (concertId) ids.push(concertId);
  if (title && artist) {
    for (const concert of concertsForSong(session.concerts, title, artist)) {
      if (!ids.includes(concert.id)) ids.push(concert.id);
    }
  }
  for (const id of ids) {
    const concert = session.concerts.find((item) => item.id === id);
    if (!concert) continue;
    const summary = activeConcertSummary(concert, session.state.songs, progressOf(session.state));
    const slot = summary.slots.find((item) => item.status === "needs-lyrics" && !(title && artist && songsMatch(item.title, item.artist, title, artist)));
    if (!slot) continue;
    const href = `#/add?title=${encodeURIComponent(slot.title)}&artist=${encodeURIComponent(slot.artist)}&concert=${encodeURIComponent(concert.id)}`;
    return `<a class="btn btn-outline" data-testid="next-lyrics" href="${href}">Next song</a>`;
  }
  return "";
}

function showFormError(message) {
  const el = document.getElementById("form-error");
  if (el) el.textContent = message;
}

function ensurePlay() {
  const route = session.route;
  const song = findSong(route.songId);
  const game = GAMES.find((item) => item.id === route.gameId);
  if (!song || !game) {
    go("#/");
    return false;
  }
  if (!gameAvailability(song.lines, song.sections || [])[game.id]) {
    armToast("That game needs more lines in this song.");
    go(`#/song/${encodeURIComponent(song.id)}`);
    return false;
  }
  const roundId = route.params.round || "";
  const chunk = route.params.chunk === undefined || route.params.chunk === "" ? null : Number(route.params.chunk);
  const seedValue = Number(route.params.seed);
  const singFlag = route.params.sing === "1" ? "1" : "";
  const key = `${song.id}:${game.id}:${roundId}:${chunk ?? ""}:${Number.isInteger(seedValue) ? seedValue : ""}:${singFlag}`;
  if (session.play?.key === key) return true;
  stopListening();
  const skipIds = route.params.again === "1" || game.id === "concert" ? [] : masteredRoundIds(progressOf(session.state), song);
  const rng = Number.isInteger(seedValue) && seedValue > 0 ? seededRng(seedValue) : Math.random;
  const questions = buildLesson(song.lines, game.id, rng, song.sections || [], {
    skipIds,
    roundId,
    chunk: Number.isInteger(chunk) ? chunk : undefined,
    forceSing: route.params.sing === "1"
  });
  if (!questions.length) {
    armToast(skipIds.length ? "That chapter is mastered." : "That game needs more lines in this song.");
    go(`#/song/${encodeURIComponent(song.id)}`);
    return false;
  }
  stopTimer();
  session.play = {
    key,
    songId: song.id,
    gameId: game.id,
    gameName: game.name,
    questions,
    index: 0,
    hearts: 5,
    maxHearts: 5,
    xp: 0,
    score: 0,
    correct: 0,
    answered: 0,
    combo: 0,
    bestCombo: 0,
    locked: false,
    feedback: null,
    picked: null,
    typed: "",
    listening: false,
    voiceOff: false,
    voiceRaw: "",
    voiceDisplay: "",
    fromVoice: false,
    miss: null,
    study: null,
    order: null,
    questionMistakes: 0,
    deadline: null,
    finishing: false
  };
  return true;
}

function currentQuestion() {
  return session.play?.questions[session.play.index];
}

function ensureOrder() {
  const play = session.play;
  const question = currentQuestion();
  if (!play.order || play.order.index !== play.index) {
    play.order = { index: play.index, pool: question.shuffled.map((token) => token.id), arranged: [] };
  }
  return play.order;
}

function rememberTyped() {
  const input = document.getElementById("answer-input");
  if (input && session.play) session.play.typed = input.value;
}

function paintListening() {
  const play = session.play;
  const on = Boolean(play?.listening);
  const mic = document.querySelector("[data-testid=mic]");
  if (mic) {
    mic.classList.toggle("is-listening", on);
    mic.setAttribute("aria-pressed", on ? "true" : "false");
    mic.setAttribute("aria-label", on ? "Stop listening" : "Sing or speak");
  }
  const status = document.querySelector("[data-testid=listen-status]");
  if (status) status.hidden = !on;
  const live = document.querySelector("[data-testid=live-transcript]");
  if (live) live.hidden = !on || !play?.voiceDisplay;
}

function showHeard(text, meta = {}) {
  const play = session.play;
  if (!play) return;
  const display = String(text || "");
  play.voiceDisplay = display;
  play.voiceRaw = String(meta.raw || display);
  play.fromVoice = true;
  const input = document.getElementById("answer-input");
  const live = document.querySelector("[data-testid=live-transcript]");
  if (input && play.listening) input.value = "";
  if (live) {
    live.textContent = display;
    live.hidden = !play.listening || !display;
  }
}

function stopListening() {
  const play = session.play;
  const wasListening = Boolean(play?.listening);
  if (play) play.listening = false;
  const current = ear;
  ear = null;
  current?.abort();
  if (wasListening && play?.fromVoice) {
    const input = document.getElementById("answer-input");
    if (input && !input.value && play.voiceDisplay) {
      input.value = play.voiceDisplay;
      play.typed = play.voiceDisplay;
    }
  }
  paintListening();
}

function toggleMic() {
  const play = session.play;
  const question = currentQuestion();
  if (!play || play.locked || play.orderBusy || !question?.sing) return;
  if (play.listening) {
    stopListening();
    return;
  }
  if (!speechRecognitionSupported() || play.voiceOff) return;
  const song = findSong(play.songId);
  const next = createLineRecognizer({
    expected: question.answer || question.line || "",
    vocabulary: song?.lines || [],
    onTranscript(text, meta) {
      if (session.play !== play || !play.listening) return;
      showHeard(text, meta);
    },
    onDenied() {
      if (session.play !== play) return;
      play.listening = false;
      play.voiceOff = true;
      ear = null;
      render();
    },
    onUnsupported() {
      if (session.play !== play) return;
      play.listening = false;
      play.voiceOff = true;
      ear = null;
      render();
    },
    onEnd() {
      if (session.play !== play || play.voiceOff) return;
      if (play.listening) {
        play.listening = false;
        paintListening();
      }
    }
  });
  if (!next) {
    play.voiceOff = true;
    render();
    return;
  }
  ear = next;
  play.listening = true;
  paintListening();
  next.start();
}

function cantSing() {
  const play = session.play;
  const question = currentQuestion();
  if (!play || play.locked || play.orderBusy || !question?.sing) return;
  stopListening();
  question.sing = false;
  play.typed = "";
  play.listening = false;
  play.voiceRaw = "";
  play.voiceDisplay = "";
  play.fromVoice = false;
  play.miss = null;
  render();
}

function judgeSing() {
  const play = session.play;
  const question = currentQuestion();
  if (!play || play.locked || play.orderBusy || !question?.sing) return;
  const typedNow = (document.getElementById("answer-input")?.value ?? play.typed ?? "").trim();
  const voiceRaw = (play.voiceRaw || "").trim();
  const voiceDisplay = (play.voiceDisplay || "").trim();
  const fromVoice = Boolean(play.fromVoice && voiceRaw) && (!typedNow || typedNow === voiceDisplay);
  const given = fromVoice ? voiceRaw : typedNow;
  if (!given) return;
  play.orderBusy = true;
  play.typed = fromVoice ? (voiceDisplay || voiceRaw) : typedNow;
  const expected = question.answer || question.line || "";
  const song = findSong(play.songId);
  const correct = fromVoice
    ? interpretHearing(expected, [voiceRaw], song?.lines || []).pass
    : singingMatch(expected, given);
  stopListening();
  const field = document.getElementById("sing-field");
  field?.classList.add(correct ? "is-accept" : "is-reject");
  const status = document.querySelector("[data-testid=sing-miss]");
  if (status) status.textContent = correct ? "" : "Not quite, try again";
  buzz(correct ? 12 : 20);
  blip(correct ? "ok" : "bad", session.state.settings.sound);
  if (!correct) {
    play.combo = 0;
    play.questionMistakes += 1;
    play.hearts = Math.max(0, play.hearts - 1);
    play.miss = {
      message: "Not quite, try again",
      heard: fromVoice ? voiceRaw : ""
    };
    paintHearts();
  } else {
    play.miss = null;
  }
  const failed = !correct && play.hearts <= 0;
  window.setTimeout(() => {
    if (session.play !== play) return;
    play.orderBusy = false;
    field?.classList.remove("is-reject", "is-accept");
    if (correct) submitCurrent({ singText: given, singVoice: fromVoice });
    else if (failed) submitCurrent({ singFailed: true });
    else render();
  }, motionDelay());
}

function revealSingAnswer() {
  const play = session.play;
  const question = currentQuestion();
  if (!play || play.locked || play.orderBusy || !question?.sing) return;
  if ((play.questionMistakes || 0) < 2) return;
  stopListening();
  submitCurrent({ singFailed: true });
}

function ensureStudy() {
  const play = session.play;
  const question = currentQuestion();
  if (!play || !question) return null;
  if (question.kind !== "fade" && question.kind !== "think") return null;
  if (!play.study || play.study.index !== play.index || play.study.kind !== question.kind) {
    const fresh = question.kind === "think" ? initialThink(question) : { pass: 0, line: 0, revealed: 0 };
    play.study = { index: play.index, kind: question.kind, ...fresh };
  }
  return play.study;
}

function advanceFadeTap() {
  const play = session.play;
  const question = currentQuestion();
  if (!play || play.locked || question?.kind !== "fade") return;
  const study = ensureStudy();
  const next = advanceFade(question, study);
  if (next.finished) {
    submitCurrent({
      study: true,
      studyMistakes: 0,
      studyMastered: true,
      studyGot: (question.steps || []).map((step) => step.id)
    });
    return;
  }
  play.study = { ...study, ...next, index: play.index, kind: "fade" };
  render();
}

function showThinkLine() {
  const play = session.play;
  const question = currentQuestion();
  if (!play || play.locked || question?.kind !== "think") return;
  const study = ensureStudy();
  if (study.phase !== "think") return;
  study.phase = "rate";
  render();
}

function rateThinkTap(gotIt) {
  const play = session.play;
  const question = currentQuestion();
  if (!play || play.locked || question?.kind !== "think") return;
  const study = ensureStudy();
  if (study.phase !== "rate") return;
  const next = applyThink(study, gotIt);
  if (next.finished) {
    submitCurrent({
      study: true,
      studyMistakes: next.misses,
      studyMastered: next.misses === 0,
      studyGot: next.got
    });
    return;
  }
  play.study = { index: play.index, kind: "think", ...next };
  render();
}

function submitCurrent(forced = null) {
  const play = session.play;
  if (!play || play.locked) return;
  const question = currentQuestion();
  const song = findSong(play.songId);
  if (!question || !song) return;
  let correct = false;
  if (forced?.timeout) {
    correct = false;
  } else if (question.sing) {
    if (forced?.singFailed) {
      correct = false;
    } else {
      const given = String(forced?.singText ?? "").trim();
      if (!given) return;
      correct = forced?.singVoice
        ? interpretHearing(question.answer || question.line, [given], song.lines || []).pass
        : singingMatch(question.answer || question.line, given);
    }
  } else if (forced?.study) {
    correct = Boolean(forced.studyMastered);
  } else if (question.choices) {
    play.picked = forced?.choice ?? play.picked;
    if (!play.picked) return;
    correct = answersMatch(question.answer, play.picked);
  } else if (question.kind === "order" || question.kind === "lines") {
    if (forced?.orderFailed) {
      correct = false;
    } else {
      const order = ensureOrder();
      if (order.arranged.length !== question.tokens.length) {
        showPlayNote("Place every word first.");
        return;
      }
      correct = gradeAnswer(question, order.arranged);
    }
  } else {
    return;
  }
  play.locked = true;
  stopListening();
  stopTimer();
  play.answered += 1;
  if (correct) {
    play.combo += 1;
    play.correct += 1;
    play.bestCombo = Math.max(play.bestCombo, play.combo);
  } else {
    play.combo = 0;
    if (!forced?.orderFailed && !forced?.singFailed && !forced?.study) {
      play.questionMistakes += 1;
      play.hearts = Math.max(0, play.hearts - 1);
    }
  }
  const secondsLeft = play.gameId === "concert" && play.deadline
    ? Math.max(0, (play.deadline - performance.now()) / 1000)
    : null;
  const progress = progressOf(session.state);
  if (question.roundId) {
    recordRoundResult(progress, song, {
      roundId: question.roundId,
      mistakes: forced?.study ? (forced.studyMistakes || 0) : play.questionMistakes,
      completed: forced?.study ? Boolean(forced.studyMastered) : correct
    });
  }
  const points = pointsFor({ kind: question.kind, correct, combo: play.combo, secondsLeft });
  play.xp += points.xp;
  play.score += points.score;
  if (question.kind === "fade" || question.kind === "think") {
    const got = new Set(forced?.studyGot || []);
    (question.steps || []).forEach((step, index) => {
      const lineCorrect = question.kind === "fade" ? Boolean(forced?.studyMastered) : got.has(step.id);
      recordLineResult(progress, song, { line: step.text, correct: lineCorrect, xpGain: index === 0 ? points.xp : 0 });
    });
  } else {
    recordLineResult(progress, song, { line: question.line, correct, xpGain: points.xp });
  }
  persist();
  play.feedback = {
    correct,
    answer: question.sing ? (question.answer || correctLine(question)) : correctLine(question),
    xp: points.xp,
    timeout: Boolean(forced?.timeout)
  };
  if (!forced?.singText && !forced?.singFailed) {
    blip(correct ? "ok" : "bad", session.state.settings.sound);
    if (navigator.vibrate) navigator.vibrate(correct ? 12 : [18, 30, 18]);
  }
  render();
}

function showPlayNote(message) {
  let note = document.getElementById("play-note");
  if (!note) {
    note = document.createElement("p");
    note.id = "play-note";
    note.className = "error";
    document.getElementById("answer-form")?.prepend(note) || document.querySelector(".dock")?.before(note);
  }
  note.textContent = message;
}

function continueLesson() {
  const play = session.play;
  if (!play) return;
  stopListening();
  if (play.hearts <= 0 || play.index >= play.questions.length - 1) {
    finishLesson();
    return;
  }
  play.index += 1;
  play.locked = false;
  play.feedback = null;
  play.picked = null;
  play.typed = "";
  play.listening = false;
  play.voiceRaw = "";
  play.voiceDisplay = "";
  play.fromVoice = false;
  play.miss = null;
  play.study = null;
  play.order = null;
  play.questionMistakes = 0;
  play.deadline = null;
  stopTimer();
  render();
}

function keepPracticing() {
  const results = session.results;
  const song = results && findSong(results.songId);
  if (!song) return;
  const stats = songStats(progressOf(session.state), song);
  const step = nextPractice(song.lines, song.sections || [], { rounds: stats.rounds || {}, chapters: stats.chapters || {} });
  const query = step.roundId ? `?round=${encodeURIComponent(step.roundId)}` : "";
  go(`#/play/${encodeURIComponent(song.id)}/${step.gameId}${query}`);
}

function watchNetlifyBadge() {
  const hide = () => {
    document.querySelectorAll("#netlify-drawer, .netlify-drawer, [data-netlify-deploy-id], iframe[name='netlify-drawer'], iframe[title*='Netlify']").forEach((node) => node.remove());
  };
  hide();
  const observer = new MutationObserver(hide);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

async function finishLesson() {
  const play = session.play;
  if (!play || play.finishing) return;
  play.finishing = true;
  stopListening();
  stopTimer();
  const song = findSong(play.songId);
  const state = session.state;
  const progress = progressOf(state);
  const bonus = lessonBonus(play.answered, play.questions.length);
  if (bonus) {
    addBonusXp(progress, song, bonus);
    play.xp += bonus;
  }
  if (song && play.index >= play.questions.length - 1) markChapter(progress, song, play.gameId);
  const run = recordRun(progress, song, { score: play.score, gameId: play.gameId });
  const streak = finishStreak(progress);
  const stats = songStats(progress, song);
  const player = activePlayer(state);
  const entry = sanitizeRun({
    id: uid(),
    playerId: player.id,
    playerName: player.name,
    songTitle: song.title,
    songArtist: song.artist,
    gameId: play.gameId,
    score: play.score,
    xp: play.xp,
    createdAt: new Date().toISOString()
  });
  await providerFor().submitRun(entry, session.concerts);
  const accuracy = play.answered ? Math.round((100 * play.correct) / play.answered) : 0;
  session.results = {
    songId: song.id,
    title: song.title,
    artist: song.artist,
    gameId: play.gameId,
    gameName: play.gameName,
    score: play.score,
    xp: play.xp,
    correct: play.correct,
    total: play.questions.length,
    accuracy,
    newBest: run.isNewBest,
    masteryPercent: stats.masteryPercent,
    linesMastered: stats.linesMastered,
    lineCount: stats.lineCount,
    hearts: play.hearts,
    songMastered: Boolean(stats.songMastered),
    streak: streak.count,
    playerName: player.name
  };
  session.play = null;
  go("#/results");
}

function startTimer() {
  const play = session.play;
  if (timerId || !play || play.locked || play.gameId !== "concert" || session.route.name !== "play") return;
  const limit = questionSeconds(currentQuestion());
  play.limit = limit;
  if (!play.deadline) play.deadline = performance.now() + limit * 1000;
  timerId = setInterval(() => {
    if (!session.play || session.play.locked) {
      stopTimer();
      return;
    }
    if (session.play.orderBusy) return;
    const left = session.play.deadline - performance.now();
    const bar = document.getElementById("timer-bar");
    const label = document.getElementById("timer-label");
    const span = (session.play.limit || limit) * 1000;
    if (bar) bar.style.transform = `scaleX(${Math.max(0, left / span)})`;
    if (label) label.textContent = formatSeconds(Math.max(0, Math.ceil(left / 100) / 10));
    if (left <= 0) {
      stopTimer();
      submitCurrent({ timeout: true });
    }
  }, 100);
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

function askDelete(id) {
  const song = findSong(id);
  if (!song) return;
  session.modal = {
    title: "Delete this song?",
    body: "The lyrics are removed from this device. Scores stay, without the words.",
    confirmLabel: "Delete",
    danger: true,
    onConfirm() {
      session.state.songs = session.state.songs.filter((item) => item.id !== id);
      persist();
      armToast("Song deleted.");
      go("#/");
    }
  };
  render();
}

function leaveLesson() {
  stopTimer();
  stopListening();
  session.modal = {
    title: "Leave this lesson?",
    body: "Hearts reset next time. XP you already earned stays saved.",
    confirmLabel: "Leave",
    danger: true,
    onConfirm() {
      const songId = session.play?.songId;
      session.play = null;
      go(songId ? `#/song/${encodeURIComponent(songId)}` : "#/");
    }
  };
  render();
}

async function openShare(card) {
  const safe = {
    kind: card.kind === "concert" ? "concert" : "song",
    title: clip(card.title, 80),
    artist: clip(card.artist || "", 80),
    score: Math.max(0, Math.round(Number(card.score) || 0)),
    streak: Math.max(0, Math.round(Number(card.streak) || 0)),
    playerName: clip(card.playerName || "You", 40),
    detail: clip(card.detail || "", 80)
  };
  let url = "";
  try {
    const blob = await drawShareCard(safe);
    if (blob) url = URL.createObjectURL(blob);
  } catch {
    url = "";
  }
  if (session.shareUrl) URL.revokeObjectURL(session.shareUrl);
  session.shareUrl = url;
  session.modal = {
    title: "Share score",
    confirmLabel: "Close",
    share: { text: shareText(safe), url },
    onConfirm() {}
  };
  render();
}

function shareResults() {
  const results = session.results;
  if (!results) return;
  openShare({
    kind: "song",
    title: results.title,
    artist: results.artist,
    score: results.score,
    streak: results.streak,
    playerName: results.playerName,
    detail: results.gameName
  });
}

function shareConcert(id) {
  const concert = session.concerts.find((item) => item.id === id);
  if (!concert) return;
  const summary = activeConcertSummary(concert, session.state.songs, progressOf(session.state));
  openShare({
    kind: "concert",
    title: concert.name,
    score: summary.score,
    streak: progressOf(session.state).streak?.count || 0,
    playerName: activePlayer(session.state).name,
    detail: summary.total ? `${summary.mastered} of ${summary.total} songs mastered` : ""
  });
}

function exportProgress() {
  const payload = buildExport(session.state);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "lyric-trainer-progress.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  armToast("Progress file downloaded.");
  render();
}

async function importFile(file) {
  if (!file) return;
  if (file.size > 1_500_000) {
    armToast("That file is too large to be a progress export.");
    render();
    return;
  }
  try {
    const data = JSON.parse(await file.text());
    mergeImport(session.state, data);
    persist();
    armToast("Progress imported. Lyrics in that file were ignored.");
  } catch (error) {
    armToast(error.message || "Could not import that file.");
  }
  render();
}

function addPlayer(name) {
  const clean = clip(name, 40);
  if (!clean) return;
  if (session.state.players.some((player) => player.name.toLowerCase() === clean.toLowerCase())) {
    armToast("That player name is already on this device.");
    render();
    return;
  }
  const player = { id: uid(), name: clean, createdAt: Date.now() };
  session.state.players.push(player);
  session.state.progress[player.id] = emptyProgress();
  session.state.activePlayerId = player.id;
  persist();
  armToast(`Now playing as ${clean}.`);
  render();
}

function switchPlayer(id) {
  if (!session.state.players.some((player) => player.id === id)) return;
  session.state.activePlayerId = id;
  persist();
  render();
}

function saveRename(name) {
  const player = session.state.players.find((item) => item.id === session.renaming);
  const clean = clip(name, 40);
  if (!player || !clean) return;
  player.name = clean;
  for (const run of session.state.leaderboard || []) {
    if (run.playerId === player.id) run.playerName = clean;
  }
  session.renaming = "";
  persist();
  render();
}

function deletePlayer(id) {
  if (session.state.players.length < 2) {
    armToast("Keep at least one player.");
    render();
    return;
  }
  session.state.players = session.state.players.filter((player) => player.id !== id);
  delete session.state.progress[id];
  session.state.leaderboard = (session.state.leaderboard || []).filter((run) => run.playerId !== id);
  if (session.state.activePlayerId === id) session.state.activePlayerId = session.state.players[0].id;
  persist();
  armToast("Player removed.");
  render();
}

function restoreSample() {
  if (!session.state.songs.some((song) => song.id === "sample-banana-flashlight" || (song.sample && songKey(song.title, song.artist) === songKey(SAMPLE_SONG.title, SAMPLE_SONG.artist)))) {
    session.state.songs.push(sampleRecord());
  }
  session.state.seeded = true;
  persist();
  armToast("Sample song is ready.");
  go("#/");
}

function eraseAll() {
  const fresh = seedSample(blankState());
  fresh.settings.privacySeen = true;
  session.state = fresh;
  session.play = null;
  session.results = null;
  session.form = null;
  persist();
  armToast("Erased on this device.");
  go("#/");
}

function modalHtml() {
  const modal = session.modal;
  if (!modal) return "";
  const share = modal.share ? `
    ${modal.share.url ? `<img class="share-preview" alt="Score card" src="${modal.share.url}">` : ""}
    <p class="share-text">${escapeHtml(modal.share.text)}</p>
    <p id="copy-status" class="hint"></p>
    <div class="stack">
      <button class="btn btn-text" type="button" data-action="copy-share">Copy text</button>
      ${modal.share.url ? `<a class="btn btn-primary" href="${modal.share.url}" download="lyric-trainer-score.png">Save image</a>` : ""}
    </div>
  ` : `<p>${escapeHtml(modal.body || "")}</p>`;
  return `
    <dialog class="modal">
      <div class="modal-card">
        <h2>${escapeHtml(modal.title || "")}</h2>
        ${share}
        <div class="stack">
          ${modal.confirmLabel === "Close" ? "" : `<button class="btn btn-text" type="button" data-action="cancel-modal">Back</button>`}
          <button class="btn ${modal.danger ? "btn-text btn-danger" : "btn-primary"}" type="button" data-action="confirm-modal">${escapeHtml(modal.confirmLabel || "OK")}</button>
        </div>
      </div>
    </dialog>
  `;
}

function afterRender() {
  const dialog = document.querySelector("dialog");
  if (dialog && !dialog.open) {
    dialog.showModal();
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancelModal();
    });
  }
  updateFindLink();
  const lyrics = document.getElementById("lyrics");
  if (session.route.name === "add" && session.form?.fallback && !session.form.preview && lyrics) lyrics.focus();
  const paste = document.querySelector("[data-testid=paste-clipboard]");
  if (paste) paste.addEventListener("click", onClickPaste);
  startTimer();
  fitPlayViewport();
}

function onSheetPaste(event) {
  if (session.route.name !== "add" || !session.form) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("input, textarea") && target.id !== "lyrics") return;
  const html = event.clipboardData?.getData("text/html") ?? "";
  const plain = event.clipboardData?.getData("text/plain") ?? "";
  const text = choosePasteSource(html, plain);
  if (!String(text).trim()) return;
  event.preventDefault();
  applyPastedText(text);
}

let orderStatusTimer = 0;

function showOrderStatus(message) {
  const status = document.querySelector("[data-testid=order-status]");
  if (!status) return;
  status.textContent = message;
  window.clearTimeout(orderStatusTimer);
  orderStatusTimer = window.setTimeout(() => {
    if (status.isConnected) status.textContent = "";
  }, 1500);
}

function paintHearts() {
  const root = document.querySelector("[data-testid=hearts]");
  const play = session.play;
  if (!root || !play) return;
  root.setAttribute("aria-label", `${play.hearts} of ${play.maxHearts} lives`);
  root.querySelectorAll(".heart").forEach((heart, index) => {
    heart.classList.toggle("is-empty", index >= play.hearts);
  });
}

function buzz(pattern) {
  if (typeof navigator.vibrate === "function") navigator.vibrate(pattern);
}

function motionDelay() {
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  return media?.matches ? 300 : 300;
}

function judgePickedToken(button) {
  const play = session.play;
  const question = currentQuestion();
  if (!play || play.locked || play.orderBusy || !question || !button) return;
  const order = ensureOrder();
  const id = button.dataset.token;
  if (!order.pool.includes(id)) return;
  if (!judgeOrderTap(question, order.arranged, id)) {
    play.orderBusy = true;
    play.combo = 0;
    play.questionMistakes += 1;
    play.hearts = Math.max(0, play.hearts - 1);
    paintHearts();
    button.classList.add("is-reject");
    if (question.kind === "order") showOrderStatus("Not that word. Try another.");
    buzz(20);
    blip("bad", session.state.settings.sound);
    const failed = play.hearts <= 0;
    window.setTimeout(() => {
      if (session.play !== play) return;
      button.classList.remove("is-reject");
    }, motionDelay());
    window.setTimeout(() => {
      if (session.play !== play) return;
      play.orderBusy = false;
      if (failed) submitCurrent({ orderFailed: true });
    }, failed ? 1500 : motionDelay());
    return;
  }
  play.orderBusy = true;
  button.classList.add("is-accept");
  buzz(12);
  blip("ok", session.state.settings.sound);
  window.setTimeout(() => {
    if (session.play !== play || play.locked) return;
    play.orderBusy = false;
    order.pool = order.pool.filter((item) => item !== id);
    order.arranged.push(id);
    order.justPlaced = id;
    const done = order.arranged.length === question.tokens.length;
    render();
    if (done && question.kind !== "order") window.setTimeout(() => {
      if (session.play === play && !play.locked) submitCurrent({ orderComplete: true });
    }, motionDelay());
  }, motionDelay());
}

function onKeyDown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target : null;
  const field = target?.closest("input, textarea, select, [contenteditable='true']");
  if (field) return;
  if (target?.closest("button, a") && event.key === "Enter") return;
  if (event.key === "Enter") {
    const primary = document.querySelector("dialog[open] [data-primary], dialog[open] [data-action=confirm-modal]")
      || document.querySelector("[data-primary]");
    if (!primary || primary.disabled) return;
    event.preventDefault();
    primary.click();
    return;
  }
  if (/^[1-9]$/.test(event.key)) {
    const option = document.querySelector(`[data-option="${Number(event.key) - 1}"]`);
    if (!option || option.disabled) return;
    event.preventDefault();
    option.click();
  }
}

function onClick(event) {
  const clickTarget = event.target instanceof Element ? event.target : event.target?.parentElement;
  const link = clickTarget?.closest("a[href]");
  if (link?.dataset.testid === "song-card" || link?.dataset.testid === "nav-home") session.section = "home";
  if (link?.dataset.testid === "setlist-slot" || link?.dataset.testid === "up-next-row" || link?.dataset.testid === "nav-concerts" || link?.closest("[data-testid=concert-page]")) {
    session.section = "concerts";
  }
  if (clickTarget?.closest("[data-action=paste-clipboard]")) return;
  const finder = clickTarget?.closest("#find-lyrics");
  if (finder?.dataset.disabled === "true") {
    event.preventDefault();
    showFormError("Add a title and artist first.");
    return;
  }
  const el = clickTarget?.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  if (action === "edit-title") {
    captureForm();
    session.form.forceFields = true;
    session.form.titleTouched = true;
    render();
  } else if (action === "reject-title") {
    captureForm();
    const detected = analyzePaste(session.form.raw, { detectTitle: true });
    if (detected.detected && session.form.title === detected.title) session.form.title = "";
    if (detected.detected && session.form.artist === detected.artist) session.form.artist = "";
    session.form.rejectDetection = true;
    session.form.forceFields = true;
    session.form.titleTouched = true;
    render();
  } else if (action === "save-song") saveSong();
  else if (action === "use-fallback") {
    captureForm();
    applyPastedText(session.form?.raw || "");
  } else if (action === "confirm-paste") confirmPaste();
  else if (action === "retry-paste") {
    if (!session.form) return;
    session.form.preview = null;
    session.form.error = "";
    session.form.raw = "";
    session.form.manual = false;
    session.form.fallback = false;
    render();
  } else if (action === "ask-delete") askDelete(el.dataset.id);
  else if (action === "leave") leaveLesson();
  else if (action === "choose") {
    const choice = currentQuestion()?.choices?.[Number(el.dataset.choice)];
    if (choice) submitCurrent({ choice });
  } else if (action === "toggle-mic") toggleMic();
  else if (action === "cant-sing") cantSing();
  else if (action === "pick-token") {
    judgePickedToken(el);
  } else if (action === "fade-advance") advanceFadeTap();
  else if (action === "think-show") showThinkLine();
  else if (action === "think-rate") rateThinkTap(el.dataset.rate !== "missed");
  else if (action === "show-answer") revealSingAnswer();
  else if (action === "check") {
    if (currentQuestion()?.sing) judgeSing();
    else submitCurrent();
  }
  else if (action === "keep-practicing") keepPracticing();
  else if (action === "toggle-sections") {
    if (session.results) session.results.showSections = !session.results.showSections;
    render();
  } else if (action === "practice-chunk" || action === "practice-again") {
    const songId = session.results?.songId;
    const round = el.dataset.round || "";
    const again = action === "practice-again" ? "&again=1" : "";
    if (songId && round) go(`#/play/${encodeURIComponent(songId)}/lines?round=${encodeURIComponent(round)}${again}`);
  } else if (action === "continue") continueLesson();
  else if (action === "confirm-modal") {
    const confirm = session.modal?.onConfirm;
    session.modal = null;
    confirm?.();
    if (!session.modal && session.route.name !== "play") render();
  } else if (action === "cancel-modal") cancelModal();
  else if (action === "copy-share") copyShare();
  else if (action === "dismiss-privacy") {
    session.state.settings.privacySeen = true;
    persist();
    render();
  } else if (action === "filter-board") {
    session.boardFilter = el.dataset.concert || "";
    render();
  } else if (action === "switch-player") switchPlayer(el.dataset.id);
  else if (action === "start-rename") {
    session.renaming = el.dataset.id;
    render();
  } else if (action === "ask-delete-player") {
    const id = el.dataset.id;
    session.modal = {
      title: "Remove this player?",
      body: "Their scores on this device are removed. Songs stay.",
      confirmLabel: "Remove",
      danger: true,
      onConfirm() { deletePlayer(id); }
    };
    render();
  } else if (action === "export-progress") exportProgress();
  else if (action === "pick-import") document.getElementById("import-file")?.click();
  else if (action === "restore-sample") restoreSample();
  else if (action === "ask-erase") {
    session.modal = {
      title: "Erase everything?",
      body: "Songs, scores, and players on this device are removed. The sample song comes back.",
      confirmLabel: "Erase",
      danger: true,
      onConfirm: eraseAll
    };
    render();
  } else if (action === "toggle-sound") {
    session.state.settings.sound = !session.state.settings.sound;
    persist();
    render();
  } else if (action === "share-results") shareResults();
  else if (action === "share-concert") shareConcert(el.dataset.id);
}

function cancelModal() {
  session.modal = null;
  if (session.play && session.route.name === "play") session.play.deadline = null;
  render();
}

async function copyShare() {
  const text = session.modal?.share?.text || "";
  const status = document.getElementById("copy-status");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  if (status) status.textContent = "Copied. The card has the score, not the lyrics.";
}

function onInput(event) {
  if (event.target.id === "answer-input") {
    const value = event.target.value;
    if (session.play) {
      session.play.typed = value;
      if (session.play.fromVoice && value.trim() !== (session.play.voiceDisplay || "").trim()) session.play.fromVoice = false;
      if (session.play.miss) {
        session.play.miss = null;
        document.getElementById("sing-field")?.classList.remove("is-wrong");
        const status = document.querySelector("[data-testid=sing-miss]");
        if (status) status.textContent = "";
      }
    }
    if (event.isTrusted && session.play?.listening) stopListening();
  }
  if (event.target.id === "lyrics") onLyricsInput(event);
  if (event.target.id === "title" || event.target.id === "artist") {
    if (session.form) session.form.titleTouched = true;
    updateFindLink();
  }
}

function onSubmit(event) {
  if (event.target.id === "answer-form") {
    event.preventDefault();
    if (currentQuestion()?.sing) judgeSing();
    else submitCurrent();
  } else if (event.target.id === "player-form") {
    event.preventDefault();
    const name = document.getElementById("player-name")?.value || "";
    addPlayer(name);
  } else if (event.target.id === "rename-form") {
    event.preventDefault();
    saveRename(document.getElementById("rename-input")?.value || "");
  }
}

function onChange(event) {
  if (event.target.id === "import-file") {
    const file = event.target.files?.[0];
    event.target.value = "";
    importFile(file);
  }
}

function findSong(id) {
  return session.state.songs.find((song) => song.id === id) || null;
}

function meter(percent) {
  const width = Math.max(0, Math.min(100, Math.round(percent || 0)));
  return `<span class="meter" aria-hidden="true"><span style="width:${width}%"></span></span>`;
}

function formatScore(value) {
  return Math.max(0, Math.round(Number(value) || 0)).toLocaleString("en-US");
}

function gameName(id) {
  return GAMES.find((game) => game.id === id)?.name || "Lesson";
}

boot();
