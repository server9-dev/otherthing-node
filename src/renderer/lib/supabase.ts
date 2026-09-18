/**
 * Renderer-side Supabase auth.
 *
 * - Bootstraps a supabase-js client from the local node's /api/v1/auth/config.
 * - Keeps the current session in module state so the fetch wrapper
 *   (installAuthFetch) can attach `Authorization: Bearer <access_token>` to
 *   every request to the local API without touching call sites.
 * - On sign-in, links the node: signs in a second, independent session with the
 *   same credentials and hands it to POST /api/v1/auth/session. The node and the
 *   renderer each refresh their own session, so refresh-token rotation in one
 *   never revokes the other.
 */

import {
  createClient,
  isAuthRetryableFetchError,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';

export const LOCAL_API_ORIGIN = 'http://localhost:8080';
const LOCAL_ORIGINS = [LOCAL_API_ORIGIN, 'http://127.0.0.1:8080'];

// Captured before installAuthFetch replaces window.fetch.
const nativeFetch: typeof fetch = window.fetch.bind(window);

// ─── State ──────────────────────────────────────────────────────────────────

interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

let config: SupabaseConfig | null = null;
let client: SupabaseClient | null = null;
let clientPromise: Promise<SupabaseClient> | null = null;
let currentSession: Session | null = null;
const listeners = new Set<(session: Session | null) => void>();

export function getSession(): Session | null {
  return currentSession;
}

export function getAccessToken(): string | null {
  return currentSession?.access_token ?? null;
}

export function onSessionChange(fn: (session: Session | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setSession(session: Session | null): void {
  currentSession = session;
  for (const fn of listeners) fn(session);
}

// ─── Client bootstrap ───────────────────────────────────────────────────────

async function loadConfig(): Promise<SupabaseConfig> {
  // The API server starts alongside the window; wait for it (up to ~60s).
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await nativeFetch(`${LOCAL_API_ORIGIN}/api/v1/auth/config`);
      if (res.ok) {
        const cfg = (await res.json()) as SupabaseConfig;
        if (!cfg.url || !cfg.publishableKey) {
          throw new Error('Supabase is not configured for this node (missing URL or publishable key).');
        }
        return cfg;
      }
      lastError = new Error(`Auth config request failed (HTTP ${res.status})`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Supabase is not configured')) throw err;
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw lastError instanceof Error ? lastError : new Error('Local node is not responding');
}

/** Create (once) and return the renderer's Supabase client. */
export function getSupabase(): Promise<SupabaseClient> {
  if (client) return Promise.resolve(client);
  if (!clientPromise) {
    clientPromise = (async () => {
      config = await loadConfig();
      const sb = createClient(config.url, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storage: window.localStorage,
        },
      });
      sb.auth.onAuthStateChange((_event, session) => {
        setSession(session);
      });
      const { data } = await sb.auth.getSession();
      setSession(data.session);
      client = sb;
      return sb;
    })();
    // Allow a retry after a failed bootstrap.
    clientPromise.catch(() => {
      clientPromise = null;
    });
  }
  return clientPromise;
}

// ─── Local API helper (no 401 handling, used by auth itself) ────────────────

function localAuthFetch(path: string, init: RequestInit = {}, token = getAccessToken()): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return nativeFetch(`${LOCAL_API_ORIGIN}${path}`, { ...init, headers });
}

/** Give the node its own session for the same user (needs the password). */
async function linkNode(email: string, password: string): Promise<void> {
  if (!config) return;
  const nodeClient = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'otherthing-node-handoff',
    },
  });
  const { data, error } = await nodeClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.warn('[Auth] Could not create node session:', error?.message);
    return;
  }
  const res = await localAuthFetch('/api/v1/auth/session', {
    method: 'POST',
    body: JSON.stringify({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    }),
  });
  if (!res.ok) console.warn('[Auth] Node rejected session handoff: HTTP', res.status);
}

// ─── Auth actions ───────────────────────────────────────────────────────────

