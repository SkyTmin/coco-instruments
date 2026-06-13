// Tiny runtime facts resolved once at boot (src/main.tsx), readable anywhere
// without prop-drilling or React context.

let webMode = false;

/** True when the app runs as a website (browser), not as a Telegram Mini App. */
export function isWebMode(): boolean {
  return webMode;
}

export function setWebMode(value: boolean): void {
  webMode = value;
}
