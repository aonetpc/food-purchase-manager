const BASE_URL = import.meta.env.VITE_API_URL || '/api';
const DEFAULT_TIMEOUT = 35000; // 默认35秒超时（后端30秒超时+5秒缓冲）

function getToken(): string | null {
  try {
    const stored = localStorage.getItem('auth-session-v2');
    if (stored) {
      const data = JSON.parse(stored);
      if (data?.state?.user?.token) return data.state.user.token;
    }
    const storedLegacy = localStorage.getItem('auth-session');
    if (storedLegacy) {
      const data = JSON.parse(storedLegacy);
      if (data?.state?.user?.token) return data.state.user.token;
    }
  } catch (e) {
    console.error('Failed to get token:', e);
  }
  return null;
}

async function request<T>(path: string, options: RequestInit & { params?: Record<string, any>; timeout?: number } = {}): Promise<T> {
  let url = `${BASE_URL}${path}`;
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  
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

  const { params: _, timeout: __, ...restOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...restOptions,
      headers: {
        ...defaultHeaders,
        ...restOptions.headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: '请求失败' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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
