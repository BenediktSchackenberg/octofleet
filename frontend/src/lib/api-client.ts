import { API_BASE } from './api-config';
import { getAuthHeader } from './auth-context';
import { toast } from 'sonner';

interface RequestOptions extends RequestInit {
  showErrorToast?: boolean;
}

async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T | null> {
  const { showErrorToast = true, ...fetchOptions } = options;
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
      const errorMessage = errorData.detail || errorData.message || `Fehler ${response.status}: ${response.statusText}`;
      
      if (showErrorToast) {
        toast.error('API Fehler', {
          description: errorMessage,
          duration: 5000,
        });
      }
      
      if (response.status === 401 && typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        // Optionale automatische Abmeldung bei 401
        // window.location.href = '/login?expired=true';
      }
      
      return null;
    }

    // Health check returns simple text/json
    if (endpoint === '/health' || endpoint.endsWith('/health')) {
        return await response.json();
    }

    return await response.json() as T;
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

export const apiClient = {
  get: <T>(endpoint: string, options?: RequestOptions) => 
    apiRequest<T>(endpoint, { ...options, method: 'GET' }),
  
  post: <T>(endpoint: string, body: any, options?: RequestOptions) => 
    apiRequest<T>(endpoint, { 
      ...options, 
      method: 'POST', 
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...options?.headers }
    }),
  
  put: <T>(endpoint: string, body: any, options?: RequestOptions) => 
    apiRequest<T>(endpoint, { 
      ...options, 
      method: 'PUT', 
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...options?.headers }
    }),
  
  delete: <T>(endpoint: string, options?: RequestOptions) => 
    apiRequest<T>(endpoint, { ...options, method: 'DELETE' }),
};
