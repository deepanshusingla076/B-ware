import { auth } from '@/lib/firebase';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

async function apiCall<T = any>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { skipAuth = false, headers: customHeaders, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(customHeaders as Record<string, string>),
  };

  if (!skipAuth && auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${idToken}`;
    } catch {
      // proceed without auth header
    }
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: `HTTP ${response.status}`,
    }));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  if (response.status === 204) return {} as T;
  return response.json();
}

export const authApi = {
  sync: () => apiCall('/auth/sync', { method: 'POST' }),
  getMe: () => apiCall('/auth/me', { method: 'GET' }),
  logout: () => apiCall('/auth/logout', { method: 'POST' }),
  forgotPassword: (email: string) =>
    apiCall('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
      skipAuth: true,
    }),
  resendVerification: () => apiCall('/auth/verify-email', { method: 'POST' }),
  getVerifiedStatus: () => apiCall('/auth/verify-email/status', { method: 'GET' }),
};

export const claimsApi = {
  verify: (text: string) =>
    apiCall('/claims/verify', { method: 'POST', body: JSON.stringify({ text }) }),
  quick: (text: string) =>
    apiCall('/claims/quick', { method: 'POST', body: JSON.stringify({ text }) }),
  deep: (text: string) =>
    apiCall('/claims/deep', { method: 'POST', body: JSON.stringify({ text }) }),
  batch: (claims: string[]) =>
    apiCall('/claims/batch', { method: 'POST', body: JSON.stringify({ claims }) }),
  getHistory: (page = 1, limit = 20) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    return apiCall(`/claims?${params}`, { method: 'GET' });
  },
  getById: (id: string | number) => apiCall(`/claims/${id}`, { method: 'GET' }),
  getStats: () => apiCall('/claims/stats', { method: 'GET' }),
};

export const trendingApi = {
  getTrending: (filter = 'all', limit = 20, sources?: string[]) => {
    const params = new URLSearchParams({ filter, limit: String(limit) });
    if (sources?.length) params.append('sources', sources.join(','));
    return apiCall(`/trending?${params}`, { method: 'GET' });
  },
  getById: (id: string | number) => apiCall(`/trending/${id}`, { method: 'GET' }),
  getSourceStats: () => apiCall('/trending/sources', { method: 'GET' }),
  getLive: () => apiCall('/trending/live', { method: 'GET', skipAuth: true }),
  refresh: () => apiCall('/trending/refresh', { method: 'POST' }),
};

export const outletsApi = {
  getAvailable: () => apiCall('/outlets/available', { method: 'GET' }),
  getUserOutlets: () => apiCall('/outlets', { method: 'GET' }),
  updateUserOutlets: (outlets: string[]) =>
    apiCall('/outlets', { method: 'POST', body: JSON.stringify({ outlets }) }),
};

export { apiCall };
