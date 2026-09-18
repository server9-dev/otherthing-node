/**
 * Supabase client plumbing for the node process.
 *
 * Two kinds of identity reach the database:
 *   - Request identity: an HTTP request from the renderer carries the signed-in
 *     user's access token. `requireUser` verifies it and runs the rest of the
 *     request inside `runWithUser`, so `db()` returns a client that queries as
 *     that user and row-level security applies.
 *   - Node identity: background work (inference relay, peer sync, chain sync)
 *     has no request. It uses the node session, which is either handed over by
 *     the renderer after sign-in (desktop) or created from
 *     OTHERTHING_NODE_EMAIL / OTHERTHING_NODE_PASSWORD (headless).
 *
 * Only the publishable key is used here. The secret key never ships in the app.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';
import { PLATFORM } from '../platform-config';

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

export function getSupabaseConfig(): SupabaseConfig {
  return {
    url: process.env.SUPABASE_URL || PLATFORM.supabase.url,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || PLATFORM.supabase.publishableKey,
  };
}

export function isSupabaseConfigured(): boolean {
  const { url, publishableKey } = getSupabaseConfig();
  return !!url && !!publishableKey;
}

export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in to OtherThing');
    this.name = 'NotSignedInError';
  }
}

export interface AuthedUser {
  id: string;
  email: string | null;
  displayName: string;
}

// ─── Per-request clients ────────────────────────────────────────────────────

interface RequestContext {
  client: SupabaseClient;
  user: AuthedUser;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

function clientForToken(token: string): SupabaseClient {
  const { url, publishableKey } = getSupabaseConfig();
  return createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function runWithUser<T>(token: string, user: AuthedUser, fn: () => T): T {
  return requestContext.run({ client: clientForToken(token), user }, fn);
}

// ─── Node session ───────────────────────────────────────────────────────────

const sessionPath = (): string =>
  path.join(process.env.STORAGE_PATH || path.join(os.homedir(), '.otherthing'), 'supabase-session.json');

class NodeSession {
  private client: SupabaseClient | null = null;
  private user: AuthedUser | null = null;
  private listeners = new Set<(user: AuthedUser | null) => void>();

  private getClient(): SupabaseClient {
    if (!this.client) {
      const { url, publishableKey } = getSupabaseConfig();
      this.client = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
      });
      this.client.auth.onAuthStateChange((event, session) => {
        if (event === 'TOKEN_REFRESHED' && session) this.persist(session);
        if (event === 'SIGNED_OUT') this.setUser(null);
      });
    }
    return this.client;
  }

  get current(): { client: SupabaseClient; user: AuthedUser } | null {
    return this.client && this.user ? { client: this.client, user: this.user } : null;
  }

  onChange(fn: (user: AuthedUser | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setUser(user: AuthedUser | null): void {
    this.user = user;
    for (const fn of this.listeners) fn(user);
  }

  private persist(session: Session): void {
    try {
      fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });
      fs.writeFileSync(
        sessionPath(),
        JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }),
        { mode: 0o600 }
      );
    } catch (err) {
      console.error('[Supabase] Failed to persist node session:', err);
    }
  }

  private async adopt(session: Session | null): Promise<AuthedUser> {
    if (!session) throw new NotSignedInError();
    this.persist(session);
    const user = toAuthedUser(session.user);
    this.setUser(user);
    return user;
  }

  /** Adopt a session handed over by the signed-in renderer. */
  async setSession(accessToken: string, refreshToken: string): Promise<AuthedUser> {
    const { data, error } = await this.getClient().auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return this.adopt(data.session);
  }

  async signInWithPassword(email: string, password: string): Promise<AuthedUser> {
    const { data, error } = await this.getClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return this.adopt(data.session);
  }

  /**
   * Restore a previous session from disk, else sign in with
   * OTHERTHING_NODE_EMAIL / OTHERTHING_NODE_PASSWORD if set.
   */
  async restore(): Promise<AuthedUser | null> {
    if (!isSupabaseConfigured()) return null;
    try {
      const saved = JSON.parse(fs.readFileSync(sessionPath(), 'utf8'));
      const { data, error } = await this.getClient().auth.refreshSession({ refresh_token: saved.refresh_token });
      if (!error && data.session) return await this.adopt(data.session);
    } catch {
      // No saved session, or it expired
    }
    const email = process.env.OTHERTHING_NODE_EMAIL;
    const password = process.env.OTHERTHING_NODE_PASSWORD;
    if (email && password) {
      try {
        return await this.signInWithPassword(email, password);
      } catch (err) {
        console.error('[Supabase] Node sign-in failed:', (err as Error).message);
      }
    }
    return null;
  }

  async signOut(): Promise<void> {
    if (this.client) await this.client.auth.signOut({ scope: 'local' }).catch(() => {});
    try { fs.unlinkSync(sessionPath()); } catch {}
    this.setUser(null);
  }
}

export const nodeSession = new NodeSession();

function toAuthedUser(u: { id: string; email?: string | null; user_metadata?: Record<string, any> }): AuthedUser {
  const email = u.email ?? null;
  return {
    id: u.id,
    email,
    displayName: u.user_metadata?.display_name || (email ? email.split('@')[0] : u.id.slice(0, 8)),
  };
}

// ─── Accessors used by services ─────────────────────────────────────────────

/** Client for the current request's user, else the node session. */
export function db(): SupabaseClient {
  const ctx = requestContext.getStore();
  if (ctx) return ctx.client;
  const node = nodeSession.current;
  if (node) return node.client;
  throw new NotSignedInError();
}

/** User behind `db()`, or null when nobody is signed in. */
export function currentUser(): AuthedUser | null {
  return requestContext.getStore()?.user ?? nodeSession.current?.user ?? null;
}

export function hasIdentity(): boolean {
  return !!requestContext.getStore() || !!nodeSession.current;
}

// ─── Token verification + Express middleware ────────────────────────────────

const verified = new Map<string, { user: AuthedUser; expires: number }>();

export async function verifyAccessToken(token: string): Promise<AuthedUser | null> {
  const hit = verified.get(token);
  if (hit && hit.expires > Date.now()) return hit.user;

  const { url, publishableKey } = getSupabaseConfig();
  const verifier = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data.user) return null;

  const user = toAuthedUser(data.user);
  // Cache until shortly before the token itself expires (max 5 min).
  let expires = Date.now() + 5 * 60_000;
  try {
    const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp;
    if (exp) expires = Math.min(expires, exp * 1000 - 10_000);
  } catch {}
  verified.set(token, { user, expires });
  if (verified.size > 500) {
    for (const [k, v] of verified) if (v.expires <= Date.now()) verified.delete(k);
  }
  return user;
}

/**
 * Express middleware: requires `Authorization: Bearer <supabase access token>`.
 * Sets `req.session = { userId, username, token }` (the shape routes already
 * read) and runs the rest of the request as that user.
 */
export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }
  let user: AuthedUser | null = null;
  try {
    user = await verifyAccessToken(token);
  } catch (err) {
    console.error('[Auth] Token verification failed:', err);
  }
  if (!user) {
    res.status(401).json({ error: 'Session expired — sign in again' });
    return;
  }
  (req as any).session = { userId: user.id, username: user.displayName, email: user.email, token };
  runWithUser(token, user, () => next());
}
