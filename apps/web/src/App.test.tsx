import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import App from "./App";
import { FORBIDDEN_URL_PARAM_NAMES, V1_ROUTE_DEFINITIONS } from "./routes";

afterEach(() => {
  cleanup();
});

describe("Phase 1 V1 routes", () => {
  test("renders the landing page", () => {
    render(<App initialPath="/" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Gaming Gauntlet" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("landing-v1")).toBeInTheDocument();
  });

  test.each([
    ["/create", "create-v1", "Create lobby"],
    ["/manage/demo-lobby", "manage-v1", "Manage match"],
    ["/g/demo-lobby", "game-v1", "Match room"],
    ["/overlay/demo-lobby/top", "overlay-top-v1", "demo-lobby"]
  ])("renders %s without a Twitch login gate", (path, routeId, heading) => {
    const { container } = render(<App initialPath={path} />);

    expect(screen.getByTestId(routeId)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/twitch|oauth|login/i);
  });

  test("uses only safe route params for V1 paths", () => {
    const forbidden = new Set<string>(FORBIDDEN_URL_PARAM_NAMES);

    for (const route of V1_ROUTE_DEFINITIONS) {
      expect(route.paramNames.some((name) => forbidden.has(name))).toBe(false);
      expect(
        FORBIDDEN_URL_PARAM_NAMES.some((name) =>
          route.pattern.toLowerCase().includes(`:${name.toLowerCase()}`)
        )
      ).toBe(false);
    }
  });

  test("promotes the match URL instead of a separate management URL", () => {
    const { container } = render(<App initialPath="/" />);

    expect(screen.getByRole("link", { name: "/g/:lobbyId" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent("/manage/:lobbyId");
  });

  test("match room offers management without exposing a passcode in the URL", () => {
    render(<App initialPath="/g/demo-lobby" />);

    const manageLink = screen.getByRole("link", { name: "Manage this match" });

    expect(manageLink).toHaveAttribute("href", "/manage/demo-lobby");
    expect(manageLink.getAttribute("href")).not.toMatch(/code|token|secret/i);
  });

  test("ignores unsafe query parameters in route rendering", () => {
    const { container } = render(
      <App initialPath="/manage/demo-lobby?managementCode=abc123&token=secret456" />
    );

    expect(screen.getByTestId("manage-v1")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("abc123");
    expect(container).not.toHaveTextContent("secret456");
  });
});
