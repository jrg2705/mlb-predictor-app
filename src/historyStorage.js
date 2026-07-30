// src/historyStorage.js — History persistence with correct local-day deduplication

export const HISTORY_KEY = "mlb_predictor_history";
export const MAX_HISTORY = 30;

/** Local calendar day YYYY-MM-DD (user timezone), not UTC. */
export function toLocalDay(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save an analysis entry. Replaces any existing entry for the same matchup
 * on the same *local* calendar day (or same gamePk when available).
 */
export function saveToHistory(entry) {
  try {
    const current = loadHistory();
    const entryDay = toLocalDay(entry.date);
    const entryPk = entry.gamePk || null;

    const filtered = current.filter((e) => {
      // Same specific game (doubleheader-safe)
      if (entryPk && e.gamePk && e.gamePk === entryPk) return false;

      const sameDay = toLocalDay(e.date) === entryDay;
      const sameMatchup = e.home === entry.home && e.away === entry.away;
      // Without gamePk, one entry per matchup per local day
      if (!entryPk && sameDay && sameMatchup) return false;

      return true;
    });

    const updated = [entry, ...filtered].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return loadHistory();
  }
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}
