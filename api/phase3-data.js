// api/phase3-data.js — Next-level context for analyze (compact prompt blocks).
// 1) Park factors (static, runs index 100 = league average)
// 2) Team recent form L10 (W-L + RPG from schedule)
// 3) Starter rest days since last appearance
// 4) Home/away splits (W-L from standings + OPS/ERA when API provides them)

const MLB_BASE = "https://statsapi.mlb.com/api/v1";

/** Approximate runs park factor by home team id (100 = neutral). */
const PARK_FACTOR_BY_TEAM_ID = {
  108: 98, 109: 102, 110: 101, 111: 104, 112: 100, 113: 103, 114: 99,
  115: 112, 116: 98, 117: 99, 118: 101, 119: 96, 120: 99, 121: 95,
  133: 96, 134: 97, 135: 94, 136: 95, 137: 96, 138: 98, 139: 97,
  140: 101, 141: 100, 142: 101, 143: 99, 144: 101, 145: 100, 146: 97,
  147: 102, 158: 101,
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

export async function fetchTeamRecentForm(teamId, lastN = 10) {
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 25);

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

    let wins = 0, losses = 0, runsScored = 0, runsAllowed = 0;
    for (const g of games) {
      const isHome = g.teams?.home?.team?.id === teamId;
      const my = isHome ? g.teams.home : g.teams.away;
      const opp = isHome ? g.teams.away : g.teams.home;
      runsScored += my?.score ?? 0;
      runsAllowed += opp?.score ?? 0;
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

    const withDate = splits.map((s) => s.date).filter(Boolean).sort();
    const lastDate = withDate[withDate.length - 1];
    if (!lastDate) return { restDays: null, lastDate: null, note: "sin fecha de última salida" };

    const last = new Date(lastDate + "T12:00:00Z");
    const restDays = Math.max(
      0,
      Math.floor((Date.now() - last.getTime()) / (24 * 60 * 60 * 1000))
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
 * Home/away W-L from standings splitRecords + optional OPS/ERA from statSplits.
 */
export async function fetchTeamHomeAwaySplits(teamId) {
  const empty = {
    homeRecord: null,
    awayRecord: null,
    homeOps: null,
    awayOps: null,
    homeEra: null,
    awayEra: null,
  };

  try {
    const season = new Date().getFullYear();

    // 1) W-L home/away from standings (most reliable)
    let homeRecord = null;
    let awayRecord = null;
    try {
      const standRes = await fetch(
        `${MLB_BASE}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`
      );
      const standData = await standRes.json();
      const allTeams = (standData?.records || []).flatMap((r) => r.teamRecords || []);
      const tr = allTeams.find((t) => t.team?.id === teamId);
      const splits = tr?.records?.splitRecords || [];
      const home = splits.find((s) => s.type === "home");
      const away = splits.find((s) => s.type === "away");
      if (home) homeRecord = `${home.wins}-${home.losses}`;
      if (away) awayRecord = `${away.wins}-${away.losses}`;
    } catch {
      // keep nulls
    }

    // 2) OPS home/away + ERA home/away from team statSplits (best-effort)
    let homeOps = null, awayOps = null, homeEra = null, awayEra = null;

    const loadSplitStat = async (group, sitCode) => {
      try {
        const res = await fetch(
          `${MLB_BASE}/teams/${teamId}/stats?stats=statSplits&group=${group}&season=${season}&sitCodes=${sitCode}`
        );
        const data = await res.json();
        // Structure varies; try common paths
        const splits = data?.stats?.[0]?.splits || [];
        const match =
          splits.find((s) => {
            const code = (s.split?.code || s.sport?.code || "").toLowerCase();
            const desc = (s.split?.description || "").toLowerCase();
            if (sitCode === "h") return code === "h" || desc.includes("home");
            return code === "a" || desc.includes("away");
          }) || splits[0];
        return match?.stat || null;
      } catch {
        return null;
      }
    };

    const [hitHome, hitAway, pitHome, pitAway] = await Promise.all([
      loadSplitStat("hitting", "h"),
      loadSplitStat("hitting", "a"),
      loadSplitStat("pitching", "h"),
      loadSplitStat("pitching", "a"),
    ]);

    if (hitHome?.ops) homeOps = hitHome.ops;
    if (hitAway?.ops) awayOps = hitAway.ops;
    if (pitHome?.era) homeEra = pitHome.era;
    if (pitAway?.era) awayEra = pitAway.era;

    return { homeRecord, awayRecord, homeOps, awayOps, homeEra, awayEra };
  } catch {
    return empty;
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
  const [homeForm, awayForm, homeRest, awayRest, homeSplits, awaySplits] =
    await Promise.all([
      fetchTeamRecentForm(homeId, 10),
      fetchTeamRecentForm(awayId, 10),
      fetchPitcherRestDays(homePitcherId),
      fetchPitcherRestDays(awayPitcherId),
      fetchTeamHomeAwaySplits(homeId),
      fetchTeamHomeAwaySplits(awayId),
    ]);

  return {
    park,
    homeForm,
    awayForm,
    homePitcherRest: homeRest,
    awayPitcherRest: awayRest,
    homeSplits,
    awaySplits,
  };
}

/**
 * Compact block for the LLM prompt.
 */
export function formatPhase3ForPrompt(ctx, home, away) {
  if (!ctx) return "";

  const lines = [
    "CONTEXTO FASE 3 (ajusta totales/K/F5/ML con esto; no ignores parque, forma ni splits):",
  ];

  if (ctx.park) {
    lines.push(`- Parque (local ${home}): PF ${ctx.park.factor} — ${ctx.park.note}`);
  }

  if (ctx.homeForm?.games > 0 || ctx.awayForm?.games > 0) {
    const hf = ctx.homeForm;
    const af = ctx.awayForm;
    lines.push(
      `- Forma L10: ${home} ${hf.record} (RPG ${hf.rpgScored ?? "?"}/${hf.rpgAllowed ?? "?"}) | ${away} ${af.record} (RPG ${af.rpgScored ?? "?"}/${af.rpgAllowed ?? "?"})`
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

  // Home team plays at home; away team plays on the road — emphasize relevant split
  const hs = ctx.homeSplits;
  const as_ = ctx.awaySplits;
  if (hs || as_) {
    const homeBits = [];
    if (hs?.homeRecord) homeBits.push(`casa ${hs.homeRecord}`);
    if (hs?.homeOps) homeBits.push(`OPS casa ${hs.homeOps}`);
    if (hs?.homeEra) homeBits.push(`ERA casa ${hs.homeEra}`);

    const awayBits = [];
    if (as_?.awayRecord) awayBits.push(`fuera ${as_.awayRecord}`);
    if (as_?.awayOps) awayBits.push(`OPS fuera ${as_.awayOps}`);
    if (as_?.awayEra) awayBits.push(`ERA fuera ${as_.awayEra}`);

    if (homeBits.length || awayBits.length) {
      lines.push(
        `- Splits relevantes: ${home} (${homeBits.join(", ") || "N/A"}) | ${away} (${awayBits.join(", ") || "N/A"})`
      );
      lines.push(
        `- Usa el split de CASA para el local y el de FUERA para el visitante al ajustar ML y totales.`
      );
    }
  }

  return lines.join("\n") + "\n";
}
