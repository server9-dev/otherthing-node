/**
 * OtherThing Node Credential Store
 *
 * Secure encrypted storage for sensitive credentials using AES-256-GCM.
 * Master password derives encryption key via PBKDF2.
 * Credentials stored in localStorage (encrypted).
 */

// ============ Types ============

export type CredentialType =
  | 'openai'
  | 'anthropic'
  | 'aws'
  | 'gcp'
  | 'azure'
  | 'huggingface'
  | 'github'
  | 'custom';

export interface CredentialRef {
  credentialId: string;
  type: CredentialType;
}

export interface StoredCredential {
  id: string;
  type: CredentialType;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  values: Record<string, string>;
}

export interface CredentialMetadata {
  id: string;
  type: CredentialType;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

interface EncryptedStore {
  version: number;
  salt: string;
  iv: string;
  encryptedData: string;
  checksum: string;
}

// ============ Constants ============

const STORAGE_KEY = 'otherthing_credentials_v1';
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 100000;
const CHECKSUM_TEXT = 'OTHERTHING_CREDENTIAL_STORE_VALID';

// ============ Crypto Utilities ============

function getRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function arrayToBase64(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr));
}

function base64ToArray(base64: string): Uint8Array {
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(data: string, key: CryptoKey, iv: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(data)
  );
  return new Uint8Array(encrypted);
}

async function decrypt(encryptedData: Uint8Array, key: CryptoKey, iv: Uint8Array): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encryptedData
  );
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// ============ Credential Store Class ============

export class CredentialStore {
  private credentials: Map<string, StoredCredential> = new Map();
  private encryptionKey: CryptoKey | null = null;
  private salt: Uint8Array | null = null;
  private isUnlocked = false;

