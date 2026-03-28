import "@testing-library/jest-dom/vitest";
import { act, render } from "@testing-library/react";

import { useLiveSnapshot } from "./live-snapshot";

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
  const { isLoading, pageError } = useLiveSnapshot<TestSurface>({
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

describe("useLiveSnapshot", () => {
  const fetchMock =
    vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >();
  const originalConsoleError = console.error;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let visibilityState: DocumentVisibilityState = "visible";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    visibilityState = "visible";
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      const message = args.map((value) => String(value)).join(" ");
      if (message.includes("not wrapped in act")) {
        return;
      }

      originalConsoleError(...args);
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stops further polling after the loaded match settles complete", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        status: "complete",
        title: "Done",
      } satisfies TestSurface)
    );

    render(
      <HookHarness
        path="/api/public/matches/gauntlet-finals/surface?view=page"
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

  it("pauses polling in hidden tabs and resumes polling after the page becomes visible again", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        status: "live",
        title: "Live",
      } satisfies TestSurface)
    );

    render(
      <HookHarness path="/api/public/matches/gauntlet-finals/surface?view=page" />
    );
    await flushSnapshotLoad();
    const settledCallCount = fetchMock.mock.calls.length;
    expect(settledCallCount).toBeGreaterThan(0);

    act(() => {
      visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(6_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(settledCallCount);

    act(() => {
      visibilityState = "visible";
      vi.advanceTimersByTime(5_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(settledCallCount + 1);
  });

  it("aborts in-flight requests and removes interval/listener state on unmount", async () => {
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");
    let requestSignal: AbortSignal | null = null;

    fetchMock.mockImplementation(async (_input, init) => {
      requestSignal = (init?.signal as AbortSignal | undefined) ?? null;
      return new Promise<Response>(() => undefined);
    });

    const view = render(
      <HookHarness path="/api/public/matches/gauntlet-finals/surface?view=page" />
    );

    await act(async () => {
      await Promise.resolve();
    });

    view.unmount();

    const aborted = requestSignal
      ? (requestSignal as AbortSignal).aborted
      : false;
    expect(aborted).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function)
    );
  });
});
