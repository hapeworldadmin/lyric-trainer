import { blip } from "./audio.js?v=6";
import { readClipboardFromGesture } from "./clipboard.js?v=6";
import { activeConcertSummary, concertsForSong, leaderboardFromSongScores, normalizeConcerts } from "./concerts.js?v=6";
import {
  CONCERT_SECONDS,
  GAMES,
  answersMatch,
  buildLesson,
  firstLessonId,
  gameAvailability,
  isOrderCorrect,
  judgeOrderTap,
  lessonBonus,
  pointsFor
} from "./games.js?v=6";
import { analyzePaste, choosePasteSource, cleanPastedPage, draftLyrics, searchLyricsUrl } from "./parse.js?v=6";
import {
  addBonusXp,
  buildExport,
  emptyProgress,
  finishStreak,
  mergeImport,
  recordLineResult,
  recordRun,
  resetLineMasteryIfChanged,
  retitleSongProgress,
  songStats
} from "./progress.js?v=6";
import { SAMPLE_SONG } from "./sample.js?v=6";
import { createScoreProvider, sanitizeRun } from "./scores.js?v=6";
import { drawShareCard, shareText } from "./share.js?v=6";
import {
  activePlayer,
  activeProgress as progressOf,
  blankState,
  loadState,
  sampleRecord,
  saveState,
  seedSample
} from "./storage.js?v=6";
import { clip, escapeHtml, normalizeAnswer, songKey, songsMatch, uid } from "./text.js?v=6";

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
  close: '<path fill="currentColor" d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"/>'
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
  document.addEventListener("paste", onSheetPaste);
  document.addEventListener("input", onInput);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("change", onChange);
  if (!location.hash) location.hash = "#/";
  sync();
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
  if (session.route.name !== "play") stopTimer();
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

