/** The participant token, given once by `join`: kept as the device token is. */
const tokenKey = "bellpr-participant-token";
let memoryToken = "";

export function participantToken(): string {
  try {
    return localStorage.getItem(tokenKey)?.trim() || memoryToken.trim();
  } catch {
    return memoryToken.trim();
  }
}

export function keepParticipantToken(token: string): void {
  memoryToken = token;
  try {
    localStorage.setItem(tokenKey, token);
  } catch {
    // Storage is unavailable: the token lasts as long as the page.
  }
}

export function participantHeaders(): Record<string, string> {
  const token = participantToken();
  return token ? { "X-Bell-Participant": token } : {};
}
