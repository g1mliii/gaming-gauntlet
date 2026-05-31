// Full-page navigation helper. The app has no client router — routing is read
// once from window.location and links use real browser navigation. Centralizing
// the programmatic navigation here lets the create/join flows redirect straight
// into the match room (and lets tests stub navigation without touching jsdom's
// unimplemented location.assign).
export function navigateTo(path: string): void {
  window.location.assign(path);
}
