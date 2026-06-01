export const PUBLIC_SITE_ORIGIN = "https://gaming-gauntlet.com";

export function buildPublicUrl(path: string): string {
  return new URL(path, PUBLIC_SITE_ORIGIN).toString();
}
