import WebApp from '@twa-dev/sdk';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const JWT_STORAGE_KEY = 'teraye_mobile_jwt';
const STATIONS_CACHE_KEY = 'teraye_stations_cache';

/**
 * Detects whether the app is running inside Telegram WebView
 */
export function isTelegramMiniApp(): boolean {
  return Boolean(typeof window !== 'undefined' && WebApp?.initData);
}

/**
 * Saves or clears the Mobile App JWT token
 */
export function setMobileToken(token: string | null) {
  if (token) {
    localStorage.setItem(JWT_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(JWT_STORAGE_KEY);
  }
}

export function getMobileToken(): string | null {
  return localStorage.getItem(JWT_STORAGE_KEY);
}

/**
 * Unified Fetch Wrapper:
 * Automatically injects Telegram initData OR Mobile Bearer JWT on every API call.
 */
export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  if (isTelegramMiniApp()) {
    headers.set('x-telegram-init-data', WebApp.initData);
  } else {
    const token = getMobileToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data as T;
}

/**
 * Loads stations & routes with LocalStorage fallback for slow 3G / offline resilience
 */
export async function fetchStationsWithCache() {
  try {
    const data = await apiFetch<{ stations: any[] }>('/stations');
    localStorage.setItem(STATIONS_CACHE_KEY, JSON.stringify(data.stations));
    return data.stations;
  } catch (err) {
    const cached = localStorage.getItem(STATIONS_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
    throw err;
  }
}