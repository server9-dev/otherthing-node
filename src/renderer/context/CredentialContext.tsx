/**
 * OtherThing Node Credential Context
 *
 * React context for managing credential store state.
 * Provides hooks for credential operations throughout the app.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {
  credentialStore,
  CredentialMetadata,
  CredentialType,
  StoredCredential,
} from '../services/credential-store';

// ============ Types ============

interface CredentialContextType {
  isInitialized: boolean;
  isUnlocked: boolean;
  credentials: CredentialMetadata[];

  initialize: (masterPassword: string) => Promise<void>;
  unlock: (masterPassword: string) => Promise<boolean>;
  lock: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  reset: () => Promise<void>;

  addCredential: (
    type: CredentialType,
    name: string,
    values: Record<string, string>,
    description?: string
  ) => Promise<string>;
  updateCredential: (
    id: string,
    updates: { name?: string; description?: string; values?: Record<string, string> }
  ) => Promise<void>;
  deleteCredential: (id: string) => Promise<void>;
  getCredential: (id: string) => StoredCredential | undefined;
  getCredentialsByType: (type: CredentialType) => CredentialMetadata[];

  exportBackup: (backupPassword: string) => Promise<string>;
  importBackup: (backupData: string, backupPassword: string, mode?: 'merge' | 'replace') => Promise<number>;

  hasCredential: (id: string) => boolean;
  validateCredentialRef: (credentialId: string, expectedType: CredentialType) => boolean;

  resolveCredentials: (
    refs: Record<string, { credentialId: string; type: string }>
  ) => Record<string, Record<string, string>>;
}

// ============ Context ============

const CredentialContext = createContext<CredentialContextType | undefined>(undefined);

// ============ Provider ============

export function CredentialProvider({ children }: { children: ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([]);

  useEffect(() => {
    setIsInitialized(credentialStore.isInitialized());
  }, []);

  const refreshCredentials = useCallback(() => {
    if (credentialStore.isStoreUnlocked()) {
      setCredentials(credentialStore.listCredentials());
    } else {
      setCredentials([]);
    }
  }, []);

  const initialize = useCallback(async (masterPassword: string) => {
    await credentialStore.initialize(masterPassword);
    setIsInitialized(true);
    setIsUnlocked(true);
    refreshCredentials();
  }, [refreshCredentials]);

  const unlock = useCallback(async (masterPassword: string): Promise<boolean> => {
    const success = await credentialStore.unlock(masterPassword);
    setIsUnlocked(success);
    if (success) {
      refreshCredentials();
    }
    return success;
  }, [refreshCredentials]);

  const lock = useCallback(() => {
    credentialStore.lock();
    setIsUnlocked(false);
    setCredentials([]);
  }, []);

  const changePassword = useCallback(async (
    currentPassword: string,
    newPassword: string
  ): Promise<boolean> => {
    const success = await credentialStore.changePassword(currentPassword, newPassword);
    return success;
  }, []);

  const reset = useCallback(async () => {
    await credentialStore.reset();
    setIsInitialized(false);
    setIsUnlocked(false);
    setCredentials([]);
  }, []);

  const addCredential = useCallback(async (
    type: CredentialType,
    name: string,
    values: Record<string, string>,
    description?: string
  ): Promise<string> => {
    const id = await credentialStore.addCredential(type, name, values, description);
    refreshCredentials();
    return id;
  }, [refreshCredentials]);

  const updateCredential = useCallback(async (
    id: string,
    updates: { name?: string; description?: string; values?: Record<string, string> }
  ): Promise<void> => {
    await credentialStore.updateCredential(id, updates);
    refreshCredentials();
  }, [refreshCredentials]);

  const deleteCredential = useCallback(async (id: string): Promise<void> => {
    await credentialStore.deleteCredential(id);
    refreshCredentials();
  }, [refreshCredentials]);

  const getCredential = useCallback((id: string): StoredCredential | undefined => {
    return credentialStore.getCredential(id);
  }, []);

  const getCredentialsByType = useCallback((type: CredentialType): CredentialMetadata[] => {
    return credentialStore.listCredentialsByType(type);
  }, []);

  const exportBackup = useCallback(async (backupPassword: string): Promise<string> => {
    return credentialStore.exportBackup(backupPassword);
  }, []);

  const importBackup = useCallback(async (
    backupData: string,
    backupPassword: string,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<number> => {
    const count = await credentialStore.importBackup(backupData, backupPassword, mode);
    refreshCredentials();
    return count;
  }, [refreshCredentials]);

  const hasCredential = useCallback((id: string): boolean => {
    return credentialStore.hasCredential(id);
  }, []);

  const validateCredentialRef = useCallback((
    credentialId: string,
    expectedType: CredentialType
  ): boolean => {
    const credential = credentialStore.getCredential(credentialId);
    return credential !== undefined && credential.type === expectedType;
  }, []);

  const resolveCredentials = useCallback((
    refs: Record<string, { credentialId: string; type: string }>
  ): Record<string, Record<string, string>> => {
    return credentialStore.resolveCredentialRefs(refs);
  }, []);

  const value: CredentialContextType = {
    isInitialized,
    isUnlocked,
    credentials,
    initialize,
    unlock,
    lock,
    changePassword,
    reset,
    addCredential,
    updateCredential,
    deleteCredential,
    getCredential,
    getCredentialsByType,
    exportBackup,
    importBackup,
    hasCredential,
    validateCredentialRef,
    resolveCredentials,
  };

  return (
    <CredentialContext.Provider value={value}>
      {children}
    </CredentialContext.Provider>
  );
}

// ============ Hook ============

export function useCredentials() {
  const context = useContext(CredentialContext);
  if (context === undefined) {
    throw new Error('useCredentials must be used within a CredentialProvider');
  }
  return context;
}

export function useCredentialsByType(type: CredentialType) {
  const { credentials, isUnlocked } = useCredentials();

  if (!isUnlocked) {
    return [];
  }

  return credentials.filter(c => c.type === type);
}

export function useCredentialStoreStatus() {
  const { isInitialized, isUnlocked } = useCredentials();

  return {
    needsSetup: !isInitialized,
    needsUnlock: isInitialized && !isUnlocked,
    isReady: isInitialized && isUnlocked,
  };
}
