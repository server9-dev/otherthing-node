/**
 * Appwrite Service - Cloud backend integration for otherthing-node
 * Handles auth, database, storage, and real-time sync
 */

import { Client, Account, Databases, Storage, Users, Teams, ID, Query } from 'node-appwrite';

// Configuration - will be set from environment or config file
interface AppwriteConfig {
  endpoint: string;
  projectId: string;
  apiKey: string;  // Server-side API key
}

// Collection IDs for the database
export const COLLECTIONS = {
  USERS: 'users',
  WORKSPACES: 'workspaces',
  WORKSPACE_MEMBERS: 'workspace_members',
  WORKSPACE_FLOWS: 'workspace_flows',
  UAF_ELEMENTS: 'uaf_elements',
  UAF_RELATIONSHIPS: 'uaf_relationships',
  SMART_CONTRACTS: 'smart_contracts',
  COMPUTE_JOBS: 'compute_jobs',
} as const;

// Database ID
export const DATABASE_ID = 'otherthing_main';

class AppwriteService {
  private client: Client;
  private account: Account;
  private databases: Databases;
  private storage: Storage;
  private users: Users;
  private teams: Teams;
  private initialized = false;

  constructor() {
    this.client = new Client();
    this.account = new Account(this.client);
    this.databases = new Databases(this.client);
    this.storage = new Storage(this.client);
    this.users = new Users(this.client);
    this.teams = new Teams(this.client);
  }

