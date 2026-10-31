/** Keeps an invitation token across the sign-in/sign-up detour (this tab only). */
const KEY = "inother_pending_invite";
export function savePendingInvite(token: string): void {
  try { sessionStorage.setItem(KEY, token); } catch { /* ignore */ }
}
export function takePendingInvite(): string | null {
  try {
    const t = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return t;
  } catch {
    return null;
  }
}
export function hasPendingInvite(): boolean {
  try { return sessionStorage.getItem(KEY) !== null; } catch { return false; }
}
