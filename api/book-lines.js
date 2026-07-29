// api/book-lines.js — Parse compact sportsbook lines .txt
// Format (one game per line, | separated):
// away|home|pitcher_away|k_away|pitcher_home|k_home|ml_away|ml_home|rl|total|solo_away|solo_home|hce|1inn_si|1inn_no
//
// Lines starting with # are comments. Empty lines ignored.
// Date line example: # FECHA: 2026-07-29

const TEAM_ALIASES = {
  "texas": "Texas Rangers",
  "rangers": "Texas Rangers",
  "tampa": "Tampa Bay Rays",
  "rays": "Tampa Bay Rays",
  "tampa bay": "Tampa Bay Rays",
  "baltimore": "Baltimore Orioles",
  "orioles": "Baltimore Orioles",
  "detroit": "Detroit Tigers",
  "tigers": "Detroit Tigers",
  "philadelphia": "Philadelphia Phillies",
  "phillies": "Philadelphia Phillies",
  "miami": "Miami Marlins",
  "marlins": "Miami Marlins",
  "arizona": "Arizona Diamondbacks",
  "diamondbacks": "Arizona Diamondbacks",
  "dbacks": "Arizona Diamondbacks",
  "pittsburgh": "Pittsburgh Pirates",
  "pirates": "Pittsburgh Pirates",
  "toronto": "Toronto Blue Jays",
  "blue jays": "Toronto Blue Jays",
  "jays": "Toronto Blue Jays",
  "washington": "Washington Nationals",
  "nationals": "Washington Nationals",
  "nats": "Washington Nationals",
  "cleveland": "Cleveland Guardians",
  "guardians": "Cleveland Guardians",
  "cincinnati": "Cincinnati Reds",
  "reds": "Cincinnati Reds",
  "kansas": "Kansas City Royals",
  "kansas city": "Kansas City Royals",
  "royals": "Kansas City Royals",
  "minnesota": "Minnesota Twins",
  "twins": "Minnesota Twins",
  "yankees": "New York Yankees",
  "ny yankees": "New York Yankees",
  "new york yankees": "New York Yankees",
  "whitesox": "Chicago White Sox",
  "white sox": "Chicago White Sox",
  "chicago white sox": "Chicago White Sox",
  "cubs": "Chicago Cubs",
  "chicago cubs": "Chicago Cubs",
  "stl cardinals": "St. Louis Cardinals",
  "cardinals": "St. Louis Cardinals",
  "st louis": "St. Louis Cardinals",
  "st. louis": "St. Louis Cardinals",
  "houston": "Houston Astros",
  "astros": "Houston Astros",
  "angels": "Los Angeles Angels",
  "la angels": "Los Angeles Angels",
  "los angeles angels": "Los Angeles Angels",
  "boston": "Boston Red Sox",
  "red sox": "Boston Red Sox",
  "athletics": "Athletics",
  "oakland": "Athletics",
  "a's": "Athletics",
  "colorado": "Colorado Rockies",
  "rockies": "Colorado Rockies",
  "sandiego": "San Diego Padres",
  "san diego": "San Diego Padres",
  "padres": "San Diego Padres",
  "milwaukee": "Milwaukee Brewers",
  "brewers": "Milwaukee Brewers",
  "sanfrancisco": "San Francisco Giants",
  "san francisco": "San Francisco Giants",
  "giants": "San Francisco Giants",
  "seattle": "Seattle Mariners",
  "mariners": "Seattle Mariners",
  "dodgers": "Los Angeles Dodgers",
  "la dodgers": "Los Angeles Dodgers",
  "los angeles dodgers": "Los Angeles Dodgers",
  "mets": "New York Mets",
  "ny mets": "New York Mets",
  "new york mets": "New York Mets",
  "braves": "Atlanta Braves",
  "atlanta": "Atlanta Braves",
};

function resolveTeam(raw) {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  const lower = cleaned.toLowerCase();
  if (TEAM_ALIASES[lower]) return TEAM_ALIASES[lower];
  for (const [alias, full] of Object.entries(TEAM_ALIASES)) {
    if (lower.includes(alias) || alias.includes(lower)) return full;
  }
  return cleaned;
}

function parseNum(s) {
  if (s == null || s === "") return null;
  const n = parseFloat(String(s).replace(",", "."));
  return isNaN(n) ? null : n;
}

function parseOdds(s) {
  if (s == null || s === "") return null;
  const cleaned = String(s).trim();
  if (!cleaned) return null;
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}

/**
 * Parse the compact book-lines .txt content into structured games.
 * @param {string} text
 * @returns {{ date: string|null, games: Array<object>, errors: string[] }}
 */
export function parseBookLines(text) {
  const errors = [];
  const games = [];
  let date = null;

  if (!text || typeof text !== "string") {
    return { date: null, games: [], errors: ["Texto vacío"] };
  }

  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    if (raw.startsWith("#")) {
      const dateMatch = raw.match(/FECHA\s*:\s*(\d{4}-\d{2}-\d{2})/i);
      if (dateMatch) date = dateMatch[1];
      continue;
    }

    const parts = raw.split("|");
    if (parts.length < 10) {
      errors.push(`Línea ${i + 1}: esperados ≥10 campos, hay ${parts.length}`);
      continue;
    }

    const p = parts.map((x) => (x == null ? "" : x.trim()));
    const away = resolveTeam(p[0]);
    const home = resolveTeam(p[1]);

    if (!away || !home) {
      errors.push(`Línea ${i + 1}: equipos inválidos (${p[0]}/${p[1]})`);
      continue;
    }

    games.push({
      away,
      home,
      pitcherAway: p[2] || null,
      kAway: parseNum(p[3]),
      pitcherHome: p[4] || null,
      kHome: parseNum(p[5]),
      mlAway: parseOdds(p[6]),
      mlHome: parseOdds(p[7]),
      rl: parseNum(p[8]),
      total: parseNum(p[9]),
      soloAway: parseNum(p[10]),
      soloHome: parseNum(p[11]),
      hce: parseNum(p[12]),
      firstInningSi: parseOdds(p[13]),
      firstInningNo: parseOdds(p[14]),
      rawLine: raw,
    });
  }

  return { date, games, errors };
}

/**
 * Find book lines for a specific matchup (order-insensitive).
 */
export function findBookLinesForMatchup(games, home, away) {
  if (!Array.isArray(games)) return null;
  return (
    games.find(
      (g) =>
        (g.home === home && g.away === away) ||
        (g.home === away && g.away === home)
    ) || null
  );
}

export { resolveTeam, TEAM_ALIASES };
