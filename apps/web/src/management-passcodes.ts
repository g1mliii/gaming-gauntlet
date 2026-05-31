import { LobbyIdSchema } from "@gaming-gauntlet/core";

const MANAGEMENT_PASSCODE_STORAGE_PREFIX =
  "gaming-gauntlet:v1:management-passcode:";
const URL_BASE = "https://gaming-gauntlet.local";
type StorageKind = "localStorage" | "sessionStorage";

// Passcodes persist in localStorage so a streamer who reopens the match URL (or
// returns to the site after accidentally closing the tab) is auto-unlocked
// instead of re-prompted. sessionStorage is only read as a one-time migration
// source from the earlier session-scoped build.
const PRIMARY_STORAGE: StorageKind = "localStorage";
const LEGACY_STORAGE: StorageKind = "sessionStorage";

export function getManagementPasscodeStorageKey(lobbyId: string): string {
  return `${MANAGEMENT_PASSCODE_STORAGE_PREFIX}${lobbyId}`;
}

export function readStoredManagementPasscode(lobbyId: string): string | null {
  const storageKey = getManagementPasscodeStorageKey(lobbyId);
  const value = readStorageValue(PRIMARY_STORAGE, storageKey);

  if (value) {
    return value;
  }

  // Migrate forward from the short-lived sessionStorage scheme so passcodes
  // saved by an earlier build keep working across tabs and restarts.
  const legacyValue = readStorageValue(LEGACY_STORAGE, storageKey);

  if (legacyValue) {
    removeStorageValue(LEGACY_STORAGE, storageKey);
    writeStorageValue(PRIMARY_STORAGE, storageKey, legacyValue);
  }

  return legacyValue;
}

// Single-active model: at most one match is "yours" at a time, so the lone
// stored passcode key identifies the lobby to resume when the streamer lands
// back on the site. Returns null when nothing is stored.
export function readActiveManagedLobbyId(): string | null {
  for (const kind of [PRIMARY_STORAGE, LEGACY_STORAGE] as const) {
    const lobbyId = findManagedLobbyId(kind);

    if (lobbyId) {
      return lobbyId;
    }
  }

  return null;
}

export function storeManagementPasscode(
  lobbyId: string,
  managementCode: string
): boolean {
  clearStoredManagementPasscodes();

  return writeStorageValue(
    PRIMARY_STORAGE,
    getManagementPasscodeStorageKey(lobbyId),
    managementCode
  );
}

export function forgetManagementPasscode(lobbyId: string): void {
  const storageKey = getManagementPasscodeStorageKey(lobbyId);

  removeStorageValue("localStorage", storageKey);
  removeStorageValue("sessionStorage", storageKey);
}

export function clearStoredManagementPasscodes(): void {
  clearManagementPasscodesFrom("localStorage");
  clearManagementPasscodesFrom("sessionStorage");
}

function findManagedLobbyId(kind: StorageKind): string | null {
  try {
    const storage = window[kind];

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (!key?.startsWith(MANAGEMENT_PASSCODE_STORAGE_PREFIX)) {
        continue;
      }

      const candidate = key.slice(MANAGEMENT_PASSCODE_STORAGE_PREFIX.length);
      const parsed = LobbyIdSchema.safeParse(candidate);

      if (parsed.success) {
        return parsed.data;
      }
    }
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }

  return null;
}

function readStorageValue(kind: StorageKind, key: string): string | null {
  try {
    return window[kind].getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(
  kind: StorageKind,
  key: string,
  value: string
): boolean {
  try {
    window[kind].setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorageValue(kind: StorageKind, key: string): void {
  try {
    window[kind].removeItem(key);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

function clearManagementPasscodesFrom(kind: StorageKind): void {
  try {
    const storage = window[kind];

    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);

      if (key?.startsWith(MANAGEMENT_PASSCODE_STORAGE_PREFIX)) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

export function buildMatchUrl(lobbyId: string): string {
  return `/g/${encodeURIComponent(lobbyId)}`;
}

export function buildManageUrl(lobbyId: string): string {
  return `/manage/${encodeURIComponent(lobbyId)}`;
}

export function buildOverlaysUrl(lobbyId: string): string {
  return `/g/${encodeURIComponent(lobbyId)}/obs`;
}

export function extractLobbyIdFromMatchReference(
  reference: string
): string | null {
  const trimmedReference = reference.trim();

  if (!trimmedReference) {
    return null;
  }

  const directCandidate = stripQueryAndHash(trimmedReference).replace(
    /^\/+|\/+$/g,
    ""
  );
  const directResult = LobbyIdSchema.safeParse(directCandidate);

  if (directResult.success) {
    return directResult.data;
  }

  try {
    const url = new URL(trimmedReference, URL_BASE);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] !== "g") {
      return null;
    }

    const parsed = LobbyIdSchema.safeParse(decodeURIComponent(parts[1] ?? ""));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function stripQueryAndHash(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? value;
}
