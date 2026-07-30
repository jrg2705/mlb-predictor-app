// api/phase3-data.js — Next-level context for analyze (0 extra LLM tokens when formatted compact).
// 1) Park factors (static, runs index 100 = league average)
// 2) Team recent form L10 (W-L + RPG from schedule)
// 3) Starter rest days since last appearance

const MLB_BASE = "https://statsapi.mlb.com/api/v1";

/** Approximate runs park factor by home team id (100 = neutral). Source: multi-year public PF averages. */
const PARK_FACTOR_BY_TEAM_ID = {
  108: 98,  // Angels
  109: 102, // Diamondbacks
  110: 101, // Orioles
  111: 104, // Red Sox (Fenway)
  112: 100, // Cubs
  113: 103, // Reds
  114: 99,  // Guardians
  115: 112, // Rockies (Coors)
  116: 98,  // Tigers
  117: 99,  // Astros
  118: 101, // Royals
  119: 96,  // Dodgers
  120: 99,  // Nationals
  121: 95,  // Mets
  133: 96,  // Athletics
  134: 97,  // Pirates
  135: 94,  // Padres (Petco)
  136: 95,  // Mariners
  137: 96,  // Giants
  138: 98,  // Cardinals
  139: 97,  // Rays
  140: 101, // Rangers
  141: 100, // Blue Jays
  142: 101, // Twins
  143: 99,  // Phillies
  144: 101, // Braves
  145: 100, // White Sox
  146: 97,  // Marlins
  147: 102, // Yankees
  158: 101, // Brewers
};

export function getParkFactor(homeTeamId) {
  const pf = PARK_FACTOR_BY_TEAM_ID[homeTeamId] ?? 100;
  let note = "parque neutral";
  if (pf >= 108) note = "parque muy ofensivo (infla carreras/HCE)";
  else if (pf >= 103) note = "parque ofensivo leve";
  else if (pf <= 95) note = "parque muy pitcher-friendly (baja totales)";
  else if (pf <= 98) note = "parque pitcher-friendly leve";
  return { factor: pf, note };
}

function fmtDate(d) {
  return d.toISOString().split("T")[0];
}

/**
 * Last 10 completed games for a team: W-L and runs per game scored/allowed.
 */
export async function fetchTeamRecentForm(teamId, lastN = 10) {
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 25); // enough window to collect 10 finals

    const res = await fetch(
      `${MLB_BASE}/schedule?sportId=1&teamId=${teamId}&startDate=${fmtDate(start)}&endDate=${fmtDate(end)}&gameType=R`
    );
    const data = await res.json();
    const games = (data?.dates?.flatMap((d) => d.games) || [])
      .filter((g) => g.status?.abstractGameState === "Final")
      .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate))
      .slice(0, lastN);

    if (games.length === 0) {
      return { games: 0, wins: 0, losses: 0, record: "0-0", rpgScored: null, rpgAllowed: null };
    }

    let wins = 0;
    let losses = 0;
    let runsScored = 0;
    let runsAllowed = 0;

    for (const g of games) {
      const isHome = g.teams?.home?.team?.id === teamId;
      const my = isHome ? g.teams.home : g.teams.away;
      const opp = isHome ? g.teams.away : g.teams.home;
      const myRuns = my?.score ?? 0;
      const oppRuns = opp?.score ?? 0;
      runsScored += myRuns;
      runsAllowed += oppRuns;
      if (my?.isWinner) wins++;
      else losses++;
    }

    const n = games.length;
    return {
      games: n,
      wins,
      losses,
      record: `${wins}-${losses}`,
      rpgScored: Math.round((runsScored / n) * 10) / 10,
      rpgAllowed: Math.round((runsAllowed / n) * 10) / 10,
    };
  } catch {
    return { games: 0, wins: 0, losses: 0, record: "N/A", rpgScored: null, rpgAllowed: null };
  }
}

/**
 * Days since pitcher's last regular-season appearance (from game log).
 * Returns null if unknown / no log.
 */
export async function fetchPitcherRestDays(pitcherId) {
  if (!pitcherId) return null;
  try {
    const season = new Date().getFullYear();
    const res = await fetch(
      `${MLB_BASE}/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${season}&gameType=R`
    );
    const data = await res.json();
    const splits = data?.stats?.[0]?.splits || [];
    if (splits.length === 0) return { restDays: null, lastDate: null, note: "sin log de salidas" };

    // splits are typically chronological; take the most recent with a date
    const withDate = splits
      .map((s) => s.date)
      .filter(Boolean)
      .sort();
    const lastDate = withDate[withDate.length - 1];
    if (!lastDate) return { restDays: null, lastDate: null, note: "sin fecha de última salida" };

    const last = new Date(lastDate + "T12:00:00Z");
    const today = new Date();
    const restDays = Math.max(
      0,
      Math.floor((today.getTime() - last.getTime()) / (24 * 60 * 60 * 1000))
    );

    let note = "rest normal";
    if (restDays <= 3) note = "rest corto (posible fatiga / menos K proyectados)";
    else if (restDays >= 7) note = "rest largo (posible oxidación o boost fresco)";

    return { restDays, lastDate, note };
  } catch {
    return { restDays: null, lastDate: null, note: "rest no disponible" };
  }
}

/**
 * Fetch all phase-3 context for a matchup in parallel.
 */
export async function fetchPhase3Context({
  homeId,
  awayId,
  homePitcherId,
  awayPitcherId,
}) {
  const park = getParkFactor(homeId);
  const [homeForm, awayForm, homeRest, awayRest] = await Promise.all([
    fetchTeamRecentForm(homeId, 10),
    fetchTeamRecentForm(awayId, 10),
    fetchPitcherRestDays(homePitcherId),
    fetchPitcherRestDays(awayPitcherId),
  ]);

  return {
    park,
    homeForm,
    awayForm,
    homePitcherRest: homeRest,
    awayPitcherRest: awayRest,
  };
}

/**
 * Compact block for the LLM prompt.
 */
export function formatPhase3ForPrompt(ctx, home, away) {
  if (!ctx) return "";

  const lines = ["CONTEXTO FASE 3 (ajusta totales/K/F5 con esto; no ignores parque ni forma):"];

  if (ctx.park) {
    lines.push(`- Parque (local ${home}): PF ${ctx.park.factor} — ${ctx.park.note}`);
  }

  if (ctx.homeForm?.games > 0 || ctx.awayForm?.games > 0) {
    const hf = ctx.homeForm;
    const af = ctx.awayForm;
    lines.push(
      `- Forma L10: ${home} ${hf.record} (RPG ${hf.rpgScored ?? "?"} a favor / ${hf.rpgAllowed ?? "?"} en contra) | ${away} ${af.record} (RPG ${af.rpgScored ?? "?"}/${af.rpgAllowed ?? "?"})`
    );
  }

  const hr = ctx.homePitcherRest;
  const ar = ctx.awayPitcherRest;
  if (hr || ar) {
    const hPart =
      hr?.restDays != null
        ? `${home} abridor: ${hr.restDays}d rest (${hr.note})`
        : `${home} abridor: rest N/A`;
    const aPart =
      ar?.restDays != null
        ? `${away} abridor: ${ar.restDays}d rest (${ar.note})`
        : `${away} abridor: rest N/A`;
    lines.push(`- Rest abridores: ${hPart} | ${aPart}`);
  }

  return lines.join("\n") + "\n";
}
