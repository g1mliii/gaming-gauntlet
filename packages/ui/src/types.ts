export type GauntletPlayer = {
  id?: string;
  displayName: string;
  wins: number;
};

export type GauntletQueueStatus = "queued" | "live" | "completed" | string;

export type GauntletQueueItem = {
  id: string;
  title: string;
  status: GauntletQueueStatus;
};

export type GauntletSuggestion = {
  id?: string;
  boardId: number | string;
  title: string;
  voteCount: number;
  status?: "board" | "approved" | "rejected" | string;
  sourceChannelId?: string | null;
};

export type GauntletMatchSurface = {
  title: string;
  status?: string;
  targetWins?: number | null;
  players: GauntletPlayer[];
  currentGame?: { title: string } | null;
  currentGameId?: string | null;
  queue?: GauntletQueueItem[];
  upcomingQueue?: GauntletQueueItem[];
  topBoard?: GauntletSuggestion[];
  boardRevision?: number;
  remainingQueueCount?: number;
  upcomingQueueCount?: number;
};
