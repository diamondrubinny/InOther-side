/**
 * Email links carry their token in the URL fragment (#token=...), which browsers never send to
 * servers or in Referer headers. After reading it we remove it from the address bar/history.
 */
export function readHashToken(): string | null {
  const match = /(?:^#|&)token=([A-Za-z0-9_-]{20,200})/.exec(window.location.hash);
  if (match?.[1]) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return match[1];
  }
  return null;
}
