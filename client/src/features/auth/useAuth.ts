import axios, { type InternalAxiosRequestConfig } from 'axios';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authResponseSchema, type AuthUser } from '@may-cafe/contracts';
import { api, unwrap } from '../../lib/api';

export type { AuthUser };

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  sessionEpoch: number;
  setSession: (token: string, user: AuthUser) => void;
  clearSession: () => void;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      user: null,
      sessionEpoch: 0,
      setSession(token, user) {
        set((s) => ({ accessToken: token, user, sessionEpoch: s.sessionEpoch + 1 }));
      },
      clearSession() {
        set((s) => ({ accessToken: null, user: null, sessionEpoch: s.sessionEpoch + 1 }));
      },
      async logout() {
        get().clearSession();
        try {
          await api.post('/auth/logout');
        } catch {
          // ignore network errors on logout
        }
      },
    }),
    {
      name: 'mc-auth',
      partialize: (state) => ({ accessToken: state.accessToken, user: state.user }),
    },
  ),
);

api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

const AUTH_PATHS_WITHOUT_REFRESH = ['/auth/login', '/auth/logout', '/auth/refresh'];

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const epochAtStart = useAuth.getState().sessionEpoch;
  try {
    const res = await api.post('/auth/refresh');
    const data = authResponseSchema.parse(unwrap(res));
    const state = useAuth.getState();
    if (state.sessionEpoch !== epochAtStart || state.accessToken === null) {
      return null;
    }
    state.setSession(data.accessToken, data.user);
    return data.accessToken;
  } catch {
    if (useAuth.getState().sessionEpoch === epochAtStart) {
      useAuth.getState().clearSession();
    }
    return null;
  } finally {
    refreshInFlight = null;
  }
}

api.interceptors.response.use(undefined, async (error: unknown) => {
  if (!axios.isAxiosError(error)) throw error;
  const config = error.config as RetriableConfig | undefined;
  if (error.response?.status !== 401 || !config) throw error;
  const url = config.url ?? '';
  const isAuthPath =
    url.startsWith('/members/') ||
    AUTH_PATHS_WITHOUT_REFRESH.some((p) => url === p || url.endsWith(p));
  const hasStaffSession = useAuth.getState().accessToken !== null;
  if (isAuthPath || config._retry || !hasStaffSession) throw error;
  config._retry = true;
  const refreshed = refreshInFlight ?? (refreshInFlight = refreshAccessToken());
  const token = await refreshed;
  if (!token) throw error;
  return api.request(config);
});

export async function fetchMe(): Promise<void> {
  const data = await unwrap(await api.get<AuthUser>('/auth/me'));
  useAuth.getState().setSession(useAuth.getState().accessToken ?? '', data);
}
