import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";

import { useTwitchExtensionState } from "./twitch";
import { installTwitchHelperMock } from "./twitch.test-support";

function RuntimeHarness() {
  const runtime = useTwitchExtensionState();

  return (
    <div>
      <span data-testid="helper">
        {runtime.usingTwitchHelper ? "helper" : "fallback"}
      </span>
      <span data-testid="auth">{runtime.auth?.channelId ?? ""}</span>
      <span data-testid="error">{runtime.pageError ?? ""}</span>
    </div>
  );
}

describe("useTwitchExtensionState", () => {
  async function flushState() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    window.__GG_TWITCH_RUNTIME__ = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.__GG_TWITCH_RUNTIME__ = undefined;
  });

  it("attaches when the Twitch helper appears after the first render", async () => {
    render(<RuntimeHarness />);

    expect(screen.getByTestId("helper")).toHaveTextContent("fallback");

    const twitch = installTwitchHelperMock();

    act(() => {
      twitch.authorize();
      vi.advanceTimersByTime(499);
    });

    expect(screen.getByTestId("auth")).toHaveTextContent("");

    act(() => {
      vi.advanceTimersByTime(1);
      twitch.authorize();
    });

    await flushState();

    expect(screen.getByTestId("helper")).toHaveTextContent("helper");
    expect(screen.getByTestId("auth")).toHaveTextContent("1001");
  });

  it("backs off helper retries instead of polling constantly", async () => {
    render(<RuntimeHarness />);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    const twitch = installTwitchHelperMock();

    act(() => {
      twitch.authorize();
      vi.advanceTimersByTime(999);
    });

    expect(screen.getByTestId("auth")).toHaveTextContent("");

    act(() => {
      vi.advanceTimersByTime(1);
      twitch.authorize();
    });

    await flushState();

    expect(screen.getByTestId("helper")).toHaveTextContent("helper");
    expect(screen.getByTestId("auth")).toHaveTextContent("1001");
  });
});
