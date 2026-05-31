import { useCallback, useEffect, useState } from "react";

import { isTheme } from "./overlay/catalog";
import type { OverlayTheme } from "./overlay/catalog";

// The streamer's chosen overlay theme, stored per-lobby in the browser only (no
// backend). The match room uses it to recolor the control page and to drive the
// theme of the overlay URLs it generates, keeping the two in sync per device.

const OVERLAY_THEME_STORAGE_PREFIX = "gaming-gauntlet:v1:overlay-theme:";

export function getOverlayThemeStorageKey(lobbyId: string): string {
  return `${OVERLAY_THEME_STORAGE_PREFIX}${lobbyId}`;
}

export function readStoredTheme(lobbyId: string): OverlayTheme {
  try {
    const value = window.localStorage.getItem(
      getOverlayThemeStorageKey(lobbyId)
    );

    return value && isTheme(value) ? value : "default";
  } catch {
    return "default";
  }
}

export function storeOverlayTheme(lobbyId: string, theme: OverlayTheme): boolean {
  try {
    window.localStorage.setItem(getOverlayThemeStorageKey(lobbyId), theme);
    return true;
  } catch {
    return false;
  }
}

// The container class that applies a theme's CSS-variable swap. "default" needs
// no class (it uses the base tokens).
export function themeClassName(theme: OverlayTheme): string {
  return theme === "default" ? "" : `gg-theme gg-theme--${theme}`;
}

export function useOverlayTheme(
  lobbyId: string
): [OverlayTheme, (theme: OverlayTheme) => void] {
  const [theme, setThemeState] = useState<OverlayTheme>(() =>
    readStoredTheme(lobbyId)
  );

  useEffect(() => {
    setThemeState(readStoredTheme(lobbyId));
  }, [lobbyId]);

  const setTheme = useCallback(
    (next: OverlayTheme) => {
      setThemeState(next);
      storeOverlayTheme(lobbyId, next);
    },
    [lobbyId]
  );

  return [theme, setTheme];
}
