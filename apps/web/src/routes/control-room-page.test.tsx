import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  approveSuggestion,
  createDemoMatchSnapshot,
  type MatchSnapshot,
  type MatchSummary,
} from "@gaming-gauntlet/contracts";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ControlRoomPage } from "./control-room-page";

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ETag: 'W/"match_1:2026-03-24T04:00:00.000Z:1"',
    },
    ...init,
  });
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readyState = 0;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);

    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    });
  }

  close() {
    this.readyState = 3;
    this.onclose?.(new Event("close"));
  }

  send() {
    return undefined;
  }

  emitSnapshot(snapshot: MatchSnapshot) {
    this.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "match.snapshot",
          payload: snapshot,
        }),
      })
    );
  }
}

describe("ControlRoomPage", () => {
  const fetchMock =
    vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >();

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the simplified control room and opens the operator websocket", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(createDemoMatchSnapshot({ matchId: "match_1" }))
    );

    renderControlRoom();

    expect(await screen.findByText(/run rounds from one list/i)).toBeInTheDocument();
    expect(screen.getByText(/2 awaiting review/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/control/matches/match_1/snapshot"),
      expect.objectContaining({
        credentials: "include",
      })
    );
    expect(MockWebSocket.instances[0]?.url).toBe(
      "ws://localhost:8787/ws/control/matches/match_1"
    );
  });

  it("posts control actions and swaps the UI to the returned snapshot", async () => {
    const initialSnapshot = createDemoMatchSnapshot({ matchId: "match_1" });
    const approvedSnapshot = approveSuggestion(initialSnapshot, "sgg_01");

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);

      if (
        url.includes("/api/matches/match_1/control/actions") &&
        init?.method === "POST"
      ) {
        return jsonResponse({
          ok: true,
          snapshot: approvedSnapshot,
        });
      }

      return jsonResponse(initialSnapshot);
    });

    renderControlRoom();

    await screen.findByText(/2 awaiting review/i);
    fireEvent.click(screen.getAllByRole("button", { name: /approve/i })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/matches/match_1/control/actions"),
        expect.objectContaining({
          method: "POST",
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/1 awaiting review/i)).toBeInTheDocument();
    });
  });

  it("keeps every operator workflow reachable after the layout simplification", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(createDemoMatchSnapshot({ matchId: "match_1" }))
    );

    renderControlRoom();

    await screen.findByText(/2 awaiting review/i);

    expect(
      screen.getByRole("button", { name: /pause match/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /complete match/i })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /approve/i }).length).toBe(2);
    expect(screen.getAllByRole("button", { name: /reject/i }).length).toBe(2);
    expect(
      screen.getByRole("button", { name: /randomize upcoming/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /start next round/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /manual add/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add to queue/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /move up/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /move down/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /pixelriot wins/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /novarune wins/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /close round/i })
    ).toBeInTheDocument();
  });

  it("shows a start action for draft matches and toggles pause into resume", async () => {
    const draftSnapshot = createDemoMatchSnapshot({
      matchId: "match_1",
      status: "draft",
      chatState: "idle",
      updatedAt: "2026-03-27T01:00:00.000Z",
    });
    const pausedSnapshot = {
      ...draftSnapshot,
      status: "paused",
      chatState: "paused_grace",
      chatEnabledUntil: "2026-03-27T01:10:00.000Z",
      updatedAt: "2026-03-27T01:05:00.000Z",
    } satisfies MatchSnapshot;

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.includes("/api/matches/match_1/status") && init?.method === "PATCH") {
        return jsonResponse({
          ok: true,
          match: createMatchSummary(pausedSnapshot),
        });
      }

      return jsonResponse(draftSnapshot);
    });

    renderControlRoom();

    expect(await screen.findByRole("button", { name: /start match/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start match/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/matches/match_1/status"),
        expect.objectContaining({
          method: "PATCH",
        })
      );
    });
    expect(await screen.findByRole("button", { name: /resume match/i })).toBeInTheDocument();
    expect(screen.getAllByText(/paused/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/auto-completes after about 15 minutes paused unless you resume/i)
        .length
    ).toBeGreaterThan(0);
  });

  it("preserves newer websocket state when a status request resolves later", async () => {
    const initialSnapshot = createDemoMatchSnapshot({
      matchId: "match_1",
      status: "live",
      chatState: "live",
    });
    const websocketSnapshot: MatchSnapshot = {
      ...initialSnapshot,
      boardRevision: initialSnapshot.boardRevision + 1,
      updatedAt: "2026-03-27T01:03:00.000Z",
      suggestions: [
        ...initialSnapshot.suggestions,
        {
          id: "sgg_99",
          boardId: "99",
          title: "Fortnite",
          canonicalKey: "fortnite",
          aliases: ["fortnite"],
          sourceChannelId: "channel_3",
          suggestedBy: "ViewerThree",
          voteCount: 1,
          status: "board",
        },
      ],
    };
    const pausedSummary = createMatchSummary({
      ...initialSnapshot,
      status: "paused",
      chatState: "paused_grace",
      chatEnabledUntil: "2026-03-27T01:10:00.000Z",
      updatedAt: "2026-03-27T01:05:00.000Z",
    });
    let resolveStatus:
      | ((value: Response | PromiseLike<Response>) => void)
      | undefined;

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url.includes("/api/matches/match_1/status") && init?.method === "PATCH") {
        return new Promise<Response>((resolve) => {
          resolveStatus = resolve;
        });
      }

      return Promise.resolve(jsonResponse(initialSnapshot));
    });

    renderControlRoom();

    expect(await screen.findByText(/2 awaiting review/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pause match/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/matches/match_1/status"),
        expect.objectContaining({
          method: "PATCH",
        })
      );
    });

    await act(async () => {
      MockWebSocket.instances[0]?.emitSnapshot(websocketSnapshot);
    });
    expect(await screen.findByText(/3 awaiting review/i)).toBeInTheDocument();

    await act(async () => {
      resolveStatus?.(
        jsonResponse({
          ok: true,
          match: pausedSummary,
        })
      );
    });

    expect(await screen.findByRole("button", { name: /resume match/i })).toBeInTheDocument();
    expect(screen.getByText(/3 awaiting review/i)).toBeInTheDocument();
  });

  it("shows the auth error without opening a websocket when snapshot access is denied", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: "auth_required",
          details: null,
        },
        { status: 401 }
      )
    );

    renderControlRoom();

    expect(
      await screen.findByRole("heading", { name: /control room unavailable/i })
    ).toBeInTheDocument();
    expect(screen.getAllByText(/auth required/i).length).toBeGreaterThan(0);
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("locks board and queue mutations after the match is complete", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        createDemoMatchSnapshot({
          matchId: "match_1",
          status: "complete",
          chatState: "idle",
        })
      )
    );

    renderControlRoom();

    expect(await screen.findByText(/queue and board controls are locked/i)).toBeInTheDocument();
    expect(
      screen.getByText(/complete is the shutdown state/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/auto-completes after about 15 minutes paused or 3 hours without match activity/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /complete match/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start match/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resume match/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /approve/i })[0]).toBeDisabled();
    expect(screen.getByRole("button", { name: /randomize upcoming/i })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /manual add/i })).toBeDisabled();
    expect(MockWebSocket.instances.length).toBe(0);
  });
});

function renderControlRoom() {
  render(
    <MemoryRouter initialEntries={["/control/match_1"]}>
      <Routes>
        <Route path="/control/:matchId" element={<ControlRoomPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function createMatchSummary(snapshot: MatchSnapshot): MatchSummary {
  return {
    id: snapshot.matchId,
    channelLinkId: "link_1",
    slug: snapshot.slug,
    title: snapshot.title,
    status: snapshot.status,
    chatState: snapshot.chatState,
    chatEnabledUntil: snapshot.chatEnabledUntil,
    boardRevision: snapshot.boardRevision,
    subscriptionHealth: snapshot.subscriptionHealth,
    targetWins: snapshot.targetWins,
    players: snapshot.players,
    createdAt: "2026-03-27T01:00:00.000Z",
    updatedAt: snapshot.updatedAt,
  };
}
