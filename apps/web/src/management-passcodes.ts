import { LobbyIdSchema } from "@gaming-gauntlet/core";

const MANAGEMENT_PASSCODE_STORAGE_PREFIX =
  "gaming-gauntlet:v1:management-passcode:";
const URL_BASE = "https://gaming-gauntlet.local";

export function getManagementPasscodeStorageKey(lobbyId: string): string {
  return `${MANAGEMENT_PASSCODE_STORAGE_PREFIX}${lobbyId}`;
}

export function storeManagementPasscode(
  lobbyId: string,
  managementCode: string
): boolean {
  try {
    window.localStorage.setItem(
      getManagementPasscodeStorageKey(lobbyId),
      managementCode
    );
    return true;
  } catch {
    return false;
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

export function extractLobbyIdFromMatchReference(reference: string): string | null {
  const trimmedReference = reference.trim();

  if (!trimmedReference) {
    return null;
  }

  const directCandidate = stripQueryAndHash(trimmedReference).replace(/^\/+|\/+$/g, "");
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
