import { API_BASE } from './api-config';
import { getAuthHeader } from './auth-context';
import { toast } from 'sonner';

// ─── Types ───────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  status: number;
}

interface RequestOptions extends RequestInit {
  showErrorToast?: boolean;
  camelCase?: boolean;
}

// ─── snake_case → camelCase mapper ───────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function snakeToCamel(obj: any): any {
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        snakeToCamel(v),
      ])
    );
  }
  return obj;
}

// ─── 401 handler (configurable, keeps transport layer clean) ─────────

let onUnauthorized: (() => void) | null = () => {
  if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
    window.location.href = '/login?expired=true';
  }
};

function handlePasswordChangeRequired(response: Response, message: string) {
  if (response.status !== 403 || message !== "Password change required" || typeof window === "undefined") return;
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    localStorage.setItem("user", JSON.stringify({ ...user, must_change_password: true }));
  } catch { /* The server still enforces the requirement. */ }
  if (window.location.pathname !== "/change-password") window.location.assign("/change-password");
}

export function setOnUnauthorized(handler: (() => void) | null) {
  onUnauthorized = handler;
}

// ─── Error message ──────────────────────────────────────────────────

/**
 * Turns an error body into text. `detail` is a string for plain HTTPExceptions,
 * an object ({ error, message, details }) for the API's structured errors and a
 * list for validation errors; rendering an object in a toast crashes the page.
 */
function errorMessageFrom(errorData: unknown, response: Response): string {
  const body = (errorData ?? {}) as { detail?: unknown; message?: unknown };
  const detail = body.detail ?? body.message;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((d) => (typeof d?.msg === 'string' ? d.msg : '')).filter(Boolean);
    if (messages.length) return messages.join('; ');
  } else if (detail && typeof detail === 'object') {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return `Fehler ${response.status}: ${response.statusText}`;
}

// ─── Core request (returns T | null for backward compat) ────────────

async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T | null> {
  const { showErrorToast = true, camelCase = false, ...fetchOptions } = options;
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  const headers = new Headers(options.headers || {});
  const authHeaders = getAuthHeader();
  Object.entries(authHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorMessageFrom(errorData, response);
      handlePasswordChangeRequired(response, errorMessage);

      if (showErrorToast) {
        toast.error('API Fehler', {
          description: errorMessage,
          duration: 5000,
        });
      }

      if (response.status === 401 && onUnauthorized) { onUnauthorized(); }

      return null;
    }

    let data = await response.json() as T;
    if (camelCase) {
      data = snakeToCamel(data);
    }
    return data;
  } catch (error) {
    if (showErrorToast) {
      toast.error('Netzwerkfehler', {
        description: 'Verbindung zum Octofleet-Server fehlgeschlagen.',
        duration: 5000,
      });
    }
    console.error(`API Request to ${endpoint} failed:`, error);
    return null;
  }
}

// ─── Rich request (returns ApiResponse<T>) ──────────────────────────

async function apiRequestRich<T>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { showErrorToast = true, camelCase = false, ...fetchOptions } = options;
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  const headers = new Headers(options.headers || {});
  const authHeaders = getAuthHeader();
  Object.entries(authHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorMessageFrom(errorData, response);
      handlePasswordChangeRequired(response, errorMessage);

      if (showErrorToast) {
        toast.error('API Fehler', { description: errorMessage, duration: 5000 });
      }

      if (response.status === 401 && onUnauthorized) { onUnauthorized(); }

      return { ok: false, data: null, error: errorMessage, status: response.status };
    }

    let data = await response.json() as T;
    if (camelCase) {
      data = snakeToCamel(data);
    }
    return { ok: true, data, error: null, status: response.status };
  } catch (error) {
    if (showErrorToast) {
      toast.error('Netzwerkfehler', {
        description: 'Verbindung zum Octofleet-Server fehlgeschlagen.',
        duration: 5000,
      });
    }
    console.error(`API Request to ${endpoint} failed:`, error);
    return { ok: false, data: null, error: String(error), status: 0 };
  }
}

// ─── Public API (backward compatible) ───────────────────────────────

export const apiClient = {
  request: apiRequestRich,
  get: <T>(endpoint: string, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(endpoint: string, body: unknown, options?: RequestOptions) =>
    apiRequest<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    }),

  put: <T>(endpoint: string, body: unknown, options?: RequestOptions) =>
    apiRequest<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    }),

  patch: <T>(endpoint: string, body: unknown, options?: RequestOptions) =>
    apiRequest<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    }),

  delete: <T>(endpoint: string, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { ...options, method: 'DELETE' }),

  // Rich variants that return ApiResponse<T>
  richGet: <T>(endpoint: string, options?: RequestOptions) =>
    apiRequestRich<T>(endpoint, { ...options, method: 'GET' }),

  richPost: <T>(endpoint: string, body: unknown, options?: RequestOptions) =>
    apiRequestRich<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    }),
};
