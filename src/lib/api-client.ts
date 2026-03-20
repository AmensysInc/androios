/**
 * Django API Client – same backend as web (Zenotimeflow-backend).
 * Use EXPO_PUBLIC_API_URL or default to localhost.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = '@zenotime/access_token';
const REFRESH_KEY = '@zenotime/refresh_token';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8085/api';
const API_TIMEOUT_MS = 30000;

function getAccessToken(data: any): string | undefined {
  return data?.access ?? data?.access_token;
}
function getRefreshToken(data: any): string | undefined {
  return data?.refresh ?? data?.refresh_token;
}

function extractErrorMessage(err: Record<string, unknown>): string {
  if (!err || typeof err !== 'object') return '';
  const d = err.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  const msg = err.message;
  if (typeof msg === 'string') return msg;
  const keys = Object.keys(err).filter((k) => k !== 'message' && k !== 'detail');
  if (keys.length) {
    const parts = keys.flatMap((k) => {
      const v = (err as any)[k];
      return Array.isArray(v) ? v : [String(v)];
    });
    return parts.join(' ');
  }
  return '';
}

export class ApiClient {
  private baseURL: string = API_URL;
  private token: string | null = null;

  async setToken(token: string | null) {
    this.token = token;
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  }

  async getToken(): Promise<string | null> {
    if (this.token) return this.token;
    const stored = await AsyncStorage.getItem(TOKEN_KEY);
    if (stored) this.token = stored;
    return stored;
  }

  private buildURL(endpoint: string, params?: Record<string, any>): string {
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${this.baseURL.replace(/\/$/, '')}${path}`;
    if (!params || !Object.keys(params).length) return url;
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') search.append(k, String(v));
    });
    return `${url}?${search.toString()}`;
  }

  private async request<T>(endpoint: string, options: RequestInit & { params?: Record<string, any> } = {}): Promise<T> {
    const { params, ...init } = options;
    const url = this.buildURL(endpoint, params);
    const token = this.token ?? (await AsyncStorage.getItem(TOKEN_KEY));
    if (token) this.token = token;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: init.signal ?? controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.status === 401) {
        await this.setToken(null);
        await AsyncStorage.removeItem(REFRESH_KEY);
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any).detail || err?.message || 'Unauthorized');
      }
      if (response.status === 403) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any)?.detail || (err as any)?.message || "You don't have permission.");
      }
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(extractErrorMessage(err) || `HTTP ${response.status}`);
      }
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) return response.json() as Promise<T>;
      return {} as T;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof Error && e.name === 'AbortError') throw new Error('Request timed out.');
      throw e;
    }
  }

  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', params });
  }
  async post<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body: data ? JSON.stringify(data) : undefined });
  }
  async put<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, { method: 'PUT', body: data ? JSON.stringify(data) : undefined });
  }
  async patch<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined });
  }
  async delete<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE', params });
  }

  async login(usernameOrEmail: string, password: string) {
    const trimmed = usernameOrEmail.trim();
    const response = await this.post<any>('/auth/login/', { username: trimmed, password });
    const access = getAccessToken(response);
    const refresh = getRefreshToken(response);
    if (!access) throw new Error('Invalid login response: no access token');
    await this.setToken(access);
    if (refresh) await AsyncStorage.setItem(REFRESH_KEY, refresh);
    return response;
  }

  async employeeLogin(usernameOrEmail: string, pin: string) {
    const trimmed = usernameOrEmail.trim();
    let response: any;
    try {
      response = await this.post<any>('/auth/employee-login/', { username: trimmed, pin });
    } catch (e: any) {
      if (e?.message?.includes('404') || e?.message?.toLowerCase()?.includes('not found')) {
        response = await this.post<any>('/auth/login/', { username: trimmed, password: pin });
      } else throw e;
    }
    const access = getAccessToken(response);
    const refresh = getRefreshToken(response);
    if (!access) throw new Error('Invalid login response: no access token');
    await this.setToken(access);
    if (refresh) await AsyncStorage.setItem(REFRESH_KEY, refresh);
    return response;
  }

  async logout() {
    const refreshToken = await AsyncStorage.getItem(REFRESH_KEY);
    if (refreshToken) {
      try {
        await this.post('/auth/logout/', { refresh: refreshToken });
      } catch (e) {
        console.error('Logout error:', e);
      }
    }
    await this.setToken(null);
    await AsyncStorage.removeItem(REFRESH_KEY);
  }

  async getCurrentUser() {
    return this.get<any>('/auth/user/');
  }
}

export const apiClient = new ApiClient();
export default apiClient;
