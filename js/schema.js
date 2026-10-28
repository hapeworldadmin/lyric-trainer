// Versioned, idempotent migrations. Existing songs, scores, and rounds stay.

export const SCHEMA_VERSION = 3;

export function migrateState(state) {
  if (!state || typeof state !== "object") return state;
  let version = Number(state.schemaVersion) || 1;
  if (version < 2) version = migrateToRecallSchema(state);
  if (version < 3) version = migrateToAnswerSettings(state);
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

function migrateToAnswerSettings(state) {
  state.settings ||= {};
  if (state.settings.sing !== true) state.settings.sing = false;
  state.settings.singWarned = Boolean(state.settings.singWarned);
  state.settings.cantSing = Boolean(state.settings.cantSing);
  if (state.settings.answerMode !== "type") state.settings.answerMode = "tiles";
  return 3;
}
