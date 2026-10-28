import { comboMultiplier } from "./memory.js?v=16";
import { recallPrompt } from "./recall.js?v=16";
import { escapeHtml } from "./text.js?v=16";

function heartsHtml(play, icon) {
  return Array.from({ length: play.maxHearts }, (_, index) => (
    `<span class="heart ${index < play.hearts ? "" : "is-empty"}">${icon}</span>`
  )).join("");
}

function tileHtml(tile, index) {
  return `<button class="token" type="button" data-action="recall-tile" data-token="${escapeHtml(tile.id)}" data-option="${index}">${escapeHtml(tile.text)}</button>`;
}

export function recallPlayHtml(play) {
  const run = play.run;
  const question = play.question;
  if (run.status === "done" || run.status === "lost") return recallSummaryHtml(play);
  const label = recallPrompt(question);
  const previous = question?.previous
    ? `<p class="q-label">Previous line</p><div class="lyric-block is-context"><p class="lyric-line" data-testid="context-previous">${escapeHtml(question.previous)}</p></div>`
    : "";
  const cold = question?.cold
    ? `<p class="lyric-line" data-testid="cold-place">${escapeHtml(label)}</p>`
    : "";
  const hint = question?.hint ? `<p class="hint-line" data-testid="letter-hint">${escapeHtml(question.hint)}</p>` : "";
  const reveal = run.status === "reveal"
    ? `<p class="miss-flag" data-testid="miss-flag">Miss</p><div class="lyric-block"><p class="lyric-line" data-testid="correct-line">${escapeHtml(question?.answer || "")}</p></div>`
    : "";
  const heard = play.heard
    ? `<p class="hint" data-testid="heard-note">Heard: ${escapeHtml(play.heard)}</p>`
    : "";
  const notice = play.notice ? `<p class="hint" data-testid="recall-notice">${escapeHtml(play.notice)}</p>` : "";
  const answer = run.status === "reveal" ? "" : answerHtml(play);
  const hearts = heartsHtml({ hearts: run.hearts, maxHearts: run.maxHearts }, play.heartIcon || "");
  const screenClass = run.status === "reveal" ? " is-shake" : (play.flash ? " is-flash" : "");
  return `
    <section class="screen play-screen${screenClass}" data-testid="play">
      <div class="play-scroll">
        <div class="play-top">
          <button class="icon-btn" type="button" data-action="leave" data-testid="leave-lesson" aria-label="Close lesson">${play.closeIcon || ""}</button>
          <p class="play-crumb" data-testid="play-crumb">${escapeHtml(play.gameName)} · ${escapeHtml(label)}</p>
          <div class="play-meta">
            <span class="score-pill" data-testid="combo-pill" aria-label="Combo x${comboMultiplier(run.combo)}">x${comboMultiplier(run.combo)}</span>
            <span class="score-pill" data-testid="score-pill" aria-label="XP ${run.xp}">${run.xp} XP</span>
            <div class="hearts" data-testid="hearts" aria-label="${run.hearts} of ${run.maxHearts} hearts">${hearts}</div>
          </div>
        </div>
        ${play.relaxed ? "" : `<div class="tide" data-testid="tide" role="progressbar" aria-label="Time left" aria-valuemin="0" aria-valuemax="100"><span id="tide-bar"></span></div>`}
        ${play.paceLabel ? `<p class="pace" data-testid="pace">${escapeHtml(play.paceLabel)}</p><div class="pace-track" aria-hidden="true"><span class="${play.paceAhead ? "is-ahead" : "is-behind"}" style="transform:scaleX(${play.paceScale || 0.5})"></span></div>` : ""}
        ${play.ghostOffer ? `<button class="btn btn-text" type="button" data-action="race-leader" data-testid="race-leader">Race the leader</button>` : ""}
        <div class="play-body recall-body">
          ${previous}
          ${cold ? "" : `<p class="q-label" data-testid="question">${escapeHtml(label)}</p>`}
          ${cold}
          ${hint}
          ${reveal}
          ${heard}
          ${notice}
          <div class="recall-answer">${answer}</div>
        </div>
      </div>
    </section>`;
}