export async function signIn(email: string, password: string): Promise<void> {
  const sb = await getSupabase();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  linkNode(email, password).catch((err) => console.warn('[Auth] Node link failed:', err));
}

/** Returns true when signed in right away, false when email confirmation is required. */
export async function signUp(email: string, password: string, displayName: string): Promise<boolean> {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;
  if (!data.session) return false;
  linkNode(email, password).catch((err) => console.warn('[Auth] Node link failed:', err));
  return true;
}

export async function signOut(): Promise<void> {
  const sb = await getSupabase();
  try {
    await localAuthFetch('/api/v1/auth/signout', { method: 'POST' });
  } catch (err) {
    console.warn('[Auth] Node sign-out failed:', err);
  }
  await sb.auth.signOut({ scope: 'local' });
}

export async function updateDisplayName(displayName: string): Promise<void> {
  const sb = await getSupabase();
  const { error } = await sb.auth.updateUser({ data: { display_name: displayName } });
  if (error) throw error;
}

export interface NodeAuthStatus {
  userId: string;
  username: string;
  email: string | null;
  nodeSignedIn: boolean;
}

export async function fetchMe(): Promise<NodeAuthStatus | null> {
  const res = await fetch(`${LOCAL_API_ORIGIN}/api/v1/auth/me`);
  return res.ok ? res.json() : null;
}

// ─── Session expiry handling ────────────────────────────────────────────────

let refreshing: Promise<string | null> | null = null;

/** Refresh once after a 401. Signs out when the session can't be refreshed. */
async function refreshAfter401(usedToken: string): Promise<string | null> {
  const latest = getAccessToken();
  if (latest && latest !== usedToken) return latest; // Already refreshed elsewhere.
  if (!client) return null;
  if (!refreshing) {
    const sb = client;
    refreshing = (async () => {
      const { data, error } = await sb.auth.refreshSession();
      if (error || !data.session) {
        // Offline / Supabase unreachable: keep the session and let the caller see the 401.
        if (error && isAuthRetryableFetchError(error)) return null;
        await forceSignOut();
        return null;
      }
      return data.session.access_token;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function forceSignOut(): Promise<void> {
  if (!client) return;
  await client.auth.signOut({ scope: 'local' }).catch(() => {});
  setSession(null);
}

async function isAuthRejection(res: Response): Promise<boolean> {
  // Messages sent by requireUser (src/services/supabase-client.ts). Other 401s
  // (e.g. a bad wallet signature) must not sign the user out.
  try {
    const body = await res.clone().json();
    const msg = String(body?.error || '');
    return msg === 'Sign in required' || msg.startsWith('Session expired');
  } catch {
    return false;
  }
}

// ─── Fetch wrapper ──────────────────────────────────────────────────────────

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isLocalApi(url: string): boolean {
  if (url.startsWith('/api/') || url === '/health') return true;
  return LOCAL_ORIGINS.some((origin) => url === origin || url.startsWith(`${origin}/`));
}

let installed = false;

/**
 * Replace window.fetch so every request to the local API carries the current
 * access token, and a 401 triggers one refresh + retry (then sign-out).
 */
export function installAuthFetch(): void {
  if (installed) return;
  installed = true;

  const send = (input: RequestInfo | URL, init: RequestInit | undefined, token: string | null) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (token) headers.set('Authorization', `Bearer ${token}`);
    else headers.delete('Authorization');
    const target = input instanceof Request ? input.clone() : input;
    return nativeFetch(target, { ...init, headers });
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isLocalApi(requestUrl(input))) return nativeFetch(input, init);

    const token = getAccessToken();
    const res = await send(input, init, token);
    if (res.status !== 401 || !token) return res;
    if (!(await isAuthRejection(res))) return res;

    const fresh = await refreshAfter401(token);
    if (!fresh) return res;
    const retry = await send(input, init, fresh);
    if (retry.status === 401 && (await isAuthRejection(retry))) await forceSignOut();
    return retry;
  };
}
