export function shareText(card) {
  const playerName = String(card.playerName || "You").trim() || "You";
  const title = String(card.title || "a song").trim();
  const score = Math.max(0, Math.round(Number(card.score) || 0));
  const streak = Math.max(0, Math.round(Number(card.streak) || 0));
  const days = `${streak} day${streak === 1 ? "" : "s"}`;
  if (card.kind === "concert") {
    const detail = card.detail ? ` ${card.detail}.` : "";
    return `${playerName} scored ${score} for ${title} in Know the Verse.${detail} Streak: ${days}.`;
  }
  const artist = String(card.artist || "").trim();
  const by = artist ? ` by ${artist}` : "";
  const detail = card.detail ? ` (${card.detail})` : "";
  return `${playerName} scored ${score} on "${title}"${by}${detail} in Know the Verse. Streak: ${days}.`;
}

export function drawShareCard(card) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  const band = card.kind === "concert" ? "#5e212f" : "#382b6f";
  const stripe = card.kind === "concert" ? "#ff4d6d" : "#7c5cff";
  ctx.fillStyle = "#0b0b0f";
  ctx.fillRect(0, 0, 1080, 1080);
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, 1080, 460);
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 452, 1080, 8);

  ctx.fillStyle = "#f5f5f7";
  ctx.font = "600 28px Inter, sans-serif";
  ctx.fillText("Know the Verse", 96, 120);

  ctx.font = "800 64px Inter Tight, Inter, sans-serif";
  const titleLines = wrapText(ctx, card.title || "Score", 888).slice(0, 2);
  titleLines.forEach((line, index) => ctx.fillText(line, 96, 230 + index * 80));

  ctx.fillStyle = "#f5f5f7";
  ctx.font = "800 148px Inter Tight, Inter, sans-serif";
  ctx.fillText(String(Math.max(0, Math.round(Number(card.score) || 0))), 96, 640);

  ctx.font = "600 36px Inter, sans-serif";
  ctx.fillStyle = "#a1a1aa";
  let y = 720;
  if (card.kind === "concert") {
    ctx.fillText("Concert score", 96, y);
    y += 56;
  } else if (card.artist) {
    const artistLines = wrapText(ctx, card.artist, 888).slice(0, 2);
    artistLines.forEach((line) => {
      ctx.fillText(line, 96, y);
      y += 52;
    });
  }
  const streak = Math.max(0, Math.round(Number(card.streak) || 0));
  const bits = [`${streak} day streak`, card.playerName || "You"];
  if (card.detail && card.kind === "concert") bits.unshift(card.detail);
  ctx.fillText(bits.join("   ·   "), 96, 960);

  const encoded = canvas.toDataURL("image/png").split(",")[1];
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "image/png" });
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}