function answerHtml(play) {
  const question = play.question;
  const sing = play.singOn && question?.allowSing;
  if (play.rating) {
    return `
      <div class="lyric-block"><p class="lyric-line" data-testid="shown-line">${escapeHtml(question.answer)}</p></div>
      <div class="dock">
        <button class="btn btn-primary" type="button" data-action="recall-rate" data-rate="got" data-primary data-option="0">Got it</button>
        <button class="btn btn-secondary" type="button" data-action="recall-rate" data-rate="missed" data-option="1">Missed it</button>
      </div>`;
  }
  if (question.format === "choices") {
    return `<div class="choices">${question.choices.map((choice, index) => `
      <button class="choice" type="button" data-action="recall-choice" data-choice="${index}" data-option="${index}">${escapeHtml(choice)}</button>
    `).join("")}</div>`;
  }
  const placed = (play.placed || []).map((id) => question.tiles.find((tile) => tile.id === id)?.text || "").filter(Boolean);
  const target = question.solution.map((id, index) => {
    const text = placed[index];
    return text ? `<span class="target-word">${escapeHtml(text)}</span>` : `<span class="target-blank"></span>`;
  }).join(" ");
  const pool = question.tiles.filter((tile) => !(play.placed || []).includes(tile.id)).map((tile, index) => tileHtml(tile, index)).join("");
  const typing = play.answerMode === "type" ? `
    <form id="answer-form" class="sing-form" data-testid="type-form">
      <input class="sing-input" id="answer-input" data-testid="type-input" type="text" enterkeyhint="done" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Line" value="${escapeHtml(play.typed || "")}">
      <button class="btn btn-primary" type="submit" data-action="recall-type" data-primary>Check</button>
    </form>` : "";
  const mic = sing ? `<button class="mic-btn" type="button" data-action="recall-mic" data-testid="mic" aria-pressed="${play.listening ? "true" : "false"}" aria-label="${play.listening ? "Stop listening" : "Sing"}">${play.micIcon || ""}</button>` : "";
  const cant = sing ? `<button class="btn btn-text" type="button" data-action="recall-cant-sing" data-testid="cant-sing">Can't sing right now</button>` : "";
  const modeLink = question.allowType && play.answerMode !== "type"
    ? `<button class="btn btn-text" type="button" data-action="recall-type-mode" data-testid="type-instead">Type it instead</button>`
    : (question.allowType ? `<button class="btn btn-text" type="button" data-action="recall-tile-mode">Use tiles</button>` : "");
  const show = question.allowShow && play.answerMode !== "type"
    ? `<button class="btn btn-text" type="button" data-action="recall-show" data-testid="show-it">Show it</button>`
    : "";
  const retry = play.heard ? `<button class="btn btn-primary" type="button" data-action="recall-retry" data-primary data-testid="try-again">Try again</button>` : "";
  const tiles = play.answerMode === "type" ? "" : `
    <div class="lyric-block"><p class="target-line" data-testid="tile-line">${target}</p></div>
    <div class="pool">${pool}</div>`;
  return `${tiles}${typing}<div class="recall-tools">${mic}${modeLink}${show}${cant}</div>${retry}`;
}

export function recallSummaryHtml(play) {
  const run = play.run;
  const won = run.status === "done";
  const accuracy = run.answered ? Math.round((100 * run.correct) / run.answered) : 0;
  const missed = !won && play.lastMiss
    ? `<p class="lyric-line" data-testid="missed-line">${escapeHtml(play.lastMiss)}</p>`
    : "";
  const label = play.doneLabel || "Back to song";
  const action = play.doneAction || "recall-done";
  return `
    <section class="screen" data-testid="run-summary">
      <header class="page-head">
        <p class="kicker">${escapeHtml(play.doneKicker || (won ? "Run clear" : "Run over"))}</p>
        <h1>${run.xp} XP</h1>
        <p class="sub">${accuracy}% correct · ${run.hearts} hearts</p>
      </header>
      ${missed}
      <button class="btn btn-primary" type="button" data-action="${escapeHtml(action)}" data-primary data-testid="run-done">${escapeHtml(label)}</button>
    </section>`;
}
