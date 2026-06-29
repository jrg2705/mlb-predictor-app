export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { homeTeam, awayTeam } = req.body

  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ error: 'Home team and away team are required' })
  }

  try {
    const statsData = await fetchTeamStats(homeTeam.id, awayTeam.id)
    const analysis = await analyzeWithClaude(homeTeam, awayTeam, statsData)

    res.json(analysis)
  } catch (error) {
    console.error('Analysis error:', error)
    res.status(500).json({ error: 'Failed to analyze matchup' })
  }
}

async function fetchTeamStats(homeTeamId, awayTeamId) {
  const currentYear = new Date().getFullYear()
  const stats = {}

  try {
    const homeRoster = await fetch(
      `https://statsapi.mlb.com/api/v1/teams/${homeTeamId}/roster?rosterType=active`
    )
    const homeRosterData = await homeRoster.json()
    stats.homeRoster = homeRosterData.roster || []

    const awayRoster = await fetch(
      `https://statsapi.mlb.com/api/v1/teams/${awayTeamId}/roster?rosterType=active`
    )
    const awayRosterData = await awayRoster.json()
    stats.awayRoster = awayRosterData.roster || []

    const homeStandings = await fetch(
      `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${currentYear}`
    )
    const standingsData = await homeStandings.json()
    stats.standings = standingsData.records || []

    const startDate = `${currentYear}-03-01`
    const endDate = new Date().toISOString().split('T')[0]

    const homeGames = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${homeTeamId}&startDate=${startDate}&endDate=${endDate}&hydrate=team`
    )
    stats.homeGames = await homeGames.json()

    const awayGames = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${awayTeamId}&startDate=${startDate}&endDate=${endDate}&hydrate=team`
    )
    stats.awayGames = await awayGames.json()

  } catch (err) {
    console.error('Error fetching stats:', err)
  }

  return stats
}

async function analyzeWithClaude(homeTeam, awayTeam, statsData) {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return {
      error: 'ANTHROPIC_API_KEY environment variable is not set. Please configure it in Vercel.',
      analysis: null,
      winner: null
    }
  }

  const homeRecord = findTeamRecord(statsData.standings, homeTeam.id)
  const awayRecord = findTeamRecord(statsData.standings, awayTeam.id)

  const prompt = `You are an expert MLB analyst. Analyze this matchup and provide a prediction:

HOME TEAM: ${homeTeam.teamName} (${homeTeam.city})
- League: ${homeTeam.league?.name || 'Unknown'}
- Division: ${homeTeam.division?.name || 'Unknown'}
- Record: ${homeRecord}
- Stadium: ${homeTeam.venue?.name || 'Unknown'}

AWAY TEAM: ${awayTeam.teamName} (${awayTeam.city})
- League: ${awayTeam.league?.name || 'Unknown'}
- Division: ${awayTeam.division?.name || 'Unknown'}
- Record: ${awayRecord}
- Stadium: ${awayTeam.venue?.name || 'Unknown'}

Provide:
1. A brief analysis of each team's strengths and weaknesses
2. Key factors that could influence the game
3. Home field advantage considerations
4. Your prediction for the winner
5. Confidence level (High/Medium/Low)

Format your response in clear paragraphs. End with:
PREDICTED WINNER: [Team Name]
CONFIDENCE: [High/Medium/Low]

Be objective and base your analysis on the team information provided.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    })

    const data = await response.json()

    if (data.error) {
      return {
        error: `Claude API error: ${data.error.message || 'Unknown error'}`,
        analysis: null,
        winner: null
      }
    }

    const analysisText = data.content?.[0]?.text || ''
    const winnerMatch = analysisText.match(/PREDICTED WINNER:\s*(.+)/i)
    const confidenceMatch = analysisText.match(/CONFIDENCE:\s*(High|Medium|Low)/i)

    return {
      analysis: analysisText,
      winner: winnerMatch ? winnerMatch[1].trim() : null,
      confidence: confidenceMatch ? confidenceMatch[1] : null
    }
  } catch (err) {
    return {
      error: `Failed to get Claude analysis: ${err.message}`,
      analysis: null,
      winner: null
    }
  }
}

function findTeamRecord(standings, teamId) {
  for (const record of standings) {
    const teamRecord = record.teamRecords?.find(tr => tr.team?.id === teamId)
    if (teamRecord) {
      return `${teamRecord.wins || 0}-${teamRecord.losses || 0}`
    }
  }
  return 'Record not available'
}
