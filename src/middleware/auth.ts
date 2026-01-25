/**
 * Authentication Middleware
 *
 * Username/password authentication with optional invite key support for RhizOS Cloud.
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

// ============ Types ============

interface User {
  id: string;
  username: string;
  passwordHash: string;
  created: string;
  disabled?: boolean;
}

interface UsersFile {
  users: User[];
}

interface InviteKey {
  key: string;
  name: string;
  created: string;
  disabled?: boolean;
}

interface Session {
  token: string;
  userId: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}

interface KeysFile {
  adminKey: string;
  keys: InviteKey[];
}

// ============ Configuration ============

// Use electron app data directory for storage
const getDataPath = () => {
  try {
    return app.getPath('userData');
  } catch {
    return process.cwd();
  }
};

const KEYS_FILE = process.env.KEYS_FILE || path.join(getDataPath(), 'keys.json');
const USERS_FILE = process.env.USERS_FILE || path.join(getDataPath(), 'users.json');
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BCRYPT_ROUNDS = 10;

// ============ In-Memory Session Store ============

const sessions = new Map<string, Session>();

// ============ Key Management ============

function loadKeys(): KeysFile {
  try {
    const data = fs.readFileSync(KEYS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    // Create default keys file if it doesn't exist
    const defaultKeys: KeysFile = {
      adminKey: randomUUID(),
      keys: [
        {
          key: randomUUID().slice(0, 8),
          name: 'default',
          created: new Date().toISOString(),
        },
      ],
    };
    saveKeys(defaultKeys);
    console.log('Created new keys.json with admin key:', defaultKeys.adminKey);
    console.log('Default invite key:', defaultKeys.keys[0].key);
    return defaultKeys;
  }
}

function saveKeys(keys: KeysFile): void {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

function validateInviteKey(key: string): InviteKey | null {
  const keysFile = loadKeys();
  const found = keysFile.keys.find(k => k.key === key && !k.disabled);
  return found || null;
}

function validateAdminKey(key: string): boolean {
  const keysFile = loadKeys();
  return keysFile.adminKey === key;
}

// ============ User Management ============

function loadUsers(): UsersFile {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    const defaultUsers: UsersFile = { users: [] };
    saveUsers(defaultUsers);
    return defaultUsers;
  }
}

function saveUsers(users: UsersFile): void {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function findUserByUsername(username: string): User | null {
  const usersFile = loadUsers();
  return usersFile.users.find(u => u.username.toLowerCase() === username.toLowerCase() && !u.disabled) || null;
}

function findUserById(id: string): User | null {
  const usersFile = loadUsers();
  return usersFile.users.find(u => u.id === id && !u.disabled) || null;
}

function usernameExists(username: string): boolean {
  const usersFile = loadUsers();
  return usersFile.users.some(u => u.username.toLowerCase() === username.toLowerCase());
}

// ============ Session Management ============

export function createSession(userId: string, username: string): string {
  const token = randomUUID();
  const now = Date.now();

  sessions.set(token, {
    token,
    userId,
    username,
    createdAt: now,
    expiresAt: now + SESSION_DURATION_MS,
  });

  return token;
}

export function validateSession(token: string): Session | null {
  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return session;
}

export function destroySession(token: string): boolean {
  return sessions.delete(token);
}

// ============ Auth Functions ============

export async function signup(username: string, password: string): Promise<{ success: boolean; token?: string; user?: { id: string; username: string }; error?: string }> {
  // Validate username
  const trimmedUsername = username.trim();
  if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
    return { success: false, error: 'Username must be 3-20 characters' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername)) {
    return { success: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' };
  }
  if (usernameExists(trimmedUsername)) {
    return { success: false, error: 'Username already taken' };
  }

  // Validate password
  if (password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters' };
  }

  // Hash password and create user
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user: User = {
    id: randomUUID(),
    username: trimmedUsername,
    passwordHash,
    created: new Date().toISOString(),
  };

  const usersFile = loadUsers();
  usersFile.users.push(user);
  saveUsers(usersFile);

  // Create session
  const token = createSession(user.id, user.username);
  return { success: true, token, user: { id: user.id, username: user.username } };
}

export async function loginWithPassword(username: string, password: string): Promise<{ success: boolean; token?: string; user?: { id: string; username: string }; error?: string }> {
  const user = findUserByUsername(username);
  if (!user) {
    return { success: false, error: 'Invalid username or password' };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return { success: false, error: 'Invalid username or password' };
  }

  const token = createSession(user.id, user.username);
  return { success: true, token, user: { id: user.id, username: user.username } };
}

// Legacy invite key login (for backward compatibility)
export function loginWithKey(inviteKey: string): { success: boolean; token?: string; error?: string } {
  const key = validateInviteKey(inviteKey);
  if (!key) {
    return { success: false, error: 'Invalid invite key' };
  }
  // Create session with key name as both userId and username
  const token = createSession(key.name, key.name);
  return { success: true, token };
}

export function logout(token: string): boolean {
  return destroySession(token);
}

// ============ Admin Functions ============

export function generateKey(adminKey: string, name: string): { success: boolean; key?: string; error?: string } {
  if (!validateAdminKey(adminKey)) {
    return { success: false, error: 'Invalid admin key' };
  }

  const keysFile = loadKeys();
  const newKey = randomUUID().slice(0, 8);

  keysFile.keys.push({
    key: newKey,
    name,
    created: new Date().toISOString(),
  });

  saveKeys(keysFile);
  return { success: true, key: newKey };
}

export function listKeys(adminKey: string): { success: boolean; keys?: InviteKey[]; error?: string } {
  if (!validateAdminKey(adminKey)) {
    return { success: false, error: 'Invalid admin key' };
  }

  const keysFile = loadKeys();
  return {
    success: true,
    keys: keysFile.keys.map(k => ({ ...k, key: k.key.slice(0, 4) + '****' }))
  };
}

export function revokeKey(adminKey: string, keyPrefix: string): { success: boolean; error?: string } {
  if (!validateAdminKey(adminKey)) {
    return { success: false, error: 'Invalid admin key' };
  }

  const keysFile = loadKeys();
  const key = keysFile.keys.find(k => k.key.startsWith(keyPrefix));

  if (!key) {
    return { success: false, error: 'Key not found' };
  }

  key.disabled = true;
  saveKeys(keysFile);
  return { success: true };
}

// ============ Express Middleware ============

/**
 * Middleware that requires authentication.
 * Checks for Bearer token in Authorization header.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7);
  const session = validateSession(token);

  if (!session) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  // Attach session info to request for use in handlers
  (req as any).session = session;
  next();
}

/**
 * Middleware that requires admin authentication.
 * Checks for X-Admin-Key header.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminKey = req.headers['x-admin-key']?.toString();

  if (!adminKey || !validateAdminKey(adminKey)) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
}

// ============ Initialize on Load ============

// Load keys on module initialization (creates default if needed)
loadKeys();