  /**
   * Initialize the Appwrite client with configuration
   */
  init(config: AppwriteConfig): void {
    this.client
      .setEndpoint(config.endpoint)
      .setProject(config.projectId)
      .setKey(config.apiKey);

    this.initialized = true;
    console.log('[Appwrite] Initialized with project:', config.projectId);
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============ USER MANAGEMENT ============

  /**
   * Create a new user
   */
  async createUser(email: string, password: string, name: string): Promise<any> {
    return await this.users.create(ID.unique(), email, undefined, password, name);
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<any> {
    return await this.users.get(userId);
  }

  /**
   * List all users
   */
  async listUsers(queries: string[] = []): Promise<any> {
    return await this.users.list(queries);
  }

  // ============ WORKSPACE MANAGEMENT ============

  /**
   * Create a workspace
   */
  async createWorkspace(data: {
    name: string;
    description: string;
    ownerId: string;
    isPrivate: boolean;
  }): Promise<any> {
    return await this.databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.WORKSPACES,
      ID.unique(),
      {
        ...data,
        inviteCode: this.generateInviteCode(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Get workspace by ID
   */
  async getWorkspace(workspaceId: string): Promise<any> {
    return await this.databases.getDocument(
      DATABASE_ID,
      COLLECTIONS.WORKSPACES,
      workspaceId
    );
  }

  /**
   * List workspaces for a user
   */
  async listUserWorkspaces(userId: string): Promise<any> {
    // Get workspaces where user is owner or member
    const owned = await this.databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.WORKSPACES,
      [Query.equal('ownerId', userId)]
    );

    const memberships = await this.databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.WORKSPACE_MEMBERS,
      [Query.equal('userId', userId)]
    );

    const memberWorkspaceIds = memberships.documents.map((m: any) => m.workspaceId);

    let memberWorkspaces = { documents: [] as any[] };
    if (memberWorkspaceIds.length > 0) {
      memberWorkspaces = await this.databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.WORKSPACES,
        [Query.equal('$id', memberWorkspaceIds)]
      );
    }

    return {
      owned: owned.documents,
      member: memberWorkspaces.documents,
    };
  }

  /**
   * Update workspace
   */
  async updateWorkspace(workspaceId: string, data: Partial<any>): Promise<any> {
    return await this.databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.WORKSPACES,
      workspaceId,
      {
        ...data,
        updatedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Delete workspace
   */
  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.databases.deleteDocument(
      DATABASE_ID,
      COLLECTIONS.WORKSPACES,
      workspaceId
    );
  }

  // ============ WORKSPACE FLOWS ============

  /**
   * Create a flow in a workspace
   */
  async createFlow(workspaceId: string, data: {
    name: string;
    description: string;
    flow: any;
    createdBy: string;
    uafEnabled?: boolean;
    uafArchitecture?: any;
  }): Promise<any> {
    return await this.databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.WORKSPACE_FLOWS,
      ID.unique(),
      {
        workspaceId,
        ...data,
        flow: JSON.stringify(data.flow),
        uafArchitecture: data.uafArchitecture ? JSON.stringify(data.uafArchitecture) : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Get flows for a workspace
   */
  async listFlows(workspaceId: string): Promise<any> {
    const result = await this.databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.WORKSPACE_FLOWS,
      [Query.equal('workspaceId', workspaceId)]
    );

    // Parse JSON fields
    result.documents = result.documents.map((doc: any) => ({
      ...doc,
      flow: JSON.parse(doc.flow || '{}'),
      uafArchitecture: doc.uafArchitecture ? JSON.parse(doc.uafArchitecture) : null,
    }));

    return result;
  }

  /**
   * Update a flow
   */
  async updateFlow(flowId: string, data: Partial<any>): Promise<any> {
    const updateData: any = {
      ...data,
      updatedAt: new Date().toISOString(),
    };

    if (data.flow) {
      updateData.flow = JSON.stringify(data.flow);
    }
    if (data.uafArchitecture) {
      updateData.uafArchitecture = JSON.stringify(data.uafArchitecture);
    }

    return await this.databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.WORKSPACE_FLOWS,
      flowId,
      updateData
    );
  }

  // ============ UAF ELEMENTS ============

  /**
   * Create a UAF element
   */
  async createUAFElement(workspaceId: string, element: {
    name: string;
    description: string;
    viewpoint: string;
    modelKind: string;
    elementType: string;
    properties: any;
    createdBy: string;
  }): Promise<any> {
    return await this.databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.UAF_ELEMENTS,
      ID.unique(),
      {
        workspaceId,
        ...element,
        properties: JSON.stringify(element.properties),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      }
    );
  }

  /**
   * Query UAF elements
   */
  async queryUAFElements(workspaceId: string, filters?: {
    viewpoint?: string;
    modelKind?: string;
    elementType?: string;
  }): Promise<any> {
    const queries = [Query.equal('workspaceId', workspaceId)];

    if (filters?.viewpoint) {
      queries.push(Query.equal('viewpoint', filters.viewpoint));
    }
    if (filters?.modelKind) {
      queries.push(Query.equal('modelKind', filters.modelKind));
    }
    if (filters?.elementType) {
      queries.push(Query.equal('elementType', filters.elementType));
    }

    const result = await this.databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.UAF_ELEMENTS,
      queries
    );

    // Parse JSON fields
    result.documents = result.documents.map((doc: any) => ({
      ...doc,
      properties: JSON.parse(doc.properties || '{}'),
    }));

    return result;
  }

  /**
   * Create UAF relationship between elements
   */
  async createUAFRelationship(data: {
    workspaceId: string;
    sourceId: string;
    targetId: string;
    relationshipType: string;
    properties?: any;
    createdBy: string;
  }): Promise<any> {
    return await this.databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.UAF_RELATIONSHIPS,
      ID.unique(),
      {
        ...data,
        properties: data.properties ? JSON.stringify(data.properties) : '{}',
        createdAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Get relationships for an element
   */
  async getElementRelationships(elementId: string): Promise<any> {
    const asSource = await this.databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.UAF_RELATIONSHIPS,
      [Query.equal('sourceId', elementId)]
    );

    const asTarget = await this.databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.UAF_RELATIONSHIPS,
      [Query.equal('targetId', elementId)]
    );

    return {
      outgoing: asSource.documents,
      incoming: asTarget.documents,
    };
  }

  // ============ SMART CONTRACTS ============

  /**
   * Register a smart contract for a workspace
   */
  async registerSmartContract(data: {
    workspaceId: string;
    contractAddress: string;
    chainId: number;
    contractType: 'payment' | 'ip_license' | 'escrow' | 'milestone';
    abi: any;
    createdBy: string;
  }): Promise<any> {
    return await this.databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.SMART_CONTRACTS,
      ID.unique(),
      {
        ...data,
        abi: JSON.stringify(data.abi),
        status: 'active',
        createdAt: new Date().toISOString(),
      }
    );
  }

