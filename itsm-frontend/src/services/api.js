import axios from 'axios';

/** Base URL of the ITSM backend. Override with VITE_API_BASE in .env. */
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000/api';

const SESSION_KEY = 'itsm.session';

const API = axios.create({ baseURL: API_BASE, timeout: 20000 });

/* ------------------------------------------------------------------ session */

/** Persist the signed-in user so a refresh keeps the session. */
export function saveSession({ token, user }) {
  const session = { token, user };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    return session?.token && session?.user ? session : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/* --------------------------------------------------------------- interceptors */

API.interceptors.request.use((config) => {
  const session = readSession();
  if (session?.token) config.headers.Authorization = `Bearer ${session.token}`;
  return config;
});

API.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = String(error.config?.url || '');
    // An expired/invalid token should drop the session, but a failed sign-in
    // attempt must surface its own message.
    if (status === 401 && !url.includes('/auth/login') && !url.includes('/auth/register')) {
      clearSession();
      window.dispatchEvent(new Event('itsm:session-expired'));
    }
    return Promise.reject(error);
  }
);

/* -------------------------------------------------------------------- utils */

/** Uniform message extraction for the API's `{ error, code, details }` shape. */
export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const data = error?.response?.data;
  if (!data) return error?.message || fallback;
  if (data.details && typeof data.details === 'object') {
    const first = Object.values(data.details).find(Boolean);
    if (typeof first === 'string') return first;
  }
  return data.error || data.message || fallback;
}

/** Server-Sent Events URL. EventSource cannot set headers, so the JWT rides
 *  in the query string (the backend accepts `?token=` for this route only). */
export function eventsUrl(token) {
  return `${API_BASE}/events?token=${encodeURIComponent(token || '')}`;
}

export default API;
