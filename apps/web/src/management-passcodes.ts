import { LobbyIdSchema } from "@gaming-gauntlet/core";

const MANAGEMENT_PASSCODE_STORAGE_PREFIX =
  "gaming-gauntlet:v1:management-passcode:";
const URL_BASE = "https://gaming-gauntlet.local";
type StorageKind = "localStorage" | "sessionStorage";

export function getManagementPasscodeStorageKey(lobbyId: string): string {
  return `${MANAGEMENT_PASSCODE_STORAGE_PREFIX}${lobbyId}`;
}

export function readStoredManagementPasscode(lobbyId: string): string | null {
  const storageKey = getManagementPasscodeStorageKey(lobbyId);
  const sessionValue = readStorageValue("sessionStorage", storageKey);

  if (sessionValue) {
    return sessionValue;
  }

  const legacyValue = readStorageValue("localStorage", storageKey);

  if (legacyValue) {
    // Migrate only this lobby's legacy passcode into the session and scrub its
    // localStorage copy. Leave other lobbies' legacy entries alone — they get
    // cleared lazily when each is read, or in bulk on the next store.
    removeStorageValue("localStorage", storageKey);
    writeStorageValue("sessionStorage", storageKey, legacyValue);
  }

  return legacyValue;
}

export function storeManagementPasscode(
  lobbyId: string,
  managementCode: string
): boolean {
  clearStoredManagementPasscodes();

  return writeStorageValue(
    "sessionStorage",
    getManagementPasscodeStorageKey(lobbyId),
    managementCode
  );
}

export function forgetManagementPasscode(lobbyId: string): void {
  const storageKey = getManagementPasscodeStorageKey(lobbyId);

  removeStorageValue("sessionStorage", storageKey);
  removeStorageValue("localStorage", storageKey);
}

export function clearStoredManagementPasscodes(): void {
  clearManagementPasscodesFrom("sessionStorage");
  clearManagementPasscodesFrom("localStorage");
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
