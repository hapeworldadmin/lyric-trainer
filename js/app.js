import { blip } from "./audio.js";
import { activeConcertSummary, concertsForSong, leaderboardFromSongScores, normalizeConcerts } from "./concerts.js";
import {
  CONCERT_SECONDS,
  GAMES,
  answersMatch,
  buildLesson,
  gameAvailability,
  isOrderCorrect,
  lessonBonus,
  pointsFor
} from "./games.js";
import { analyzePaste, searchLyricsUrl } from "./parse.js";
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
} from "./progress.js";
import { SAMPLE_SONG } from "./sample.js";
import { createScoreProvider, sanitizeRun } from "./scores.js";
import { drawShareCard, shareText } from "./share.js";
import {
  activePlayer,
  activeProgress as progressOf,
  blankState,
  loadState,
  sampleRecord,
  saveState,
  seedSample
} from "./storage.js";
import { clip, escapeHtml, normalizeAnswer, songKey, songsMatch, uid } from "./text.js";

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
    session.concertsError = "Concerts could not be loaded. Open Lyric Trainer through a local server or GitHub Pages.";
  }
  window.addEventListener("hashchange", sync);
  document.addEventListener("click", onClick);
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

function shell(body, { play }) {
  return `
    <div class="glow glow-a"></div>
    <div class="glow glow-b"></div>
    <div class="app ${play ? "is-play" : ""}">
      ${play ? "" : topbar()}
      ${play ? "" : '<div class="bulbs" aria-hidden="true"></div>'}
      <main>${body}</main>
      ${play || session.route.name === "results" ? "" : tabbar()}
    </div>
    ${modalHtml()}
    ${session.toast ? `<p class="toast" role="status">${escapeHtml(session.toast)}</p>` : ""}
  `;
}

function topbar() {
  const progress = progressOf(session.state);
  const streak = progress.streak?.count || 0;
  return `
    <header class="topbar">
      <a class="brand" href="#/">${mark()} Lyric Trainer</a>
      <div class="pills">
        <span class="pill" data-testid="streak-count">${icon("flame")} ${streak}</span>
        <span class="pill" data-testid="xp-total">${formatScore(progress.totalXp)} XP</span>
      </div>
    </header>
  `;
}

function mark() {
  return `<span class="mark">${icon("note")}</span>`;
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
  const player = activePlayer(session.state);
  const songs = [...session.state.songs].sort((a, b) => b.updatedAt - a.updatedAt);
  const concert = session.concerts[0];
  const privacy = session.state.settings.privacySeen ? "" : `
    <aside class="banner">
      <p>Lyrics you paste never leave this browser.</p>
      <button class="btn btn-quiet" type="button" data-action="dismiss-privacy">Got it</button>
    </aside>`;
  const teaser = concert ? `
    <a class="teaser" href="#/concert/${encodeURIComponent(concert.id)}">
      <p class="kicker">Concert</p>
      <strong>${escapeHtml(concert.name)}</strong>
      <span>${concert.setlist.length ? `${concert.setlist.length} on the setlist` : "Setlist not posted yet"}</span>
    </a>` : "";
  const list = songs.length ? songs.map(songCard).join("") : `
    <div class="empty">
      <p>No songs on this device yet.</p>
      <button class="btn btn-ghost" type="button" data-action="restore-sample">Restore the sample song</button>
    </div>`;
  return `
    <section class="screen">
      ${privacy}
      <p class="eyebrow">${greeting()}</p>
      <h1>${escapeHtml(player.name)}</h1>
      <p class="lede">Short lessons for lyrics you paste yourself.</p>
      <a class="btn btn-primary btn-xl" href="#/add" data-testid="add-song">${icon("plus")} Add song</a>
      ${teaser}
      <h2>Your songs</h2>
      <div data-testid="song-list">${list}</div>
    </section>
  `;
}

function songCard(song) {
  const stats = songStats(progressOf(session.state), song);
  return `
    <a class="ticket" href="#/song/${encodeURIComponent(song.id)}" data-testid="song-card">
      <div class="ticket-body">
        ${song.sample ? '<span class="badge">Sample</span>' : ""}
        <h3>${escapeHtml(song.title)}</h3>
        <p class="artist">${escapeHtml(song.artist)}</p>
        ${meter(stats.masteryPercent)}
        <p class="meta" data-testid="mastery">${stats.masteryPercent}% mastery · ${stats.bestScore ? `Best ${formatScore(stats.bestScore)}` : "No score yet"}</p>
      </div>
      <div class="ticket-stub">Play</div>
    </a>
  `;
}

