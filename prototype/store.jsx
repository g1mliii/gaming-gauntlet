// store.jsx — mock lobby state + actions. Stands in for lobby-api.ts / D1 in the
// prototype. Persists to localStorage so refresh keeps your place during review.

const LS_KEY = "gg_proto_lobby_v1";

const DEFAULT_GAMES = [
  "Rocket League", "Tetris", "Street Fighter 6", "Mario Kart",
  "Trackmania", "Geoguessr", "Chess Blitz", "Fall Guys",
].map((title, i) => ({ id: `g${i + 1}`, title, enabled: true }));

const DEFAULT_LOBBY = {
  lobbyId: "lob_8fk2n4qz",
  title: "Friday Night Gauntlet",
  status: "ready", // ready | live | done
  targetScore: 5,
  managementCode: "GG-7K4Q-XR2M-9V8B",
  players: [
    { displayName: "NOVA", wins: 2 },
    { displayName: "RIPTIDE", wins: 1 },
  ],
  games: DEFAULT_GAMES,
  currentGameId: "g3",
  version: 7,
};

function loadLobby() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_LOBBY, ...JSON.parse(raw) };
  } catch (e) {}
  return { ...DEFAULT_LOBBY };
}

function useLobby() {
  const [lobby, setLobby] = React.useState(loadLobby);

  React.useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(lobby)); } catch (e) {}
  }, [lobby]);

  // every successful write bumps version + updatedAt, mirroring the API contract
  const commit = React.useCallback((patch) => {
    setLobby((prev) => {
      const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
      return { ...next, version: (prev.version || 0) + 1 };
    });
  }, []);

  const actions = React.useMemo(() => ({
    setScore: (i, delta) => commit((p) => {
      const players = p.players.map((pl, idx) =>
        idx === i ? { ...pl, wins: Math.max(0, pl.wins + delta) } : pl);
      return { ...p, players };
    }),
    resetScores: () => commit((p) => ({ ...p, players: p.players.map((pl) => ({ ...pl, wins: 0 })) })),
    renamePlayer: (i, name) => commit((p) => ({
      ...p, players: p.players.map((pl, idx) => idx === i ? { ...pl, displayName: name } : pl),
    })),
    setTarget: (n) => commit({ targetScore: n }),
    setTitle: (t) => commit({ title: t }),
    setStatus: (s) => commit({ status: s }),
    addGame: (title) => commit((p) => ({
      ...p, games: [...p.games, { id: `g${Date.now()}`, title, enabled: true }],
    })),
    renameGame: (id, title) => commit((p) => ({
      ...p, games: p.games.map((g) => g.id === id ? { ...g, title } : g),
    })),
    removeGame: (id) => commit((p) => ({
      ...p,
      games: p.games.filter((g) => g.id !== id),
      currentGameId: p.currentGameId === id ? null : p.currentGameId,
    })),
    toggleGame: (id) => commit((p) => ({
      ...p, games: p.games.map((g) => g.id === id ? { ...g, enabled: !g.enabled } : g),
    })),
    moveGame: (id, dir) => commit((p) => {
      const games = [...p.games];
      const i = games.findIndex((g) => g.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= games.length) return p;
      [games[i], games[j]] = [games[j], games[i]];
      return { ...p, games };
    }),
    reorderGames: (fromId, toId) => commit((p) => {
      const games = [...p.games];
      const from = games.findIndex((g) => g.id === fromId);
      const to = games.findIndex((g) => g.id === toId);
      if (from < 0 || to < 0 || from === to) return p;
      const [moved] = games.splice(from, 1);
      games.splice(to, 0, moved);
      return { ...p, games };
    }),
    setCurrentGame: (id) => commit({ currentGameId: id, status: id ? "live" : "ready" }),
    clearCurrentGame: () => commit({ currentGameId: null }),
    resetMatch: () => commit((p) => ({
      ...p, players: p.players.map((pl) => ({ ...pl, wins: 0 })), currentGameId: null, status: "ready",
    })),
  }), [commit]);

  // surface shape consumed by ScoreBug
  const surface = React.useMemo(() => ({
    title: lobby.title,
    status: lobby.status,
    targetWins: lobby.targetScore,
    players: lobby.players,
    games: lobby.games,
    currentGameId: lobby.currentGameId,
  }), [lobby]);

  return { lobby, surface, actions };
}

Object.assign(window, { useLobby, DEFAULT_LOBBY });
