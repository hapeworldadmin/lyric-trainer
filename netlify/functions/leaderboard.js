import { getStore } from "@netlify/blobs";
import { handleLeaderboard } from "../../js/board-logic.js";

// Netlify fills in the Blobs site and token for this function. No env vars.

export function adaptStore(store) {
  return {
    async get(key) {
      return store.get(key, { type: "json", consistency: "strong" });
    },
    async set(key, value) {
      await store.setJSON(key, value);
    },
    async list(prefix) {
      const page = await store.list({ prefix });
      return (page?.blobs || []).map((blob) => blob.key);
    }
  };
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export default async function leaderboard(request, context) {
  let store;
  try {
    store = adaptStore(getStore({ name: "verse-board", consistency: "strong" }));
  } catch {
    return json({ error: "The board is not available." }, 503);
  }
  let body = null;
  if (request.method === "POST") {
    try {
      body = await request.json();
    } catch {
      return json({ error: "That score could not be read." }, 400);
    }
  }
  try {
    const url = new URL(request.url);
    const result = await handleLeaderboard({
      method: request.method,
      searchParams: url.searchParams,
      body,
      ip: typeof context?.ip === "string" ? context.ip : "",
      store,
      now: Date.now()
    });
    return json(result.body, result.status);
  } catch {
    return json({ error: "The board is not available." }, 503);
  }
}
