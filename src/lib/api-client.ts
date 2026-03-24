/**
 * Django API Client – same backend as web (Zenotimeflow-backend).
 * API base: `expo.extra.apiUrl` (from `app.config.js`) → `EXPO_PUBLIC_API_URL` → `http://127.0.0.1:8000`.
 *
 * Note: many backends bind to `0.0.0.0:8000` (listen on all interfaces). Mobile/web clients
 * must still call a reachable host (typically `localhost` or your LAN IP), not `0.0.0.0`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const TOKEN_KEY = '@zenotime/access_token';
const REFRESH_KEY = '@zenotime/refresh_token';

function normalizeApiUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return normalizeApiUrl('http://127.0.0.1:8000');
  try {
    const u = new URL(trimmed);
    // If someone sets EXPO_PUBLIC_API_URL=http://0.0.0.0:8000, translate to a reachable host.
    if (u.hostname === '0.0.0.0') u.hostname = 'localhost';

    // Backend routes in this project are mounted under `/api/`.
    // If the caller gave only `http://host:8000`, append `/api`.
    if (u.pathname === '' || u.pathname === '/') {
      u.pathname = '/api';
    } else if (!u.pathname.startsWith('/api')) {
      // If the base already includes some prefix (rare), still append `/api`.
      u.pathname = `${u.pathname.replace(/\/+$/, '')}/api`;
    }
    return u.toString().replace(/\/+$/, '');
  } catch {
    // Fallback: best-effort string normalization.
    const withoutTrailing = trimmed.replace(/\/+$/, '');
    const asHostFixed = withoutTrailing.replace(/^http:\/\/0\.0\.0\.0(?::(\d+))?/, (_m) => {
      return withoutTrailing.startsWith('http://0.0.0.0') ? withoutTrailing.replace('http://0.0.0.0', 'http://localhost') : withoutTrailing;
    });
    if (asHostFixed.endsWith('/api')) return asHostFixed;
    if (asHostFixed.endsWith('/')) return `${asHostFixed}api`;
    if (!asHostFixed.includes('/api')) return `${asHostFixed}/api`;
    return asHostFixed;
  }
}

/** Android emulator: host loopback is 10.0.2.2, not 127.0.0.1. Physical devices: set LAN IP in .env. */
function applyAndroidEmulatorHostFix(url: string): string {
  if (Platform.OS !== 'android') return url;
  if (Constants.isDevice === true) return url;
  try {
    const u = new URL(url);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
      u.hostname = '10.0.2.2';
      return u.toString().replace(/\/+$/, '');
    }
  } catch {
    /* ignore */
  }
  return url;
}

function getConfiguredApiOrigin(): string {
  // Expo Web: call same-origin `/api/...` so Metro can proxy to Django (see metro.config.js).
  // Hitting `http://127.0.0.1:8000` directly from the browser triggers CORS unless the backend allows the Expo origin.
  if (Platform.OS === 'web') {
    const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
    if (fromEnv) return applyAndroidEmulatorHostFix(normalizeApiUrl(fromEnv));
    return '/api';
  }
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  const fromExtra = extra?.apiUrl?.trim();
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  const raw = fromExtra || fromEnv || 'http://127.0.0.1:8000';
  return applyAndroidEmulatorHostFix(normalizeApiUrl(raw));
}

const API_URL = getConfiguredApiOrigin();
const API_TIMEOUT_MS = 30000;

function unwrapPayload(data: any): any {
  if (!data || typeof data !== 'object') return data;
  if ('data' in data && data.data != null) return unwrapPayload(data.data);
  return data;
}

function getAccessToken(data: any): string | undefined {
  const p = unwrapPayload(data);
  if (!p || typeof p !== 'object') return undefined;
  const nested = (p as any).tokens ?? (p as any).auth;
  return (
    (typeof p.access === 'string' ? p.access : undefined) ??
    (typeof (p as any).access_token === 'string' ? (p as any).access_token : undefined) ??
    (typeof (p as any).token === 'string' ? (p as any).token : undefined) ??
    (typeof (p as any).key === 'string' ? (p as any).key : undefined) ??
    (typeof nested?.access === 'string' ? nested.access : undefined) ??
    (typeof nested?.access_token === 'string' ? nested.access_token : undefined)
  );
}
function getRefreshToken(data: any): string | undefined {
  const p = unwrapPayload(data);
  if (!p || typeof p !== 'object') return undefined;
  const nested = (p as any).tokens ?? (p as any).auth;
  return (
    (typeof p.refresh === 'string' ? p.refresh : undefined) ??
    (typeof (p as any).refresh_token === 'string' ? (p as any).refresh_token : undefined) ??
    (typeof nested?.refresh === 'string' ? nested.refresh : undefined)
  );
}

