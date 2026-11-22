/**
 * Response headers for every page we serve (Vercel in production, `vite preview` in tests, the dormant local server).
 * One source of truth: vercel.json is checked against this in tests, so the hosted site cannot drift.
 * The UI runs with no inline scripts or styles and no external hosts, except Twitch: id.twitch.tv for the optional login
 * (src/ui/data/twitch-flow.ts) and api.twitch.tv for the optional moderator check and mod/VIP lists
 * (src/ui/data/helix-api.ts). That is all the network traffic beyond its own origin, and the config never goes there.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://id.twitch.tv https://api.twitch.tv",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
