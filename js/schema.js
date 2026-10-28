// Versioned, idempotent migrations. Existing songs, scores, and rounds stay.

export const SCHEMA_VERSION = 2;

export function migrateState(state) {
  if (!state || typeof state !== "object") return state;
  let version = Number(state.schemaVersion) || 1;
  if (version < 2) version = migrateToRecallSchema(state);
  state.schemaVersion = version;
  return state;
}

function migrateToRecallSchema(state) {
  state.settings ||= {};
  state.settings.installPrompted = Boolean(state.settings.installPrompted);
  for (const progress of Object.values(state.progress || {})) {
    if (!progress || typeof progress !== "object") continue;
    progress.songs ||= {};
    for (const row of Object.values(progress.songs)) {
      if (!row || typeof row !== "object") continue;
      if (!row.recall || typeof row.recall !== "object" || Array.isArray(row.recall)) row.recall = {};
      if (!row.sectionState || typeof row.sectionState !== "object" || Array.isArray(row.sectionState)) row.sectionState = {};
    }
  }
  return 2;
}