/** Backend may return the user object directly or wrapped (e.g. `{ user: {...} }`). */
function normalizeUserPayload(raw: any): any {
  if (raw == null) return null;
  if (typeof raw !== 'object') return null;
  const inner = (raw as any).user ?? (raw as any).profile ?? (raw as any).data;
  const u = inner && typeof inner === 'object' ? inner : raw;
  if (typeof u !== 'object') return null;
  const withId = { ...u } as any;
  if (withId.id == null && withId.pk != null) withId.id = String(withId.pk);
  const hasIdentity =
    withId.id != null || withId.email != null || withId.username != null;
  return hasIdentity ? withId : null;
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
      if (Array.isArray(v)) {
        return v.map((x) => (typeof x === 'string' ? `${k}: ${x}` : `${k}: ${JSON.stringify(x)}`));
      }
      if (v != null && typeof v === 'object') {
        return [`${k}: ${JSON.stringify(v)}`];
      }
      return [`${k}: ${String(v)}`];
    });
    return parts.join('\n');
  }
  return '';
}

/** Thrown on non-2xx so callers can inspect `status` and `body` (e.g. DRF field errors). */
export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    Object.setPrototypeOf(this, HttpError.prototype);
  }
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

      const text = await response.text();
      const parseJsonSafe = (): any => {
        if (!text || !text.trim()) return {};
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      };

      if (response.status === 401) {
        await this.setToken(null);
        await AsyncStorage.removeItem(REFRESH_KEY);
        const err = parseJsonSafe() ?? {};
        const msg = (err as any).detail || err?.message || 'Unauthorized';
        throw new HttpError(typeof msg === 'string' ? msg : String(msg), 401, err);
      }
      if (response.status === 403) {
        const err = parseJsonSafe() ?? {};
        const msg = (err as any)?.detail || (err as any)?.message || "You don't have permission.";
        throw new HttpError(typeof msg === 'string' ? msg : String(msg), 403, err);
      }
      if (!response.ok) {
        const parsed = parseJsonSafe();
        const err =
          (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {}) as Record<string, unknown>;
        const rawSnippet = text.trim().slice(0, 400);
        const msg = extractErrorMessage(err) || rawSnippet || `HTTP ${response.status}`;
        throw new HttpError(msg, response.status, err);
      }

      const trimmed = text.trim();
      if (!trimmed) return {} as T;

      const contentType = response.headers.get('content-type') || '';
      const looksJson =
        contentType.includes('application/json') ||
        contentType.includes('text/json') ||
        contentType.includes('+json') ||
        trimmed.startsWith('{') ||
        trimmed.startsWith('[');

      if (looksJson) {
        try {
          return JSON.parse(trimmed) as T;
        } catch {
          throw new Error(`Invalid JSON in response (${response.status}) from ${url}`);
        }
      }

      throw new Error(
        `Expected JSON from API but received ${contentType || 'non-JSON'} (HTTP ${response.status}). ` +
          `Check EXPO_PUBLIC_API_URL / app.config extra.apiUrl — the app must call the JSON API base (e.g. …/api), not an HTML page.`
      );
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof Error && e.name === 'AbortError') throw new Error('Request timed out.');
      if (e instanceof TypeError && typeof e.message === 'string' && e.message.toLowerCase().includes('fetch failed')) {
        throw new Error(`Network error: cannot reach ${url}. Check EXPO_PUBLIC_API_URL (and that the backend is running).`);
      }
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
    let response: any;
    try {
      response = await this.post<any>('/auth/login/', { username: trimmed, password });
    } catch (firstErr: any) {
      const msg = String(firstErr?.message || '').toLowerCase();
      const tryEmail =
        trimmed.includes('@') &&
        msg.includes('required') &&
        !msg.includes('invalid');
      if (tryEmail) {
        try {
          response = await this.post<any>('/auth/login/', { email: trimmed, password });
        } catch {
          throw firstErr;
        }
      } else {
        throw firstErr;
      }
    }
    const access = getAccessToken(response);
    const refresh = getRefreshToken(response);
    if (!access) throw new Error('Invalid login response: no access token');
    await this.setToken(access);
    if (refresh) await AsyncStorage.setItem(REFRESH_KEY, refresh);
    return response;
  }

  /**
   * Login then resolve the signed-in user. JWT endpoints often return only `access`/`refresh`;
   * we load `/auth/user/` when `user` is not embedded in the login response.
   */
  async loginWithSession(usernameOrEmail: string, password: string) {
    const response = await this.login(usernameOrEmail, password);
    const access = getAccessToken(response)!;
    const refresh = getRefreshToken(response);
    const payload = unwrapPayload(response);
    let user = normalizeUserPayload(payload?.user ?? (response as any)?.user);
    if (!user) {
      user = normalizeUserPayload(await this.getCurrentUser());
    }
    if (!user) throw new Error('Login succeeded but user profile could not be loaded.');
    return { user, access, refresh, response };
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
    const raw = await this.get<any>('/auth/user/');
    return normalizeUserPayload(raw);
  }
}

export const apiClient = new ApiClient();
export default apiClient;