function viewForm() {
  const form = session.form;
  const editing = Boolean(form.songId);
  const parsed = analyzePaste(form.raw || "", { detectTitle: !(form.lockMeta || form.rejectDetection) });
  const showFields = titleFieldsVisible(parsed);
  return `
    <section class="screen">
      <div class="screen-head">
        <a class="back" href="${editing ? `#/song/${encodeURIComponent(form.songId)}` : "#/"}">${icon("back")} Back</a>
        <h1>${editing ? "Edit song" : "Add a song"}</h1>
        <p class="lede">${form.fromConcert ? "Paste lyrics for this setlist slot. They stay on this device." : "One paste. We tidy section labels and site junk."}</p>
      </div>
      <div class="stack">
        <label class="field">Lyrics
          <textarea id="lyrics" data-testid="lyrics" spellcheck="false" placeholder="Paste lyrics here. A first line like Title - Artist is picked up automatically.">${escapeHtml(form.raw || "")}</textarea>
        </label>
        <div id="paste-status">${pasteStatusHtml(parsed)}</div>
        <div id="detect-chip">${detectChipHtml(parsed)}</div>
        <div id="title-fields" class="stack" ${showFields ? "" : "hidden"}>
          ${form.fromConcert ? '<p class="hint">Keep this title and artist so the setlist can link.</p>' : ""}
          <label class="field">Title
            <input id="title" data-testid="title" type="text" maxlength="120" autocomplete="off" value="${escapeHtml(form.title || "")}">
          </label>
          <label class="field">Artist
            <input id="artist" data-testid="artist" type="text" maxlength="120" autocomplete="off" value="${escapeHtml(form.artist || "")}">
          </label>
        </div>
        <a class="btn btn-ghost" id="find-lyrics" data-testid="find-lyrics" href="#" target="_blank" rel="noopener noreferrer">Find lyrics</a>
        <p class="hint">Opens a web search in a new tab. Lyric Trainer does not download it.</p>
        <p id="form-error" class="error" role="alert">${escapeHtml(form.error || "")}</p>
        <button class="btn btn-primary" type="button" data-action="save-song" data-testid="save-song">Save song</button>
        ${editing ? `<button class="btn btn-danger" type="button" data-action="ask-delete" data-id="${escapeHtml(form.songId)}">Delete song</button>` : ""}
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
  const availability = gameAvailability(song.lines);
  const reasons = {
    fill: "Needs a line with a word to hide",
    order: "Needs a line with at least 3 words",
    next: "Needs at least 3 lines",
    letters: "Needs a line to hint",
    concert: "Needs a line to perform"
  };
  const games = GAMES.map((game) => {
    if (!availability[game.id]) {
      return `<button class="game ${game.id === "concert" ? "is-concert" : ""}" type="button" disabled><span>${escapeHtml(game.name)}<small>${reasons[game.id]}</small></span></button>`;
    }
    return `
      <a class="game ${game.id === "concert" ? "is-concert" : ""}" data-testid="game-${game.id}" href="#/play/${encodeURIComponent(song.id)}/${game.id}">
        <span>${escapeHtml(game.name)}<small>${escapeHtml(game.detail)}</small></span>
        <span aria-hidden="true">›</span>
      </a>
    `;
  }).join("");
  const concerts = concertsForSong(session.concerts, song.title, song.artist);
  const links = concerts.map((concert) => `<a class="text-link" href="#/concert/${encodeURIComponent(concert.id)}">${escapeHtml(concert.name)}</a>`).join("");
  return `
    <section class="screen">
      <div class="screen-head">
        <a class="back" href="#/">${icon("back")} Songs</a>
        ${song.sample ? '<span class="badge">Sample</span>' : ""}
        <h1>${escapeHtml(song.title)}</h1>
        <p class="artist">${escapeHtml(song.artist)}</p>
      </div>
      <div class="stat-row">
        <div class="stat"><strong data-testid="song-mastery">${stats.masteryPercent}%</strong><span>mastery</span></div>
        <div class="stat"><strong>${stats.linesMastered}/${stats.lineCount}</strong><span>lines mastered</span></div>
        <div class="stat"><strong>${stats.bestScore ? formatScore(stats.bestScore) : "—"}</strong><span>best score</span></div>
      </div>
      ${meter(stats.masteryPercent)}
      ${links ? `<p class="hint">On the setlist: ${links}</p>` : ""}
      <h2>Lessons</h2>
      <div class="game-list">${games}</div>
      <div class="stack" style="margin-top:16px">
        <a class="btn btn-quiet" href="#/edit/${encodeURIComponent(song.id)}">Edit lyrics</a>
        <button class="btn btn-danger" type="button" data-action="ask-delete" data-id="${escapeHtml(song.id)}">Delete song</button>
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
  return `
    <section class="screen" data-testid="play">
      <div class="play-top">
        <button class="icon-btn" type="button" data-action="leave" data-testid="leave-lesson" aria-label="Close lesson">${icon("close")}</button>
        <div class="lesson-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${shown}" data-testid="lesson-progress">
          <span style="width:${width}%"></span>
        </div>
        <div class="hearts" data-testid="hearts" aria-label="${play.hearts} hearts left">${hearts}</div>
      </div>
      <p class="eyebrow">${escapeHtml(play.gameName)}</p>
      <p class="ask">${play.index + 1} / ${total}${play.combo >= 2 ? ` · ${play.combo} in a row` : ""}</p>
      ${timer}
      ${questionHtml(question)}
      ${play.feedback ? feedbackHtml(play) : answerControls(question)}
    </section>
  `;
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
  return `<p class="ask" data-testid="question">Tap the words in order</p>`;
}

function answerControls(question) {
  if (question.kind === "next") {
    return `<div class="choices">${question.choices.map((choice, index) => `
      <button class="choice" type="button" data-action="choose" data-choice="${index}">${escapeHtml(choice)}</button>
    `).join("")}</div>`;
  }
  if (question.kind === "order") {
    const order = ensureOrder();
    const byId = new Map(question.tokens.map((token) => [token.id, token.text]));
    const chips = (ids, action) => ids.map((id) => `
      <button class="token" type="button" data-action="${action}" data-token="${escapeHtml(id)}">${escapeHtml(byId.get(id) || "")}</button>
    `).join("");
    return `
      <div class="tray" data-testid="tray">${chips(order.arranged, "unpick-token") || '<span class="hint">Your line appears here</span>'}</div>
      <div class="pool">${chips(order.pool, "pick-token")}</div>
      <div class="dock"><button class="btn btn-primary" type="button" data-action="check" data-testid="check">Check</button></div>
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
  const praise = feedback.correct ? ["Encore", "Nailed it", "That's the line", "Spotlight"][play.correct % 4] : (feedback.timeout ? "Time's up" : "Not quite");
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
    .map((concert) => `<a class="btn btn-quiet" href="#/concert/${encodeURIComponent(concert.id)}">${escapeHtml(concert.name)}</a>`)
    .join("");
  return `
    <section class="screen">
      <p class="eyebrow">${results.newBest ? "New best" : "Lesson complete"}</p>
      <h1 data-testid="final-score">${formatScore(results.score)}</h1>
      <p class="lede">${escapeHtml(results.title)} · ${escapeHtml(results.artist)}</p>
      <div class="stat-row">
        <div class="stat"><strong>${results.xp}</strong><span>XP earned</span></div>
        <div class="stat"><strong>${results.accuracy}%</strong><span>accuracy</span></div>
        <div class="stat"><strong data-testid="result-streak">${results.streak}</strong><span>day streak</span></div>
      </div>
      <p class="hint">${results.linesMastered} of ${results.lineCount} lines mastered · ${results.masteryPercent}% mastery</p>
      <div class="stack">
        <button class="btn btn-gold" type="button" data-action="share-results" data-testid="share-score">Share my score</button>
        <a class="btn btn-primary" href="#/play/${encodeURIComponent(results.songId)}/${results.gameId}">Practice again</a>
        <a class="btn btn-ghost" href="#/song/${encodeURIComponent(results.songId)}">Back to song</a>
        ${concerts}
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
    const progressLabel = summary.total ? `${summary.mastered}/${summary.total} mastered` : "Setlist not posted";
    return `
      <a class="ticket" href="#/concert/${encodeURIComponent(concert.id)}" data-testid="concert-card">
        <div class="ticket-body">
          <p class="kicker">Concert</p>
          <h3>${escapeHtml(concert.name)}</h3>
          ${concert.label ? `<p class="artist">${escapeHtml(concert.label)}</p>` : ""}
          <p class="meta">${progressLabel}${summary.total ? ` · Score ${formatScore(summary.score)}` : ""}</p>
        </div>
        <div class="ticket-stub">Open</div>
      </a>
    `;
  }).join("");
  return `
    <section class="screen">
      <p class="eyebrow">Setlists</p>
      <h1>Concerts</h1>
      <p class="lede">A concert is a folder of song titles. Paste lyrics in the app when a slot needs them.</p>
      ${cards || '<p class="empty">No concerts yet.</p>'}
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
  const fraction = summary.total ? `${summary.mastered}/${summary.total}` : "—";
  const score = summary.total ? formatScore(summary.score) : "—";
  const setlist = summary.total ? summary.slots.map((slot) => setlistRow(concert, slot)).join("") : `
    <div class="panel">
      <h2>Setlist not posted</h2>
      <p>Add title and artist pairs to <strong>concerts.json</strong>. Leave lyrics out of that file and paste them here when you want to practice.</p>
    </div>
  `;
  const rows = board.length ? board.map((row, index) => `
    <article class="board-row">
      <span class="rank">${index + 1}</span>
      <div><strong>${escapeHtml(row.playerName)}</strong><span class="sub">${row.played} of ${row.total} scored</span></div>
      <span class="score">${formatScore(row.score)}</span>
    </article>
  `).join("") : `<p class="empty">No scores on this concert yet.</p>`;
  return `
    <section class="screen" data-testid="concert-page">
      <div class="screen-head">
        <a class="back" href="#/concerts">${icon("back")} Concerts</a>
        <p class="eyebrow">Concert</p>
        <h1>${escapeHtml(concert.name)}</h1>
        ${concert.label ? `<p class="lede" data-testid="concert-label">${escapeHtml(concert.label)}</p>` : ""}
        ${concert.source ? `<p class="hint"><a class="text-link" data-testid="concert-source" href="${escapeHtml(concert.source)}" target="_blank" rel="noopener noreferrer">Source setlist</a></p>` : ""}
      </div>
      <div class="stat-grid">
        <div class="stat"><strong data-testid="concert-mastered">${fraction}</strong><span>songs mastered</span></div>
        <div class="stat"><strong data-testid="concert-score">${score}</strong><span>your score</span></div>
        <div class="stat"><strong data-testid="participants">${participants}</strong><span>${playerNoun} ${where}</span></div>
      </div>
      <h2>Setlist</h2>
      <div data-testid="setlist">${setlist}</div>
      <h2>Leaderboard</h2>
      <p class="footnote" data-testid="leaderboard-source">${escapeHtml(provider.sourceLabel)}. A shared board can plug in later with name, concert, title, artist, and score.</p>
      <div data-testid="concert-board">${rows}</div>
      ${summary.score > 0 ? `<div class="dock"><button class="btn btn-gold" type="button" data-action="share-concert" data-id="${escapeHtml(concert.id)}">Share concert score</button></div>` : ""}
    </section>
  `;
}