  /**
   * List smart contracts for a workspace
   */
  async listSmartContracts(workspaceId: string): Promise<any> {
    const result = await this.databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.SMART_CONTRACTS,
      [Query.equal('workspaceId', workspaceId)]
    );

    result.documents = result.documents.map((doc: any) => ({
      ...doc,
      abi: JSON.parse(doc.abi || '[]'),
    }));

    return result;
  }

  // ============ COMPUTE JOBS (P2P) ============

  /**
   * Create a compute job
   */
  async createComputeJob(data: {
    workspaceId: string;
    type: 'wasm' | 'container' | 'native';
    payload: any;
    requirements?: {
      cpu?: number;
      memory?: number;
      gpu?: boolean;
    };
    createdBy: string;
  }): Promise<any> {
    return await this.databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.COMPUTE_JOBS,
      ID.unique(),
      {
        ...data,
        payload: JSON.stringify(data.payload),
        requirements: JSON.stringify(data.requirements || {}),
        status: 'pending',
        assignedTo: null,
        result: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Claim a compute job (P2P node picks it up)
   */
  async claimComputeJob(jobId: string, nodeId: string): Promise<any> {
    return await this.databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.COMPUTE_JOBS,
      jobId,
      {
        status: 'running',
        assignedTo: nodeId,
        updatedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Complete a compute job
   */
  async completeComputeJob(jobId: string, result: any, status: 'completed' | 'failed'): Promise<any> {
    return await this.databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.COMPUTE_JOBS,
      jobId,
      {
        status,
        result: JSON.stringify(result),
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * List pending compute jobs (for P2P nodes to pick up)
   */
  async listPendingComputeJobs(): Promise<any> {
    const result = await this.databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.COMPUTE_JOBS,
      [Query.equal('status', 'pending')]
    );

    result.documents = result.documents.map((doc: any) => ({
      ...doc,
      payload: JSON.parse(doc.payload || '{}'),
      requirements: JSON.parse(doc.requirements || '{}'),
    }));

    return result;
  }

  // ============ TEAMS (for workspace collaboration) ============

  /**
   * Create a team for a workspace
   */
  async createTeam(name: string): Promise<any> {
    return await this.teams.create(ID.unique(), name);
  }

  /**
   * Add member to team
   */
  async addTeamMember(teamId: string, email: string, roles: string[]): Promise<any> {
    return await this.teams.createMembership(
      teamId,
      roles as any,  // Appwrite SDK types are strict
      email
    );
  }

  // ============ STORAGE ============

  /**
   * Upload a file
   */
  async uploadFile(bucketId: string, file: any, fileName: string): Promise<any> {
    return await this.storage.createFile(bucketId, ID.unique(), file);
  }

  /**
   * Get file download URL
   */
  getFileDownloadUrl(bucketId: string, fileId: string): string {
    return `${this.client.config.endpoint}/storage/buckets/${bucketId}/files/${fileId}/download?project=${this.client.config.project}`;
  }

  // ============ HELPERS ============

  private generateInviteCode(): string {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  /**
   * Get raw client for advanced operations
   */
  getClient(): Client {
    return this.client;
  }

  getDatabases(): Databases {
    return this.databases;
  }

  getStorage(): Storage {
    return this.storage;
  }
}

// Export singleton instance
export const appwriteService = new AppwriteService();
