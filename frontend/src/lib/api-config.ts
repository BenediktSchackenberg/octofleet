/**
 * Central API configuration.
 *
 * Where the browser finds the backend, in this order:
 * 1. `BROWSER_API_URL` on the frontend container (runtime, delivered by
 *    /runtime-config.js) or `NEXT_PUBLIC_API_URL` baked in at build time.
 * 2. Page served on port 3000 (default install without reverse proxy):
 *    same host, port 8080.
 * 3. Otherwise (behind a reverse proxy): the page's own origin, i.e. `/api/v1/...`.
 */

declare global {
  interface Window {
    __OCTOFLEET_CONFIG__?: { apiUrl?: string };
  }
}

function getApiUrl(): string {
  // SSR fallback (client components only call the API in the browser)
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  }

  const configured = window.__OCTOFLEET_CONFIG__?.apiUrl || process.env.NEXT_PUBLIC_API_URL;
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  // Default docker-compose without proxy: UI on :3000, API on :8080
  if (window.location.port === '3000') {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }

  // Same origin (reverse proxy forwards /api to the backend)
  return '';
}

export const API_URL = getApiUrl();
export const API_BASE = `${API_URL}/api/v1`;

/** WebSocket URL for an API path such as `/shell/ws/<id>` (ws:// or wss:// to match the API). */
export function apiWebSocketUrl(path: string): string {
  const url = new URL(`${API_BASE}${path}`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