function setlistRow(concert, slot) {
  const action = slot.status === "needs-lyrics"
    ? `<a class="btn btn-primary btn-small" data-testid="paste-lyrics" href="#/add?title=${encodeURIComponent(slot.title)}&artist=${encodeURIComponent(slot.artist)}&concert=${encodeURIComponent(concert.id)}">Paste lyrics</a>`
    : `<a class="btn btn-primary btn-small" href="#/song/${encodeURIComponent(slot.songId)}">Practice</a>`;
  const status = slot.status === "needs-lyrics"
    ? `<em class="needs" data-testid="needs-lyrics">Needs lyrics</em>`
    : `${meter(slot.masteryPercent)}<span class="sub">${slot.masteryPercent}% · best ${formatScore(slot.bestScore)}</span>`;
  return `
    <article class="slot" data-testid="setlist-slot">
      <span class="num">${slot.index + 1}</span>
      <div class="slot-main">
        <strong>${escapeHtml(slot.title)}</strong>
        <span class="sub">${escapeHtml(slot.artist)}</span>
        ${status}
      </div>
      ${action}
    </article>
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
    <article class="board-row" data-testid="board-row">
      <span class="rank">${index + 1}</span>
      <div>
        <strong>${escapeHtml(run.playerName)}</strong>
        <span class="sub">${escapeHtml(run.songTitle)} · ${escapeHtml(run.songArtist)} · ${escapeHtml(gameName(run.gameId))}</span>
      </div>
      <span class="score">${formatScore(run.score)}</span>
    </article>
  `).join("") : `<p class="empty">Finish a lesson to post a score on this device.</p>`;
  return `
    <section class="screen">
      <p class="eyebrow">${escapeHtml(provider.sourceLabel)}</p>
      <h1>Leaderboard</h1>
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
          <span class="sub">${formatScore(state.progress[item.id]?.totalXp || 0)} XP</span>
        </div>
        <div class="row">
          ${active ? "" : `<button class="btn btn-quiet btn-small" type="button" data-action="switch-player" data-id="${escapeHtml(item.id)}">Play as</button>`}
          <button class="btn btn-quiet btn-small" type="button" data-action="start-rename" data-id="${escapeHtml(item.id)}">Rename</button>
          <button class="btn btn-quiet btn-small" type="button" data-action="ask-delete-player" data-id="${escapeHtml(item.id)}">Remove</button>
        </div>
      </article>
    `;
  }).join("");
  return `
    <section class="screen">
      <p class="eyebrow">This device</p>
      <h1>${escapeHtml(player.name)}</h1>
      <div class="stat-row">
        <div class="stat"><strong>${formatScore(progress.totalXp)}</strong><span>total XP</span></div>
        <div class="stat"><strong>${progress.streak?.count || 0}</strong><span>day streak</span></div>
        <div class="stat"><strong>${practiced}</strong><span>songs scored</span></div>
      </div>
      <p class="hint">Songs are shared on this device. Scores, streaks, and XP belong to the active player.</p>
      <h2>Players</h2>
      <form id="player-form" class="stack">
        <label class="field">New player
          <input id="player-name" data-testid="player-name" type="text" maxlength="40" placeholder="Name" autocomplete="off">
        </label>
        <button class="btn btn-primary" type="submit">Add player</button>
      </form>
      <div>${players}</div>
      <h2>Progress file</h2>
      <p class="hint">Export is scores, mastery counts, and streaks only. It does not include lyrics.</p>
      <div class="stack">
        <button class="btn btn-gold" type="button" data-action="export-progress" data-testid="export-progress">Export progress</button>
        <button class="btn btn-ghost" type="button" data-action="pick-import" data-testid="import-progress">Import progress</button>
        <input id="import-file" type="file" accept="application/json,.json" hidden>
        <button class="btn btn-ghost" type="button" data-action="toggle-sound">${state.settings.sound ? "Sound on" : "Sound off"}</button>
        <button class="btn btn-ghost" type="button" data-action="restore-sample">Restore sample song</button>
        <button class="btn btn-danger" type="button" data-action="ask-erase">Erase everything on this device</button>
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
      raw: song.lines.join("\n"),
      fromConcert: ""
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
    fromConcert: route.params.concert || ""
  };
}

function onLyricsInput() {
  const lyrics = document.getElementById("lyrics");
  if (!lyrics || !session.form) return;
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
  const parsed = analyzePaste(form.raw, { detectTitle: !(form.lockMeta || form.rejectDetection) });
  const showFields = titleFieldsVisible(parsed);
  const title = clip(showFields ? form.title : parsed.title, 120);
  const artist = clip(showFields ? form.artist : parsed.artist, 120);
  const lines = parsed.lines.map((line) => clip(line, 300)).filter(Boolean).slice(0, 400);
  if (!normalizeAnswer(title) || !normalizeAnswer(artist)) {
    form.error = "Add a title and an artist.";
    if (!showFields) form.forceFields = true;
    if (!showFields) render();
    else showFormError(form.error);
    return;
  }
  if (lines.length < 2) {
    form.error = "Keep at least two lyric lines.";
    showFormError(form.error);
    return;
  }
  form.error = "";
  const state = session.state;
  const existing = state.songs.find((song) => songKey(song.title, song.artist) === songKey(title, artist));
  let song;
  if (form.songId) {
    song = findSong(form.songId);
    if (!song) return go("#/");
    if (existing && existing.id !== song.id) {
      showFormError("Another saved song already uses that title and artist.");
      return;
    }
    const previousLines = [...song.lines];
    const oldTitle = song.title;
    const oldArtist = song.artist;
    song.title = title;
    song.artist = artist;
    song.lines = lines;
    song.updatedAt = Date.now();
    if (song.sample && (oldTitle !== title || oldArtist !== artist || previousLines.join("\n") !== lines.join("\n"))) song.sample = false;
    retitleSongProgress(state.progress, oldTitle, oldArtist, title, artist);
    resetLineMasteryIfChanged(state.progress, title, artist, previousLines, lines);
  } else if (existing) {
    const previousLines = [...existing.lines];
    existing.lines = lines;
    existing.updatedAt = Date.now();
    if (existing.sample && previousLines.join("\n") !== lines.join("\n")) existing.sample = false;
    resetLineMasteryIfChanged(state.progress, existing.title, existing.artist, previousLines, lines);
    song = existing;
  } else {
    song = { id: uid(), title, artist, lines, sample: false, createdAt: Date.now(), updatedAt: Date.now() };
    state.songs.push(song);
  }
  persist();
  const dest = form.fromConcert ? `#/concert/${encodeURIComponent(form.fromConcert)}` : `#/song/${encodeURIComponent(song.id)}`;
  session.form = null;
  armToast("Saved on this device.");
  go(dest);
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
  if (!gameAvailability(song.lines)[game.id]) {
    armToast("That game needs more lines in this song.");
    go(`#/song/${encodeURIComponent(song.id)}`);
    return false;
  }
  const key = `${song.id}:${game.id}`;
  if (session.play?.key === key) return true;
  const questions = buildLesson(song.lines, game.id);
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
  } else if (question.kind === "order") {
    const order = ensureOrder();
    if (order.arranged.length !== question.tokens.length) {
      showPlayNote("Tap every word into the line.");
      return;
    }
    correct = isOrderCorrect(question, order.arranged);
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
    play.hearts = Math.max(0, play.hearts - 1);
  }
  const secondsLeft = play.gameId === "concert" && play.deadline
    ? Math.max(0, (play.deadline - performance.now()) / 1000)
    : null;
  const points = pointsFor({ kind: question.kind, correct, combo: play.combo, secondsLeft });
  play.xp += points.xp;
  play.score += points.score;
  recordLineResult(progressOf(session.state), song, { line: question.line, correct, xpGain: points.xp });
  persist();
  play.feedback = {
    correct,
    answer: question.line,
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
    <div class="row">
      <button class="btn btn-quiet" type="button" data-action="copy-share">Copy text</button>
      ${modal.share.url ? `<a class="btn btn-gold" href="${modal.share.url}" download="lyric-trainer-score.png">Save image</a>` : ""}
    </div>
  ` : `<p>${escapeHtml(modal.body || "")}</p>`;
  return `
    <dialog class="modal">
      <div class="modal-card">
        <h2>${escapeHtml(modal.title || "")}</h2>
        ${share}
        <div class="row">
          ${modal.confirmLabel === "Close" ? "" : `<button class="btn btn-quiet" type="button" data-action="cancel-modal">Back</button>`}
          <button class="btn ${modal.danger ? "btn-danger" : "btn-primary"}" type="button" data-action="confirm-modal">${escapeHtml(modal.confirmLabel || "OK")}</button>
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
  startTimer();
}

function onClick(event) {
  const finder = event.target.closest("#find-lyrics");
  if (finder?.dataset.disabled === "true") {
    event.preventDefault();
    showFormError("Add a title and artist first.");
    return;
  }
  const el = event.target.closest("[data-action]");
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
  else if (action === "ask-delete") askDelete(el.dataset.id);
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
    const order = ensureOrder();
    const id = el.dataset.token;
    if (!order.pool.includes(id)) return;
    order.pool = order.pool.filter((item) => item !== id);
    order.arranged.push(id);
    render();
  } else if (action === "unpick-token") {
    const order = ensureOrder();
    const id = el.dataset.token;
    order.arranged = order.arranged.filter((item) => item !== id);
    order.pool.push(id);
    render();
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
  if (event.target.id === "lyrics") onLyricsInput();
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

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

boot();