function shell(body, { play }) {
  const tone = toneFor(session.route.name);
  const tabs = !play && session.route.name !== "results";
  return `
    <div class="app tone-${tone} accent-${shellAccent()} ${play ? "is-play" : ""} ${tabs ? "has-tabs" : ""}">
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
  if (id === "home") return ["home", "song", "add", "edit"].includes(name);
  if (id === "concerts") return ["concerts", "concert"].includes(name);
  return name === id;
}

function viewHome() {
  const songs = [...session.state.songs].sort((a, b) => b.updatedAt - a.updatedAt);
  const concert = session.concerts[0];
  const summary = concert ? activeConcertSummary(concert, session.state.songs, progressOf(session.state)) : null;
  const hero = concert && summary?.total ? `
    <header class="hero accent-${accentForId(concert.id)}">
      <p class="kicker">Next up</p>
      <h1>${escapeHtml(concert.name)}</h1>
      <p class="hero-stat">${summary.mastered}/${summary.total} mastered</p>
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
      <p class="kicker">Songs</p>
      ${list}
    </section>
  `;
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
        ${nextLyricsLink(form.title, form.artist, form.fromConcert)}
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
  const stats = songStats(progressOf(session.state), song);
  const availability = gameAvailability(song.lines, song.sections || []);
  const reasons = {
    fill: "Needs a line with a word to hide",
    order: "Needs a line with at least 3 words",
    next: "Needs at least 3 lines",
    letters: "Needs a line to hint",
    concert: "Needs a line to perform",
    sections: "Needs at least two sections",
    lines: "Needs a section with two lines"
  };
  const group = (name) => GAMES.filter((game) => game.group === name).map((game) => {
    const final = game.id === "concert" ? " is-final" : "";
    if (!availability[game.id]) {
      return `<button class="game${final}" type="button" disabled><span>${escapeHtml(game.name)}<small>${reasons[game.id]}</small></span></button>`;
    }
    return `
      <a class="game${final}" data-testid="game-${game.id}" href="#/play/${encodeURIComponent(song.id)}/${game.id}">
        <span>${escapeHtml(game.name)}<small>${escapeHtml(game.detail)}</small></span>
      </a>
    `;
  }).join("");
  const concerts = concertsForSong(session.concerts, song.title, song.artist);
  const links = concerts.map((concert) => `<a class="text-link" href="#/concert/${encodeURIComponent(concert.id)}">${escapeHtml(concert.name)}</a>`).join("");
  const progressLine = stats.linesMastered > 0
    ? `${stats.linesMastered} of ${stats.lineCount} lines mastered`
    : "No lines mastered yet";
  return `
    <section class="screen">
      <header class="hero hero-song">
        <a class="back back-on-hero" href="#/">${icon("back")} Songs</a>
        <h1>${escapeHtml(song.title)}</h1>
        <p class="hero-stat">${escapeHtml(song.artist)}${song.sample ? " · Sample" : ""}</p>
      </header>
      <div class="meter-block">
        <p class="sub" data-testid="song-mastery">${progressLine}</p>
        ${meter(stats.masteryPercent)}
      </div>
      ${links ? `<p class="sub">On the setlist: ${links}</p>` : ""}
      <p class="kicker">Lessons</p>
      <div class="game-list">${group("main")}</div>
      <p class="kicker">Tricky lines</p>
      <div class="game-list">${group("warm")}</div>
      <div class="dock">
        <a class="btn btn-text" href="#/edit/${encodeURIComponent(song.id)}">Edit lyrics</a>
        <button class="btn btn-text btn-danger" type="button" data-action="ask-delete" data-id="${escapeHtml(song.id)}">Delete song</button>
        ${nextLyricsLink(song.title, song.artist, "")}
      </div>
    </section>
  `;
}

function viewPlay() {
  const play = session.play;
  if (!play) return `<section class="screen"><p>That lesson is over.</p></section>`;
  const question = play.questions[play.index];
  const total = play.questions.length;
  const shown = play.feedback ? play.index + 1 : play.index;
  const width = Math.round((shown / total) * 100);
  const hearts = Array.from({ length: play.maxHearts }, (_, index) => `
    <span class="heart ${index < play.hearts ? "" : "is-empty"}">${icon("heart")}</span>
  `).join("");
  const timer = play.gameId === "concert" && !play.feedback ? `
    <div class="timer" data-testid="timer">
      <div class="timer-track"><span id="timer-bar"></span></div>
      <span class="timer-label" id="timer-label">${CONCERT_SECONDS}s</span>
    </div>
  ` : "";
  const around = contextHtml(question);
  return `
    <section class="screen" data-testid="play">
      <div class="play-top">
        <button class="icon-btn" type="button" data-action="leave" data-testid="leave-lesson" aria-label="Close lesson">${icon("close")}</button>
        <div class="lesson-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${shown}" data-testid="lesson-progress">
          <span style="width:${width}%"></span>
        </div>
        <div class="hearts" data-testid="hearts" aria-label="${play.hearts} hearts left">${hearts}</div>
      </div>
      <p class="kicker">${escapeHtml(play.gameName)}</p>
      <p class="ask">${play.index + 1} / ${total}${play.combo >= 2 ? ` · ${play.combo} in a row` : ""}</p>
      ${timer}
      ${around.before}
      ${questionHtml(question)}
      ${around.after}
      ${play.feedback ? feedbackHtml(play) : answerControls(question)}
      ${nextLyricsLink(play.title || findSong(play.songId)?.title, play.artist || findSong(play.songId)?.artist, "")}
    </section>
  `;
}

function contextHtml(question) {
  const context = question?.context;
  if (!context?.total && !context?.rangeLabel) return { before: "", after: "" };
  const bits = [];
  if (context.rangeLabel) bits.push(context.rangeLabel);
  else {
    if (context.section) bits.push(context.section);
    if (context.total) bits.push(`line ${context.position} of ${context.total}`);
  }
  const meta = bits.length ? `<p class="context-meta" data-testid="line-context">${escapeHtml(bits.join(" · "))}</p>` : "";
  const showPrevious = context.previous && question.kind !== "next" && question.kind !== "sections";
  const previous = showPrevious ? `<p class="context-line is-anchor" data-testid="context-previous">${escapeHtml(context.previous)}</p>` : "";
  const next = context.next && question.kind !== "sections" && question.kind !== "lines"
    ? `<p class="context-line" data-testid="context-next">${escapeHtml(context.next)}</p>` : "";
  return { before: `${meta}${previous}`, after: next };
}

function questionHtml(question) {
  if (question.kind === "fill") {
    const picked = session.play.picked;
    const before = question.before ? `${escapeHtml(question.before)} ` : "";
    const after = question.after ? ` ${escapeHtml(question.after)}` : "";
    const blank = picked ? escapeHtml(picked) : "______";
    return `<p class="prompt" data-testid="question">${before}<span class="blank ${picked ? "filled" : ""}">${blank}</span>${after}</p>`;
  }
  if (question.kind === "next") {
    return `<p class="prompt" data-testid="question">${escapeHtml(question.prompt)}</p><p class="ask">What comes next?</p>`;
  }
  if (question.kind === "letters") {
    return `<p class="hint-line" data-testid="question">${escapeHtml(question.hint)}</p><p class="ask">Type the full line</p>`;
  }
  if (question.kind === "sections") return `<p class="ask" data-testid="question">Tap the sections in order</p>`;
  if (question.kind === "lines") return `<p class="ask" data-testid="question">Tap the lines in order</p>`;
  return `<p class="ask" data-testid="question">Tap the words in order</p>`;
}

function answerControls(question) {
  if (question.kind === "next") {
    return `<div class="choices">${question.choices.map((choice, index) => `
      <button class="choice" type="button" data-action="choose" data-choice="${index}">${escapeHtml(choice)}</button>
    `).join("")}</div>`;
  }
  if (question.kind === "order" || question.kind === "lines" || question.kind === "sections") {
    const order = ensureOrder();
    const stacked = question.kind === "order" ? "" : " is-stacked";
    const byId = new Map(question.tokens.map((token) => [token.id, token.text]));
    const placed = order.arranged.map((id) => `
      <span class="token is-set${order.justPlaced === id ? " is-placed" : ""}">${escapeHtml(byId.get(id) || "")}</span>
    `).join("");
    const pool = order.pool.map((id) => `
      <button class="token" type="button" data-action="pick-token" data-token="${escapeHtml(id)}">${escapeHtml(byId.get(id) || "")}</button>
    `).join("");
    const empty = question.kind === "sections" ? "The order appears here" : "Your line appears here";
    return `
      <div class="tray${stacked}" data-testid="tray">${placed || `<span class="hint">${empty}</span>`}</div>
      <div class="pool${stacked}">${pool}</div>
    `;
  }
  const bank = question.kind === "fill" ? `<div class="choices">${question.choices.map((choice, index) => `
    <button class="choice ${session.play.picked === choice ? "is-picked" : ""}" type="button" data-action="pick" data-choice="${index}">${escapeHtml(choice)}</button>
  `).join("")}</div>` : "";
  return `
    ${bank}
    <form id="answer-form" class="stack dock">
      <label class="field">${question.kind === "fill" ? "Or type it" : "Line"}
        <input id="answer-input" data-testid="answer-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" value="${escapeHtml(session.play.typed || "")}">
      </label>
      <button class="btn btn-primary" type="submit" data-testid="check">Check</button>
    </form>
  `;
}

function feedbackHtml(play) {
  const feedback = play.feedback;
  const praise = feedback.correct ? "Correct" : (feedback.timeout ? "Time is up" : "Not quite");
  const xp = feedback.xp ? ` +${feedback.xp} XP` : "";
  const nextLabel = play.hearts <= 0 || play.index >= play.questions.length - 1 ? "See results" : "Continue";
  return `
    <div class="feedback ${feedback.correct ? "is-good" : "is-bad"}" role="status" data-testid="feedback">
      <p><strong>${praise}${xp}</strong></p>
      ${feedback.correct ? "" : `<p class="answer">${escapeHtml(feedback.answer)}</p>`}
    </div>
    <div class="dock"><button class="btn btn-primary" type="button" data-action="continue" data-testid="continue">${nextLabel}</button></div>
  `;
}

function viewResults() {
  const results = session.results;
  if (!results) return "";
  const concerts = concertsForSong(session.concerts, results.title, results.artist)
    .map((concert) => `<a class="btn btn-text" href="#/concert/${encodeURIComponent(concert.id)}">${escapeHtml(concert.name)}</a>`)
    .join("");
  const bits = [];
  if (results.xp > 0) bits.push(`${results.xp} XP`);
  if (results.accuracy > 0) bits.push(`${results.accuracy}% accuracy`);
  if (results.streak > 0) bits.push(`<span data-testid="result-streak">${results.streak}</span> day streak`);
  const mastered = results.linesMastered > 0
    ? `${results.linesMastered} of ${results.lineCount} lines mastered`
    : "No lines mastered yet";
  return `
    <section class="screen">
      <header class="page-head">
        <p class="kicker">${results.newBest ? "New best" : "Lesson complete"}</p>
        <h1 data-testid="final-score">${formatScore(results.score)}</h1>
        <p class="sub">${escapeHtml(results.title)} · ${escapeHtml(results.artist)}</p>
      </header>
      ${bits.length ? `<p class="sub">${bits.join(" · ")}</p>` : `<p class="sub">Finish another round when you are ready.</p>`}
      <p class="sub">${mastered}</p>
      <div class="dock">
        <button class="btn btn-primary" type="button" data-action="share-results" data-testid="share-score">Share my score</button>
        <a class="btn btn-text" href="#/play/${encodeURIComponent(results.songId)}/${results.gameId}">Practice again</a>
        <a class="btn btn-text" href="#/song/${encodeURIComponent(results.songId)}">Back to song</a>
        ${concerts}
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
  const masteredLine = summary.total ? `${summary.mastered}/${summary.total} mastered` : "No setlist posted yet";
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
      <header class="hero accent-${accentForId(concert.id)}">
        <a class="back back-on-hero" href="#/concerts">${icon("back")} Concerts</a>
        <p class="kicker">Concert</p>
        <h1>${escapeHtml(concert.name)}</h1>
        ${concert.label ? `<p class="hero-stat" data-testid="concert-label">${escapeHtml(concert.label)}</p>` : ""}
        <p class="hero-stat" data-testid="concert-mastered">${masteredLine}</p>
        ${summary.total ? meter(summary.total ? Math.round((summary.mastered / summary.total) * 100) : 0) : ""}
        ${concert.source ? `<p class="hero-stat"><a class="text-link" data-testid="concert-source" href="${escapeHtml(concert.source)}" target="_blank" rel="noopener noreferrer">Source setlist</a></p>` : ""}
      </header>
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

function showPasteFallback() {
  const form = session.form;
  if (!form) return;
  form.fallback = true;
  form.manual = false;
  form.error = "";
  render();
}

function readClipboardNow() {
  readClipboardFromGesture()
    .then((text) => applyPastedText(text))
    .catch(() => showPasteFallback());
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
    return `<a class="btn btn-text" data-testid="next-lyrics" href="${href}">Next song needing lyrics</a>`;
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
  const key = `${song.id}:${game.id}`;
  if (session.play?.key === key) return true;
  const questions = buildLesson(song.lines, game.id, Math.random, song.sections || []);
  if (!questions.length) {
    armToast("That game needs more lines in this song.");
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
    order: null,
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

function submitCurrent(forced = null) {
  const play = session.play;
  if (!play || play.locked) return;
  const question = currentQuestion();
  const song = findSong(play.songId);
  if (!question || !song) return;
  let correct = false;
  if (forced?.timeout) {
    correct = false;
  } else if (question.kind === "next") {
    play.picked = forced?.choice ?? play.picked;
    if (!play.picked) return;
    correct = play.picked === question.answer;
  } else if (question.kind === "order" || question.kind === "lines" || question.kind === "sections") {
    if (forced?.orderFailed) {
      correct = false;
    } else {
      const order = ensureOrder();
      if (order.arranged.length !== question.tokens.length) return;
      correct = isOrderCorrect(question, order.arranged);
    }
  } else {
    const typed = document.getElementById("answer-input")?.value || play.typed || "";
    const guess = typed.trim() || (question.kind === "fill" ? play.picked || "" : "");
    if (!guess) {
      showPlayNote(question.kind === "fill" ? "Type or tap the missing word." : "Type the line.");
      return;
    }
    correct = answersMatch(question.answer, guess);
  }
  play.locked = true;
  stopTimer();
  play.answered += 1;
  if (correct) {
    play.combo += 1;
    play.correct += 1;
    play.bestCombo = Math.max(play.bestCombo, play.combo);
  } else {
    play.combo = 0;
    if (!forced?.orderFailed) play.hearts = Math.max(0, play.hearts - 1);
  }
  const secondsLeft = play.gameId === "concert" && play.deadline
    ? Math.max(0, (play.deadline - performance.now()) / 1000)
    : null;
  const points = pointsFor({ kind: question.kind, correct, combo: play.combo, secondsLeft });
  play.xp += points.xp;
  play.score += points.score;
  recordLineResult(progressOf(session.state), song, { line: question.line, correct, xpGain: points.xp });
  persist();
  const arranged = question.tokens
    ? question.tokens.map((token) => token.text).join(question.kind === "order" ? " " : "\n")
    : question.line;
  play.feedback = {
    correct,
    answer: arranged,
    xp: points.xp,
    timeout: Boolean(forced?.timeout)
  };
  blip(correct ? "ok" : "bad", session.state.settings.sound);
  if (navigator.vibrate) navigator.vibrate(correct ? 12 : [18, 30, 18]);
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
  if (play.hearts <= 0 || play.index >= play.questions.length - 1) {
    finishLesson();
    return;
  }
  play.index += 1;
  play.locked = false;
  play.feedback = null;
  play.picked = null;
  play.typed = "";
  play.order = null;
  play.deadline = null;
  stopTimer();
  render();
}

async function finishLesson() {
  const play = session.play;
  if (!play || play.finishing) return;
  play.finishing = true;
  stopTimer();
  const song = findSong(play.songId);
  const state = session.state;
  const progress = progressOf(state);
  const bonus = lessonBonus(play.answered, play.questions.length);
  if (bonus) {
    addBonusXp(progress, song, bonus);
    play.xp += bonus;
  }
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
    streak: streak.count,
    playerName: player.name
  };
  session.play = null;
  go("#/results");
}

function startTimer() {
  const play = session.play;
  if (timerId || !play || play.locked || play.gameId !== "concert" || session.route.name !== "play") return;
  if (!play.deadline) play.deadline = performance.now() + CONCERT_SECONDS * 1000;
  timerId = setInterval(() => {
    if (!session.play || session.play.locked) {
      stopTimer();
      return;
    }
    const left = session.play.deadline - performance.now();
    const bar = document.getElementById("timer-bar");
    const label = document.getElementById("timer-label");
    if (bar) bar.style.transform = `scaleX(${Math.max(0, left / (CONCERT_SECONDS * 1000))})`;
    if (label) label.textContent = `${Math.max(0, Math.ceil(left / 1000))}s`;
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
  startTimer();
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

function paintHearts() {
  const root = document.querySelector("[data-testid=hearts]");
  const play = session.play;
  if (!root || !play) return;
  root.setAttribute("aria-label", `${play.hearts} hearts left`);
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
    play.hearts = Math.max(0, play.hearts - 1);
    paintHearts();
    button.classList.add("is-reject");
    buzz(20);
    blip("bad", session.state.settings.sound);
    const failed = play.hearts <= 0;
    window.setTimeout(() => {
      if (session.play !== play) return;
      play.orderBusy = false;
      button.classList.remove("is-reject");
      if (failed) submitCurrent({ orderFailed: true });
    }, motionDelay());
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
    if (done) window.setTimeout(() => {
      if (session.play === play && !play.locked) submitCurrent({ orderComplete: true });
    }, motionDelay());
  }, motionDelay());
}

function onClick(event) {
  const clickTarget = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (clickTarget?.closest("[data-action=paste-clipboard]")) {
    readClipboardNow();
    return;
  }
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
  else if (action === "pick") {
    rememberTyped();
    const choice = currentQuestion()?.choices?.[Number(el.dataset.choice)];
    if (choice) session.play.picked = session.play.picked === choice ? null : choice;
    render();
  } else if (action === "choose") {
    const choice = currentQuestion()?.choices?.[Number(el.dataset.choice)];
    if (choice) submitCurrent({ choice });
  } else if (action === "pick-token") {
    judgePickedToken(el);
  } else if (action === "check") submitCurrent();
  else if (action === "continue") continueLesson();
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
  if (event.target.id === "lyrics") onLyricsInput(event);
  if (event.target.id === "title" || event.target.id === "artist") {
    if (session.form) session.form.titleTouched = true;
    updateFindLink();
  }
}

function onSubmit(event) {
  if (event.target.id === "answer-form") {
    event.preventDefault();
    submitCurrent();
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
