/**
 * Git Service
 *
 * Handles GitHub OAuth, SSH key management, and git operations.
 * Enables users to connect their GitHub accounts or add SSH keys
 * to access private repositories within workspaces.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import { randomBytes, createHash } from 'crypto';

// GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GITHUB_REDIRECT_URI = 'http://localhost:8080/auth/github/callback';

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

export interface GitHubToken {
  access_token: string;
  token_type: string;
  scope: string;
  expires_at?: string;
}

export interface SSHKey {
  id: string;
  name: string;
  publicKey: string;
  privateKeyPath: string;
  fingerprint: string;
  addedAt: string;
}

export interface GitCredentials {
  type: 'github' | 'ssh' | 'token';
  github?: {
    user: GitHubUser;
    token: GitHubToken;
  };
  ssh?: SSHKey;
  token?: {
    username: string;
    token: string;
  };
}

export interface CloneOptions {
  url: string;
  targetDir: string;
  credentials?: GitCredentials;
  branch?: string;
  depth?: number;
}

export interface GitServiceConfig {
  dataDir: string;
  sshDir: string;
}

class GitServiceImpl {
  private config: GitServiceConfig;
  private credentials: Map<string, GitCredentials> = new Map();
  private sshKeys: SSHKey[] = [];
  private githubUsers: Map<string, { user: GitHubUser; token: GitHubToken }> = new Map();
  private pendingOAuthStates: Map<string, { userId: string; timestamp: number }> = new Map();

  constructor() {
    this.config = {
      dataDir: path.join(homedir(), '.otherthing', 'git'),
      sshDir: path.join(homedir(), '.otherthing', 'ssh'),
    };

    // Ensure directories exist
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true });
    }
    if (!existsSync(this.config.sshDir)) {
      mkdirSync(this.config.sshDir, { recursive: true, mode: 0o700 });
    }

    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const credentialsPath = path.join(this.config.dataDir, 'credentials.json');
    if (existsSync(credentialsPath)) {
      try {
        const data = JSON.parse(readFileSync(credentialsPath, 'utf-8'));
        if (data.sshKeys) this.sshKeys = data.sshKeys;
        if (data.githubUsers) {
          Object.entries(data.githubUsers).forEach(([key, value]) => {
            this.githubUsers.set(key, value as { user: GitHubUser; token: GitHubToken });
          });
        }
      } catch (err) {
        console.error('[GitService] Failed to load credentials:', err);
      }
    }
  }

  private saveToDisk(): void {
    const credentialsPath = path.join(this.config.dataDir, 'credentials.json');
    const data = {
      sshKeys: this.sshKeys,
      githubUsers: Object.fromEntries(this.githubUsers),
    };
    writeFileSync(credentialsPath, JSON.stringify(data, null, 2));
  }

  // ============ GitHub OAuth ============

  /**
   * Generate OAuth URL for GitHub login
   */
  getGitHubOAuthUrl(userId: string): { url: string; state: string } {
    const state = randomBytes(16).toString('hex');
    this.pendingOAuthStates.set(state, { userId, timestamp: Date.now() });

    // Clean up old states (older than 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    this.pendingOAuthStates.forEach((value, key) => {
      if (value.timestamp < tenMinutesAgo) {
        this.pendingOAuthStates.delete(key);
      }
    });

    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: GITHUB_REDIRECT_URI,
      scope: 'repo read:user user:email',
      state,
    });

    return {
      url: `https://github.com/login/oauth/authorize?${params.toString()}`,
      state,
    };
  }

  /**
   * Handle OAuth callback from GitHub
   */
  async handleGitHubCallback(code: string, state: string): Promise<{
    success: boolean;
    user?: GitHubUser;
    userId?: string;
    error?: string;
  }> {
    const pending = this.pendingOAuthStates.get(state);
    if (!pending) {
      return { success: false, error: 'Invalid or expired OAuth state' };
    }

    this.pendingOAuthStates.delete(state);

    try {
      // Exchange code for access token
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
        }),
      });

      const tokenData = await tokenResponse.json() as GitHubToken & { error?: string };
      if (tokenData.error) {
        return { success: false, error: tokenData.error };
      }

      // Get user info
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const userData = await userResponse.json() as GitHubUser;

      // Store credentials
      this.githubUsers.set(pending.userId, {
        user: userData,
        token: tokenData,
      });
      this.saveToDisk();

      console.log(`[GitService] GitHub connected for user ${pending.userId}: ${userData.login}`);

      return { success: true, user: userData, userId: pending.userId };
    } catch (err) {
      console.error('[GitService] GitHub OAuth error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'OAuth failed' };
    }
  }

  /**
   * Get GitHub user for a userId
   */
  getGitHubUser(userId: string): { user: GitHubUser; token: GitHubToken } | null {
    return this.githubUsers.get(userId) || null;
  }

  /**
   * Disconnect GitHub for a user
   */
  disconnectGitHub(userId: string): void {
    this.githubUsers.delete(userId);
    this.saveToDisk();
  }

  // ============ SSH Key Management ============

  /**
   * Generate a new SSH key pair
   */
  generateSSHKey(name: string): { success: boolean; key?: SSHKey; error?: string } {
    try {
      const keyId = randomBytes(8).toString('hex');
      const keyPath = path.join(this.config.sshDir, `id_${keyId}`);

      // Generate key using ssh-keygen
      execSync(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "otherthing-${name}"`, {
        stdio: 'pipe',
      });

      const publicKey = readFileSync(`${keyPath}.pub`, 'utf-8').trim();
      const fingerprint = this.getKeyFingerprint(publicKey);

      const sshKey: SSHKey = {
        id: keyId,
        name,
        publicKey,
        privateKeyPath: keyPath,
        fingerprint,
        addedAt: new Date().toISOString(),
      };

      this.sshKeys.push(sshKey);
      this.saveToDisk();

      console.log(`[GitService] Generated SSH key: ${name} (${fingerprint})`);

      return { success: true, key: sshKey };
    } catch (err) {
      console.error('[GitService] Failed to generate SSH key:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Key generation failed' };
    }
  }

  /**
   * Import an existing SSH key
   */
  importSSHKey(name: string, privateKeyContent: string): { success: boolean; key?: SSHKey; error?: string } {
    try {
      const keyId = randomBytes(8).toString('hex');
      const keyPath = path.join(this.config.sshDir, `id_${keyId}`);

      // Write private key
      writeFileSync(keyPath, privateKeyContent, { mode: 0o600 });

      // Extract public key
      const publicKey = execSync(`ssh-keygen -y -f "${keyPath}"`, { encoding: 'utf-8' }).trim();
      writeFileSync(`${keyPath}.pub`, publicKey + '\n');

      const fingerprint = this.getKeyFingerprint(publicKey);

      const sshKey: SSHKey = {
        id: keyId,
        name,
        publicKey,
        privateKeyPath: keyPath,
        fingerprint,
        addedAt: new Date().toISOString(),
      };

      this.sshKeys.push(sshKey);
      this.saveToDisk();

      console.log(`[GitService] Imported SSH key: ${name} (${fingerprint})`);

      return { success: true, key: sshKey };
    } catch (err) {
      console.error('[GitService] Failed to import SSH key:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Key import failed' };
    }
  }

  /**
   * Get all SSH keys
   */
  getSSHKeys(): SSHKey[] {
    return this.sshKeys.map(k => ({
      ...k,
      // Don't expose private key path in API
      privateKeyPath: '[hidden]',
    }));
  }

  /**
   * Delete an SSH key
   */
  deleteSSHKey(keyId: string): { success: boolean; error?: string } {
    const keyIndex = this.sshKeys.findIndex(k => k.id === keyId);
    if (keyIndex === -1) {
      return { success: false, error: 'SSH key not found' };
    }

    const key = this.sshKeys[keyIndex];

    try {
      // Delete key files
      if (existsSync(key.privateKeyPath)) {
        execSync(`rm -f "${key.privateKeyPath}" "${key.privateKeyPath}.pub"`);
      }
    } catch (err) {
      console.error('[GitService] Failed to delete key files:', err);
    }

    this.sshKeys.splice(keyIndex, 1);
    this.saveToDisk();

    return { success: true };
  }

  private getKeyFingerprint(publicKey: string): string {
    const keyData = publicKey.split(' ')[1];
    const hash = createHash('sha256').update(Buffer.from(keyData, 'base64')).digest('base64');
    return `SHA256:${hash.replace(/=+$/, '')}`;
  }

  // ============ Git Operations ============

  /**
   * Clone a repository
   */
  async cloneRepo(options: CloneOptions): Promise<{ success: boolean; error?: string }> {
    const { url, targetDir, credentials, branch, depth } = options;

    try {
      let cloneUrl = url;
      let env: NodeJS.ProcessEnv = { ...process.env };

      // Set up authentication
      if (credentials) {
        if (credentials.type === 'github' && credentials.github) {
          // Use GitHub token for HTTPS URLs
          const token = credentials.github.token.access_token;
          cloneUrl = url.replace('https://github.com/', `https://${token}@github.com/`);
        } else if (credentials.type === 'ssh' && credentials.ssh) {
          // Use SSH key
          const key = this.sshKeys.find(k => k.id === credentials.ssh?.id);
          if (key) {
            env.GIT_SSH_COMMAND = `ssh -i "${key.privateKeyPath}" -o StrictHostKeyChecking=no`;
          }
        } else if (credentials.type === 'token' && credentials.token) {
          // Use personal access token
          cloneUrl = url.replace(
            'https://github.com/',
            `https://${credentials.token.username}:${credentials.token.token}@github.com/`
          );
        }
      }

      // Build clone command
      let cmd = `git clone`;
      if (depth) cmd += ` --depth ${depth}`;
      if (branch) cmd += ` --branch ${branch}`;
      cmd += ` "${cloneUrl}" "${targetDir}"`;

      execSync(cmd, { env, stdio: 'pipe' });

      console.log(`[GitService] Cloned ${url} to ${targetDir}`);

      return { success: true };
    } catch (err) {
      console.error('[GitService] Clone failed:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Clone failed' };
    }
  }

  /**
   * Pull latest changes
   */
  async pullRepo(repoPath: string, credentials?: GitCredentials): Promise<{ success: boolean; error?: string }> {
    try {
      let env: NodeJS.ProcessEnv = { ...process.env };

      if (credentials?.type === 'ssh' && credentials.ssh) {
        const key = this.sshKeys.find(k => k.id === credentials.ssh?.id);
        if (key) {
          env.GIT_SSH_COMMAND = `ssh -i "${key.privateKeyPath}" -o StrictHostKeyChecking=no`;
        }
      }

      execSync('git pull', { cwd: repoPath, env, stdio: 'pipe' });

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Pull failed' };
    }
  }

  /**
   * List user's GitHub repos
   */
  async listGitHubRepos(userId: string): Promise<{
    success: boolean;
    repos?: Array<{ name: string; full_name: string; private: boolean; clone_url: string; ssh_url: string }>;
    error?: string;
  }> {
    const github = this.githubUsers.get(userId);
    if (!github) {
      return { success: false, error: 'GitHub not connected' };
    }

    try {
      const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
        headers: {
          Authorization: `Bearer ${github.token.access_token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        return { success: false, error: `GitHub API error: ${response.status}` };
      }

      const repos = await response.json() as any[];
      return {
        success: true,
        repos: repos.map((r: any) => ({
          name: r.name,
          full_name: r.full_name,
          private: r.private,
          clone_url: r.clone_url,
          ssh_url: r.ssh_url,
        })),
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch repos' };
    }
  }

  /**
   * Get credentials for a user
   */
  getCredentials(userId: string): GitCredentials | null {
    const github = this.githubUsers.get(userId);
    if (github) {
      return { type: 'github', github };
    }
    // Check for SSH keys (use first available)
    if (this.sshKeys.length > 0) {
      return { type: 'ssh', ssh: this.sshKeys[0] };
    }
    return null;
  }
}

// Singleton instance
export const GitService = new GitServiceImpl();
