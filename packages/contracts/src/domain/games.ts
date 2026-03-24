export function normalizeGameTitle(title: string): string {
  return title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createCanonicalGameKey(title: string): string {
  return normalizeGameTitle(title).replace(/\s+/g, "-");
}

export function shouldAutoMergeSuggestions(left: string, right: string): boolean {
  return createCanonicalGameKey(left) === createCanonicalGameKey(right);
}
