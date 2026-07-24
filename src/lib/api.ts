const BASE_URL = import.meta.env.VITE_API_URL || '/api';

function getToken(): string | null {
  try {
    const stored = localStorage.getItem('auth-session-v2');
    if (stored) {
      const data = JSON.parse(stored);
      return data?.state?.user?.token || null;
    }
  } catch (e) {
    console.error('Failed to get token:', e);
  }
  return null;
}

async function request<T>(path: string, options: RequestInit & { params?: Record<string, any> } = {}): Promise<T> {
  let url = `${BASE_URL}${path}`;
  
  if (options.params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    if (searchParams.toString()) {
      url += `?${searchParams.toString()}`;
    }
  }
  
  const token = getToken();
  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  const { params: _, ...restOptions } = options;

  const response = await fetch(url, {
    ...restOptions,
    headers: {
      ...defaultHeaders,
      ...restOptions.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  get: <T>(path: string, options?: RequestInit & { params?: Record<string, any> }) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, data?: any, options?: RequestInit) =>
    request<T>(path, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),
  put: <T>(path: string, data?: any, options?: RequestInit) =>
    request<T>(path, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),
  delete: <T>(path: string, options?: RequestInit) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  getBaseUrl: () => BASE_URL,
  getToken,
};
