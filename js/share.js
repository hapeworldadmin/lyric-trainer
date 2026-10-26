export function shareText(card) {
  const playerName = String(card.playerName || "You").trim() || "You";
  const title = String(card.title || "a song").trim();
  const score = Math.max(0, Math.round(Number(card.score) || 0));
  const streak = Math.max(0, Math.round(Number(card.streak) || 0));
  const days = `${streak} day${streak === 1 ? "" : "s"}`;
  if (card.kind === "concert") {
    const detail = card.detail ? ` ${card.detail}.` : "";
    return `${playerName} scored ${score} for ${title} in Lyric Trainer.${detail} Streak: ${days}.`;
  }
  const artist = String(card.artist || "").trim();
  const by = artist ? ` by ${artist}` : "";
  const detail = card.detail ? ` (${card.detail})` : "";
  return `${playerName} scored ${score} on "${title}"${by}${detail} in Lyric Trainer. Streak: ${days}.`;
}

export function drawShareCard(card) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  const background = ctx.createLinearGradient(0, 0, 1080, 1080);
  background.addColorStop(0, "#2a1022");
  background.addColorStop(0.45, "#140810");
  background.addColorStop(1, "#3a2410");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1080, 1080);

  const spotlight = ctx.createRadialGradient(180, 0, 40, 180, 0, 520);
  spotlight.addColorStop(0, "rgba(255, 176, 32, 0.55)");
  spotlight.addColorStop(1, "rgba(255, 176, 32, 0)");
  ctx.fillStyle = spotlight;
  ctx.fillRect(0, 0, 1080, 1080);
  const pink = ctx.createRadialGradient(980, 160, 20, 980, 160, 420);
  pink.addColorStop(0, "rgba(255, 47, 134, 0.45)");
  pink.addColorStop(1, "rgba(255, 47, 134, 0)");
  ctx.fillStyle = pink;
  ctx.fillRect(0, 0, 1080, 1080);

  ctx.fillStyle = "#ffb020";
  ctx.font = "700 28px Nunito, sans-serif";
  ctx.fillText("LYRIC TRAINER", 96, 140);

  ctx.fillStyle = "#fff8ef";
  ctx.font = "800 84px Georgia, serif";
  const titleLines = wrapText(ctx, card.title || "Score", 888).slice(0, 3);
  titleLines.forEach((line, index) => ctx.fillText(line, 96, 280 + index * 92));

  let y = 300 + titleLines.length * 92;
  ctx.font = "700 36px Nunito, sans-serif";
  ctx.fillStyle = "#ffd7e6";
  if (card.kind === "concert") {
    ctx.fillText("Concert score", 96, y);
  } else if (card.artist) {
    const artistLines = wrapText(ctx, card.artist, 888).slice(0, 2);
    artistLines.forEach((line) => {
      ctx.fillText(line, 96, y);
      y += 48;
    });
  }

  ctx.fillStyle = "#fff8ef";
  ctx.font = "800 160px Georgia, serif";
  ctx.fillText(String(Math.max(0, Math.round(Number(card.score) || 0))), 96, 860);

  ctx.font = "700 32px Nunito, sans-serif";
  ctx.fillStyle = "#ffb020";
  const streak = Math.max(0, Math.round(Number(card.streak) || 0));
  const bits = [`${streak} day streak`, card.playerName || "You"];
  if (card.detail && card.kind === "concert") bits.unshift(card.detail);
  ctx.fillText(bits.join("   ·   "), 96, 940);

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
