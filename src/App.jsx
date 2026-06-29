import { useState, useEffect } from 'react'

function App() {
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedGame, setSelectedGame] = useState(null)
  const [prediction, setPrediction] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)

  useEffect(() => {
    fetchTeams()
  }, [])

  const fetchTeams = async () => {
    try {
      const response = await fetch('https://statsapi.mlb.com/api/v1/teams?sportId=1')
      const data = await response.json()
      setTeams(data.teams || [])
      setLoading(false)
    } catch (err) {
      setError('Failed to fetch teams')
      setLoading(false)
    }
  }

  const analyzeMatchup = async (homeTeam, awayTeam) => {
    setAnalyzing(true)
    setPrediction(null)
    setSelectedGame({ homeTeam, awayTeam })

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeTeam, awayTeam })
      })

      const data = await response.json()
      setPrediction(data)
    } catch (err) {
      setPrediction({ error: 'Failed to get prediction. Please check your API configuration.' })
    }

    setAnalyzing(false)
  }

  if (loading) {
    return (
      <div className="container">
        <div className="loader">
          <div className="spinner"></div>
          <p>Loading MLB teams...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container">
        <div className="error-message">{error}</div>
      </div>
    )
  }

  return (
    <div className="container">
      <header>
        <h1>MLB Predictor</h1>
        <p>AI-Powered Game Analysis using Claude AI</p>
      </header>

      <main>
        <section className="teams-grid">
          <h2>Select Teams for Matchup</h2>
          <div className="teams-list">
            {teams.map(team => (
              <div key={team.id} className="team-card">
                <img
                  src={`https://www.mlbstatic.com/team-logos/${team.id}.svg`}
                  alt={team.name}
                  className="team-logo"
                  onError={(e) => e.target.style.display = 'none'}
                />
                <h3>{team.teamName}</h3>
                <p className="team-info">{team.division?.name || 'MLB'}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="matchup-builder">
          <h2>Build Your Matchup</h2>
          <div className="matchup-selects">
            <div className="select-group">
              <label>Home Team</label>
              <select id="homeTeam">
                <option value="">Select Home Team</option>
                {teams.map(team => (
                  <option key={team.id} value={team.id}>{team.teamName}</option>
                ))}
              </select>
            </div>
            <div className="vs-divider">VS</div>
            <div className="select-group">
              <label>Away Team</label>
              <select id="awayTeam">
                <option value="">Select Away Team</option>
                {teams.map(team => (
                  <option key={team.id} value={team.id}>{team.teamName}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            className="analyze-btn"
            onClick={() => {
              const homeId = document.getElementById('homeTeam').value
              const awayId = document.getElementById('awayTeam').value
              if (homeId && awayId && homeId !== awayId) {
                const homeTeam = teams.find(t => t.id === parseInt(homeId))
                const awayTeam = teams.find(t => t.id === parseInt(awayId))
                analyzeMatchup(homeTeam, awayTeam)
              }
            }}
            disabled={analyzing}
          >
            {analyzing ? 'Analyzing...' : 'Analyze Matchup'}
          </button>
        </section>

        {selectedGame && (
          <section className="prediction-result">
            <h2>Prediction</h2>
            <div className="matchup-display">
              <div className="team-side">
                <img
                  src={`https://www.mlbstatic.com/team-logos/${selectedGame.homeTeam.id}.svg`}
                  alt={selectedGame.homeTeam.name}
                  className="team-logo-large"
                  onError={(e) => e.target.style.display = 'none'}
                />
                <span className="team-name">{selectedGame.homeTeam.teamName}</span>
                <span className="home-label">(Home)</span>
              </div>
              <div className="vs-large">VS</div>
              <div className="team-side">
                <img
                  src={`https://www.mlbstatic.com/team-logos/${selectedGame.awayTeam.id}.svg`}
                  alt={selectedGame.awayTeam.name}
                  className="team-logo-large"
                  onError={(e) => e.target.style.display = 'none'}
                />
                <span className="team-name">{selectedGame.awayTeam.teamName}</span>
                <span className="away-label">(Away)</span>
              </div>
            </div>

            {analyzing && (
              <div className="analyzing">
                <div className="spinner"></div>
                <p>Fething MLB stats and analyzing with Claude AI...</p>
              </div>
            )}

            {prediction && !analyzing && (
              <div className="prediction-content">
                {prediction.error ? (
                  <div className="error-message">{prediction.error}</div>
                ) : (
                  <div className="analysis">
                    <div className="prediction-header">
                      <h3>Claude AI Analysis</h3>
                    </div>
                    <div className="prediction-text">
                      {prediction.analysis?.split('\n').map((paragraph, idx) => (
                        paragraph ? <p key={idx}>{paragraph}</p> : null
                      ))}
                    </div>
                    {prediction.winner && (
                      <div className="predicted-winner">
                        <h4>Predicted Winner</h4>
                        <p className="winner-name">{prediction.winner}</p>
                        {prediction.confidence && (
                          <p className="confidence">Confidence: {prediction.confidence}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      <footer>
        <p>Powered by MLB Stats API & Claude AI</p>
      </footer>
    </div>
  )
}

export default App
