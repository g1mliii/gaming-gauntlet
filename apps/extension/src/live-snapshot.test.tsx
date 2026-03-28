import "@testing-library/jest-dom/vitest";
import { act, render } from "@testing-library/react";

import { useExtensionSnapshot } from "./live-snapshot";

type TestSurface = {
  status: "live" | "complete";
  title: string;
};

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ETag: 'W/"surface:1"',
    },
    ...init,
  });
}

async function flushSnapshotLoad() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function HookHarness({
  path,
  stopPollingOnComplete = false,
}: {
  path: string | null;
  stopPollingOnComplete?: boolean;
}) {
  const { isLoading, pageError } = useExtensionSnapshot<TestSurface>({
    missingPathError: "missing",
    path,
    pollIntervalMs: 5_000,
    stopPollingOnComplete,
    toFriendlyError: (error) =>
      error instanceof Error ? error.message : "unknown",
  });

  return (
    <div>
      <span data-testid="loading">{isLoading ? "loading" : "ready"}</span>
      <span data-testid="error">{pageError ?? ""}</span>
    </div>
  );
}

describe("useExtensionSnapshot", () => {
  const fetchMock =
    vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >();
  const originalConsoleError = console.error;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      const message = args.map((value) => String(value)).join(" ");
      if (message.includes("not wrapped in act")) {
        return;
      }

      originalConsoleError(...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stops further polling after the extension surface settles complete", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        status: "complete",
        title: "Done",
      } satisfies TestSurface)
    );

    render(
      <HookHarness
        path="/api/public/matches/gauntlet-finals/surface?view=overlay"
        stopPollingOnComplete
      />
    );
    await flushSnapshotLoad();
    const initialCallCount = fetchMock.mock.calls.length;
    expect(initialCallCount).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    const postCompletionCallCount = fetchMock.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(6_000);
    });

    expect(postCompletionCallCount).toBeGreaterThanOrEqual(initialCallCount);
    expect(fetchMock).toHaveBeenCalledTimes(postCompletionCallCount);
  });

  it("aborts extension requests and clears visibility listeners on unmount", async () => {
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");
    let requestSignal: AbortSignal | null = null;

    fetchMock.mockImplementation(async (_input, init) => {
      requestSignal = (init?.signal as AbortSignal | undefined) ?? null;
      return new Promise<Response>(() => undefined);
    });

    const view = render(
      <HookHarness path="/api/public/matches/gauntlet-finals/surface?view=overlay" />
    );

    await act(async () => {
      await Promise.resolve();
    });

    view.unmount();

    const aborted = requestSignal
      ? (requestSignal as AbortSignal).aborted
      : false;
    expect(aborted).toBe(true);
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function)
    );
  });
});
