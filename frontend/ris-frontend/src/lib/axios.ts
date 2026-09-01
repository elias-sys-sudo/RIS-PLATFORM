import axios, {
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import { deepCamelCase, deepSnakeCase } from './case-convert';
import { useAuthStore } from '../store/auth.store';

// ── Request queue ────────────────────────────────────────────────────────────
// Requests that arrive while a token refresh is in flight are queued here.
// Once the refresh resolves they are retried with the new token; on failure
// they are rejected.

type QueueItem = {
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
};

let isRefreshing = false;
const pendingQueue: QueueItem[] = [];

function drainQueue(err: unknown, token: string | null): void {
  pendingQueue.forEach(({ resolve, reject }) => {
    if (err !== null || token === null) reject(err);
    else resolve(token);
  });
  pendingQueue.length = 0;
}

// ── Axios instance ───────────────────────────────────────────────────────────

export const apiClient: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Attach access token and convert camelCase body keys → snake_case for the backend
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // FormData uploads must NOT carry the default 'Content-Type: application/json'
  // header — multer needs to read the multipart boundary that the browser
  // generates for us. Deleting the header lets axios + the browser set
  // 'multipart/form-data; boundary=...' automatically. Without this, multer
  // sees no parts and the route returns "No file provided".
  if (config.data instanceof FormData) {
    if (config.headers) {
      delete (config.headers as Record<string, unknown>)['Content-Type'];
      delete (config.headers as Record<string, unknown>)['content-type'];
    }
  } else if (config.data !== undefined) {
    // Skip FormData (multipart uploads must not have their keys mangled)
    config.data = deepSnakeCase(config.data);
  }
  return config;
});

// Custom DOM event fired when a network-level failure is detected (no HTTP response).
// The NetworkErrorProvider listens for this to show the "Connection lost" banner.
export const NETWORK_ERROR_EVENT = 'mms:network-error';

// Interceptor contract:
//   • 401 + refresh succeeds → retry the original request transparently.
//   • 401 + refresh fails    → clear session and redirect to /login.
//   • 403                    → reject with code='FORBIDDEN' so the calling
//                              component / route guard can show an
//                              "Access denied" UI. We do NOT log the user
//                              out — they are authenticated, just not
//                              authorised for that specific resource.
//   • Any other 4xx/5xx      → reject as-is.
// Concurrent 401s are queued until the single refresh resolves.
// All successful responses have their keys converted from snake_case → camelCase.
apiClient.interceptors.response.use(
  (response) => {
    // Skip case conversion for binary responses (blob, arraybuffer)
    if (response.config.responseType === 'blob' || response.config.responseType === 'arraybuffer') {
      return response;
    }
    response.data = deepCamelCase(response.data);
    return response;
  },
  async (error: unknown) => {
    const axiosError = error as {
      response?: { status: number };
      config?: InternalAxiosRequestConfig & { _retry?: boolean };
      code?: string;
    };

    // Fire a custom event for network-level failures (no HTTP response received)
    if (!axiosError.response) {
      window.dispatchEvent(new CustomEvent(NETWORK_ERROR_EVENT));
    }

    const status = axiosError.response?.status;
    const config = axiosError.config;

    // 403 is an authorisation failure (user IS logged in, just lacks rights
    // for this resource). Tag it so a global error boundary / toast can show
    // an "Access denied" message, and reject WITHOUT touching the session or
    // redirecting to /login. Splitting this out keeps a 403 from ever
    // reaching the 401-refresh path below.
    if (status === 403) {
      (error as { code?: string }).code = 'FORBIDDEN';
      return Promise.reject(error);
    }

    if (status !== 401 || config?._retry) {
      return Promise.reject(error);
    }

    // No access token in memory → user isn't logged in. Don't attempt refresh,
    // just reject so the caller can route to /login. Otherwise the user sees
    // a misleading "refresh token invalid/expired" message on a fresh page load.
    if (!useAuthStore.getState().accessToken) {
      return Promise.reject(error);
    }

    // Queue subsequent 401s while refresh is in flight
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        pendingQueue.push({ resolve, reject });
      }).then((newToken) => {
        if (config?.headers) config.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(config!);
      });
    }

    if (config) config._retry = true;
    isRefreshing = true;

    try {
      // Use a plain axios call (not apiClient) to avoid another intercept loop.
      // Refresh token is sent automatically via httpOnly cookie.
      const { data } = await axios.post<{ accessToken: string }>(
        '/api/auth/refresh',
        {},
        { withCredentials: true },
      );

      useAuthStore.getState().setTokens(data.accessToken);

      drainQueue(null, data.accessToken);

      if (config?.headers) {
        config.headers.Authorization = `Bearer ${data.accessToken}`;
      }
      return apiClient(config!);
    } catch (refreshErr) {
      drainQueue(refreshErr, null);

      // Defensive: only the original-401 path can land here, but if somehow
      // a non-401 error reaches this branch, do NOT redirect — the original
      // request was not an auth failure and the user should stay where they
      // are so the component can surface the error.
      if (status !== 401) {
        return Promise.reject(refreshErr);
      }

      // Clear session and redirect to login (401 + refresh failed)
      useAuthStore.setState({
        accessToken: null,
        user: null,
        isAuthenticated: false,
        role: null,
      });
      window.location.href = '/login';

      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  },
);
