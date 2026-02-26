/**
 * Central API configuration.
 *
 * In the browser, if NEXT_PUBLIC_API_URL is not set, we derive the backend URL
 * from the current browser location (same host, port 8080). This makes the app
 * work on any host/IP without rebuilding.
 */
function getApiUrl(): string {
  // Explicit env var always wins
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  // Browser: derive from current location
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }

  // SSR fallback
  return 'http://localhost:8080';
}

export const API_URL = getApiUrl();
export const API_BASE = `${API_URL}/api/v1`;