  isInitialized(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  isStoreUnlocked(): boolean {
    return this.isUnlocked;
  }

  async initialize(masterPassword: string): Promise<void> {
    if (this.isInitialized()) {
      throw new Error('Credential store already initialized. Use unlock() instead.');
    }

    this.salt = getRandomBytes(SALT_LENGTH);
    this.encryptionKey = await deriveKey(masterPassword, this.salt);
    this.credentials = new Map();
    await this.save();
    this.isUnlocked = true;
  }

  async unlock(masterPassword: string): Promise<boolean> {
    const storedData = localStorage.getItem(STORAGE_KEY);
    if (!storedData) {
      throw new Error('Credential store not initialized. Use initialize() first.');
    }

    const store: EncryptedStore = JSON.parse(storedData);
    this.salt = base64ToArray(store.salt);
    this.encryptionKey = await deriveKey(masterPassword, this.salt);

    try {
      const iv = base64ToArray(store.iv);
      const encryptedData = base64ToArray(store.encryptedData);
      const decryptedData = await decrypt(encryptedData, this.encryptionKey, iv);
      const parsed = JSON.parse(decryptedData);

      if (parsed.checksum !== CHECKSUM_TEXT) {
        this.encryptionKey = null;
        this.salt = null;
        return false;
      }

      this.credentials = new Map(
        (parsed.credentials as StoredCredential[]).map(c => [c.id, c])
      );

      this.isUnlocked = true;
      return true;
    } catch {
      this.encryptionKey = null;
      this.salt = null;
      return false;
    }
  }

  lock(): void {
    this.credentials = new Map();
    this.encryptionKey = null;
    this.isUnlocked = false;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    const verified = await this.unlock(currentPassword);
    if (!verified) {
      return false;
    }

    this.salt = getRandomBytes(SALT_LENGTH);
    this.encryptionKey = await deriveKey(newPassword, this.salt);
    await this.save();
    return true;
  }

  private async save(): Promise<void> {
    if (!this.encryptionKey || !this.salt) {
      throw new Error('Store not unlocked');
    }

    const dataToEncrypt = JSON.stringify({
      checksum: CHECKSUM_TEXT,
      credentials: Array.from(this.credentials.values()),
    });

    const iv = getRandomBytes(IV_LENGTH);
    const encryptedData = await encrypt(dataToEncrypt, this.encryptionKey, iv);

    const store: EncryptedStore = {
      version: 1,
      salt: arrayToBase64(this.salt),
      iv: arrayToBase64(iv),
      encryptedData: arrayToBase64(encryptedData),
      checksum: '',
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  private generateId(): string {
    return `cred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async addCredential(
    type: CredentialType,
    name: string,
    values: Record<string, string>,
    description?: string
  ): Promise<string> {
    if (!this.isUnlocked) {
      throw new Error('Store is locked');
    }

    const id = this.generateId();
    const now = new Date().toISOString();

    const credential: StoredCredential = {
      id,
      type,
      name,
      description,
      values,
      createdAt: now,
      updatedAt: now,
    };

    this.credentials.set(id, credential);
    await this.save();

    return id;
  }

  async updateCredential(
    id: string,
    updates: {
      name?: string;
      description?: string;
      values?: Record<string, string>;
    }
  ): Promise<void> {
    if (!this.isUnlocked) {
      throw new Error('Store is locked');
    }

    const credential = this.credentials.get(id);
    if (!credential) {
      throw new Error(`Credential not found: ${id}`);
    }

    if (updates.name !== undefined) credential.name = updates.name;
    if (updates.description !== undefined) credential.description = updates.description;
    if (updates.values !== undefined) credential.values = updates.values;
    credential.updatedAt = new Date().toISOString();

    await this.save();
  }

  async deleteCredential(id: string): Promise<void> {
    if (!this.isUnlocked) {
      throw new Error('Store is locked');
    }

    if (!this.credentials.has(id)) {
      throw new Error(`Credential not found: ${id}`);
    }

    this.credentials.delete(id);
    await this.save();
  }

  getCredential(id: string): StoredCredential | undefined {
    if (!this.isUnlocked) {
      throw new Error('Store is locked');
    }
    return this.credentials.get(id);
  }

  getCredentialValues(id: string): Record<string, string> | undefined {
    if (!this.isUnlocked) {
      throw new Error('Store is locked');
    }
    return this.credentials.get(id)?.values;
  }

  listCredentials(): CredentialMetadata[] {
    if (!this.isUnlocked) {
      throw new Error('Store is locked');
    }

    return Array.from(this.credentials.values()).map(({ values, ...metadata }) => metadata);
  }

  listCredentialsByType(type: CredentialType): CredentialMetadata[] {
    return this.listCredentials().filter(c => c.type === type);
  }

  hasCredential(id: string): boolean {
    return this.credentials.has(id);
  }

  resolveCredentialRefs(
    refs: Record<string, { credentialId: string; type: string }>
  ): Record<string, Record<string, string>> {
    if (!this.isUnlocked) {
      throw new Error('Store is locked');
    }

    const resolved: Record<string, Record<string, string>> = {};

    for (const [key, ref] of Object.entries(refs)) {
      const credential = this.credentials.get(ref.credentialId);
      if (!credential) {
        throw new Error(`Credential not found: ${ref.credentialId}`);
      }
      if (credential.type !== ref.type) {
        throw new Error(
          `Credential type mismatch: expected ${ref.type}, got ${credential.type}`
        );
      }
      resolved[key] = credential.values;
    }

    return resolved;
  }

  async exportBackup(backupPassword: string): Promise<string> {
    if (!this.isUnlocked) {
      throw new Error('Store is locked');
    }

    const salt = getRandomBytes(SALT_LENGTH);
    const iv = getRandomBytes(IV_LENGTH);
    const key = await deriveKey(backupPassword, salt);

    const dataToEncrypt = JSON.stringify({
      checksum: CHECKSUM_TEXT,
      exportedAt: new Date().toISOString(),
      credentials: Array.from(this.credentials.values()),
    });

    const encryptedData = await encrypt(dataToEncrypt, key, iv);

    const backup = {
      version: 1,
      salt: arrayToBase64(salt),
      iv: arrayToBase64(iv),
      encryptedData: arrayToBase64(encryptedData),
    };

    return btoa(JSON.stringify(backup));
  }

  async importBackup(
    backupData: string,
    backupPassword: string,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<number> {
    if (!this.isUnlocked) {
      throw new Error('Store is locked');
    }

    try {
      const backup = JSON.parse(atob(backupData));
      const salt = base64ToArray(backup.salt);
      const iv = base64ToArray(backup.iv);
      const encryptedData = base64ToArray(backup.encryptedData);
      const key = await deriveKey(backupPassword, salt);

      const decryptedData = await decrypt(encryptedData, key, iv);
      const parsed = JSON.parse(decryptedData);

      if (parsed.checksum !== CHECKSUM_TEXT) {
        throw new Error('Invalid backup or wrong password');
      }

      const importedCredentials = parsed.credentials as StoredCredential[];

      if (mode === 'replace') {
        this.credentials = new Map(importedCredentials.map(c => [c.id, c]));
      } else {
        for (const cred of importedCredentials) {
          this.credentials.set(cred.id, cred);
        }
      }

      await this.save();
      return importedCredentials.length;
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid backup or wrong password') {
        throw error;
      }
      throw new Error('Failed to import backup: invalid format or wrong password');
    }
  }

  async reset(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
    this.credentials = new Map();
    this.encryptionKey = null;
    this.salt = null;
    this.isUnlocked = false;
  }
}

// ============ Singleton Instance ============

export const credentialStore = new CredentialStore();

export function createCredentialRef(credentialId: string, type: CredentialType): CredentialRef {
  return { credentialId, type };
}

export function validateCredentialRefs(
  refs: CredentialRef[],
  store: CredentialStore
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const ref of refs) {
    if (!store.hasCredential(ref.credentialId)) {
      missing.push(ref.credentialId);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
