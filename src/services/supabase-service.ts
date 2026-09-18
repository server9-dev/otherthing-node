/**
 * Supabase data service — replaces appwrite-service.ts.
 *
 * Every call goes through `db()` at call time: inside an HTTP request that is
 * the signed-in user's client (RLS applies as that user); in background work
 * (inference relay, chain sync) it is the node session.
 *
 * Rows come back Appwrite-shaped so callers barely changed: lists are
 * `{ documents, total }`, each document has camelCase fields plus `$id`,
 * `$createdAt` / `$updatedAt` where the table has them. jsonb columns come back
 * already parsed.
 *
 * User columns (created_by, added_by, sender_id, user_id) default to
 * auth.uid() in the schema, so they are never sent on insert.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  db,
  currentUser,
  hasIdentity,
  isSupabaseConfigured,
  getSupabaseConfig,
} from './supabase-client';

export interface Doc {
  $id: string;
  $createdAt?: string;
  $updatedAt?: string;
  [key: string]: any;
}

export interface DocList {
  documents: Doc[];
  total: number;
}

// Explicit list caps (Appwrite silently capped every list at 25).
const LIMITS = {
  default: 500,
  chat: 100,
  signals: 50,
  usage: 100,
} as const;

// ─── Row mapping helpers ─────────────────────────────────────────────────────

const camel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const snake = (s: string): string => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);

function toDoc(row: any, idColumn = 'id'): Doc {
  const doc: any = {};
  for (const [k, v] of Object.entries(row)) doc[camel(k)] = v;
  doc.$id = row[idColumn];
  if (row.created_at !== undefined) doc.$createdAt = row.created_at;
  if (row.updated_at !== undefined) doc.$updatedAt = row.updated_at;
  return doc as Doc;
}

function toList(rows: any[] | null, count?: number | null, idColumn = 'id'): DocList {
  const documents = (rows || []).map(r => toDoc(r, idColumn));
  return { documents, total: count ?? documents.length };
}

/** Pick whitelisted camelCase keys from `data`, drop undefined, convert to snake_case. */
function pick(data: Record<string, any> | undefined, allowed: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  if (!data) return out;
  for (const key of allowed) {
    if (data[key] !== undefined) out[snake(key)] = data[key];
  }
  return out;
}

/** Drop undefined values so upserts only touch the columns actually supplied. */
function defined(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/** jsonb accepts objects; tolerate legacy callers that still pass a JSON string. */
function json(value: any): any {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function check<T>(res: { data: T; error: any }): T {
  if (res.error) throw res.error;
  return res.data;
}

/** PostgREST `in` list literal, quoting each value. */
function inList(values: string[]): string {
  return `(${values.map(v => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;
}

let anonClient: SupabaseClient | null = null;
function anonDb(): SupabaseClient {
  if (!anonClient) {
    const { url, publishableKey } = getSupabaseConfig();
    anonClient = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return anonClient;
}

// Column whitelists for partial updates (camelCase keys accepted from callers).
const WORKSPACE_FIELDS = ['name', 'description', 'isPrivate'] as const;
const FLOW_FIELDS = ['name', 'description', 'flow', 'uafEnabled', 'uafArchitecture'] as const;
const PROFILE_FIELDS = ['displayName', 'avatar', 'bio', 'walletAddress', 'chainId'] as const;
const REPO_FIELDS = ['url', 'name', 'status', 'error', 'ipfsCid', 'data', 'analyzedAt'] as const;
const WHITEBOARD_FIELDS = ['name', 'elementsCid', 'version'] as const;
const CHAIN_TASK_FIELDS = ['title', 'description', 'milestones', 'assigneeAddress', 'status'] as const;
const BOARD_TASK_FIELDS = ['title', 'description', 'status', 'priority', 'assignee', 'bounty', 'deadline'] as const;

export interface SignalPollOptions {
  /** Only return signals of these types (e.g. ['inference-request']). */
  types?: string[];
  limit?: number;
}

class SupabaseService {
  /** Configured and someone (request user or node session) is signed in. */
  isInitialized(): boolean {
    return isSupabaseConfigured() && hasIdentity();
  }

  // Workspaces and membership: see workspace-directory.ts

  // ============ WORKSPACE FLOWS ============

  async createFlow(workspaceId: string, data: {
    id?: string;
    name: string;
    description?: string;
    flow: any;
    uafEnabled?: boolean;
    uafArchitecture?: any;
  }): Promise<Doc> {
    const row = check(await db().from('workspace_flows').insert(defined({
      id: data.id,
      workspace_id: workspaceId,
      name: data.name,
      description: data.description,
      flow: json(data.flow) ?? null,
      uaf_enabled: data.uafEnabled,
      uaf_architecture: data.uafArchitecture !== undefined ? json(data.uafArchitecture) : undefined,
    })).select().single());
    return toDoc(row);
  }

  async listFlows(workspaceId: string): Promise<DocList> {
    const res = await db().from('workspace_flows').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).order('created_at').limit(LIMITS.default);
    return toList(check(res), res.count);
  }

  async updateFlow(flowId: string, data: Record<string, any>): Promise<Doc> {
    const update = pick(data, FLOW_FIELDS);
    if ('flow' in update) update.flow = json(update.flow);
    if ('uaf_architecture' in update) update.uaf_architecture = json(update.uaf_architecture);
    const row = check(await db().from('workspace_flows').update(update).eq('id', flowId).select().single());
    return toDoc(row);
  }

  async deleteFlow(flowId: string): Promise<void> {
    check(await db().from('workspace_flows').delete().eq('id', flowId));
  }

  // Aliases kept for route compatibility
  listWorkspaceFlows(workspaceId: string): Promise<DocList> { return this.listFlows(workspaceId); }
  createWorkspaceFlow(workspaceId: string, data: Parameters<SupabaseService['createFlow']>[1]): Promise<Doc> {
    return this.createFlow(workspaceId, data);
  }
  deleteWorkspaceFlow(flowId: string): Promise<void> { return this.deleteFlow(flowId); }

  // ============ WORKSPACE PEERS ============

  /** Upsert this node's row for the workspace. `user_id` defaults to the caller. */
  async registerPeer(workspaceId: string, data: {
    nodeId: string;
    peerId?: string;
    addresses?: string[];
    ollamaModels?: string[];
    ollamaEndpoint?: string | null;
    displayName?: string;
  }): Promise<Doc> {
    const row = check(await db().from('workspace_peers').upsert({
      workspace_id: workspaceId,
      node_id: data.nodeId,
      peer_id: data.peerId || '',
      addresses: data.addresses || [],
      display_name: data.displayName || data.nodeId,
      ollama_endpoint: data.ollamaEndpoint || null,
      ollama_models: data.ollamaModels || [],
      last_seen: new Date().toISOString(),
    }, { onConflict: 'workspace_id,node_id' }).select().single());
    return toDoc(row, 'node_id');
  }

  async listWorkspacePeers(workspaceId: string): Promise<DocList> {
    const res = await db().from('workspace_peers').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).order('last_seen', { ascending: false }).limit(LIMITS.default);
    return toList(check(res), res.count, 'node_id');
  }

  // ============ SIGNALING ============

  async sendSignal(data: {
    workspaceId: string;
    fromPeerId: string;
    targetPeerId: string;
    type: string; // sdp-offer, sdp-answer, ice-candidate, call-join, call-leave, inference-*
    payload: string; // JSON stringified
  }): Promise<Doc> {
    const row = check(await db().from('signaling').insert({
      workspace_id: data.workspaceId,
      from_peer_id: data.fromPeerId,
      target_peer_id: data.targetPeerId,
      type: data.type,
      payload: data.payload,
    }).select().single());
    return toDoc(row);
  }

  /**
   * Signals addressed to `peerId` (or any of several IDs) or broadcast to
   * 'all', excluding ones this peer sent, newer than `since`, oldest first.
   */
  async pollSignals(
    workspaceId: string,
    peerId: string | string[],
    since: string,
    opts: SignalPollOptions = {}
  ): Promise<DocList> {
    const ids = Array.isArray(peerId) ? peerId : [peerId];
    let q = db().from('signaling').select('*')
      .eq('workspace_id', workspaceId)
      .in('target_peer_id', [...ids, 'all'])
      .gt('timestamp', since);
    q = ids.length === 1 ? q.neq('from_peer_id', ids[0]) : q.not('from_peer_id', 'in', inList(ids));
    if (opts.types?.length) q = q.in('type', opts.types);
    const rows = check(await q.order('timestamp', { ascending: true }).limit(opts.limit ?? LIMITS.signals));
    return toList(rows);
  }

  async cleanupSignals(workspaceId: string): Promise<void> {
    try {
      check(await db().rpc('cleanup_signals', { ws: workspaceId }));
    } catch (err) {
      console.warn('[Supabase] cleanup_signals failed:', (err as Error).message);
    }
  }

  // ============ UAF ELEMENTS ============

  async createUAFElement(workspaceId: string, element: {
    id?: string;
    localId?: string;
    name: string;
    description?: string;
    viewpoint: string;
    modelKind: string;
    elementType: string;
    properties?: any;
  }): Promise<Doc> {
    const row = check(await db().from('uaf_elements').insert(defined({
      id: element.id,
      workspace_id: workspaceId,
      local_id: element.localId,
      name: element.name,
      description: element.description,
      viewpoint: element.viewpoint,
      model_kind: element.modelKind,
      element_type: element.elementType,
      properties: json(element.properties) ?? {},
    })).select().single());
    return toDoc(row);
  }

  async queryUAFElements(workspaceId: string, filters?: {
    viewpoint?: string;
    modelKind?: string;
    elementType?: string;
  }): Promise<DocList> {
    let q = db().from('uaf_elements').select('*', { count: 'exact' }).eq('workspace_id', workspaceId);
    if (filters?.viewpoint) q = q.eq('viewpoint', filters.viewpoint);
    if (filters?.modelKind) q = q.eq('model_kind', filters.modelKind);
    if (filters?.elementType) q = q.eq('element_type', filters.elementType);
    const res = await q.limit(LIMITS.default);
    const list = toList(check(res), res.count);
    for (const d of list.documents) d.properties = d.properties || {};
    return list;
  }

  async createUAFRelationship(data: {
    workspaceId: string;
    sourceId: string;
    targetId: string;
    relationshipType: string;
    properties?: any;
  }): Promise<Doc> {
    const row = check(await db().from('uaf_relationships').insert({
      workspace_id: data.workspaceId,
      source_id: data.sourceId,
      target_id: data.targetId,
      relationship_type: data.relationshipType,
      properties: json(data.properties) ?? {},
    }).select().single());
    return toDoc(row);
  }

  async getElementRelationships(elementId: string): Promise<{ outgoing: Doc[]; incoming: Doc[] }> {
    const [out, inc] = await Promise.all([
      db().from('uaf_relationships').select('*').eq('source_id', elementId).limit(LIMITS.default),
      db().from('uaf_relationships').select('*').eq('target_id', elementId).limit(LIMITS.default),
    ]);
    return { outgoing: toList(check(out)).documents, incoming: toList(check(inc)).documents };
  }

  // ============ SMART CONTRACTS (chain mirror) ============

  async registerSmartContract(data: {
    workspaceId: string;
    contractAddress: string;
    chainId: number;
    contractType: 'payment' | 'ip_license' | 'escrow' | 'milestone';
    abi: any;
  }): Promise<Doc> {
    const row = check(await db().from('smart_contracts').upsert({
      workspace_id: data.workspaceId,
      contract_address: data.contractAddress,
      chain_id: data.chainId,
      contract_type: data.contractType,
      abi: json(data.abi),
      status: 'active',
    }, { onConflict: 'contract_address,chain_id' }).select().single());
    return toDoc(row);
  }

  async listSmartContracts(workspaceId: string): Promise<DocList> {
    const res = await db().from('smart_contracts').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).limit(LIMITS.default);
    const list = toList(check(res), res.count);
    for (const d of list.documents) d.abi = d.abi || [];
    return list;
  }

  // ============ COMPUTE JOBS ============

  async createComputeJob(data: {
    workspaceId: string;
    type: 'wasm' | 'container' | 'native';
    payload: any;
    requirements?: { cpu?: number; memory?: number; gpu?: boolean };
  }): Promise<Doc> {
    const row = check(await db().from('compute_jobs').insert({
      workspace_id: data.workspaceId,
      type: data.type,
      payload: json(data.payload),
      requirements: data.requirements || {},
    }).select().single());
    return toDoc(row);
  }

  /** Atomic claim; returns null if another node got it first. */
  async claimComputeJob(jobId: string, nodeId: string): Promise<Doc | null> {
    const row: any = check(await db().rpc('claim_compute_job', { job: jobId, node: nodeId }));
    return row && row.id ? toDoc(row) : null;
  }

  async completeComputeJob(jobId: string, result: any, status: 'completed' | 'failed'): Promise<Doc> {
    const row = check(await db().from('compute_jobs').update({
      status,
      result: json(result),
      completed_at: new Date().toISOString(),
    }).eq('id', jobId).select().single());
    return toDoc(row);
  }

  /** Pending jobs across every workspace the caller belongs to (RLS-scoped). */
  async listPendingComputeJobs(): Promise<DocList> {
    const res = await db().from('compute_jobs').select('*', { count: 'exact' })
      .eq('status', 'pending').order('created_at').limit(LIMITS.default);
    const list = toList(check(res), res.count);
    for (const d of list.documents) d.requirements = d.requirements || {};
    return list;
  }

  // ============ USER PROFILES ============
  // A profile row is auto-created for every auth user; $id is the user id.

  /** Upsert the caller's own profile (the row normally exists already). */
  async createUserProfile(data: { userId: string; displayName?: string; avatar?: string; bio?: string }): Promise<Doc> {
    const row = check(await db().from('user_profiles').upsert(defined({
      user_id: data.userId,
      display_name: data.displayName,
      avatar: data.avatar,
      bio: data.bio,
    }), { onConflict: 'user_id' }).select().single());
    return toDoc(row, 'user_id');
  }

  async getUserProfile(userId: string): Promise<Doc | null> {
    const row = check(await db().from('user_profiles').select('*').eq('user_id', userId).maybeSingle());
    return row ? toDoc(row, 'user_id') : null;
  }

  /**
   * Public wallet → profile lookup (non-sensitive fields only). Works without
   * a signed-in identity via the anon role.
   */
  async getUserByWallet(walletAddress: string, chainId?: number): Promise<Doc | null> {
    const client = hasIdentity() ? db() : anonDb();
    const rows: any = check(await client.rpc('profile_by_wallet', {
      addr: walletAddress,
      chain: chainId ?? null,
    }));
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row ? toDoc(row, 'user_id') : null;
  }

  /** `profileId` is the user id (user_profiles is keyed by user_id). */
  async updateUserProfile(profileId: string, data: Record<string, any>): Promise<Doc> {
    const row = check(await db().from('user_profiles')
      .update(pick(data, PROFILE_FIELDS)).eq('user_id', profileId).select().single());
    return toDoc(row, 'user_id');
  }

  linkWallet(profileId: string, walletAddress: string, chainId: number): Promise<Doc> {
    return this.updateUserProfile(profileId, { walletAddress, chainId });
  }

  async unlinkWallet(profileId: string): Promise<Doc> {
    const row = check(await db().from('user_profiles')
      .update({ wallet_address: null, chain_id: null }).eq('user_id', profileId).select().single());
    return toDoc(row, 'user_id');
  }

  // ============ WORKSPACE REPOS ============

  async createWorkspaceRepo(workspaceId: string, data: {
    id?: string;
    url: string;
    name: string;
    status?: string;
  }): Promise<Doc> {
    const row = check(await db().from('workspace_repos').insert(defined({
      id: data.id,
      workspace_id: workspaceId,
      url: data.url,
      name: data.name,
      status: data.status,
    })).select().single());
    return toDoc(row);
  }

  async listWorkspaceRepos(workspaceId: string): Promise<DocList> {
    const res = await db().from('workspace_repos').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).order('added_at').limit(LIMITS.default);
    return toList(check(res), res.count);
  }

  /** Accepts url, name, status, error, ipfsCid, data (object), analyzedAt. */
  async updateWorkspaceRepo(repoId: string, data: Record<string, any>): Promise<Doc> {
    const update = pick(data, REPO_FIELDS);
    if ('data' in update) update.data = json(update.data);
    const row = check(await db().from('workspace_repos').update(update).eq('id', repoId).select().single());
    return toDoc(row);
  }

  async deleteWorkspaceRepo(repoId: string): Promise<void> {
    check(await db().from('workspace_repos').delete().eq('id', repoId));
  }

  // ============ WORKSPACE API KEYS (masked only) ============

  async createWorkspaceApiKey(workspaceId: string, data: {
    id?: string;
    provider: string;
    name: string;
    maskedKey: string;
  }): Promise<Doc> {
    const row = check(await db().from('workspace_api_keys').insert(defined({
      id: data.id,
      workspace_id: workspaceId,
      provider: data.provider,
      name: data.name,
      masked_key: data.maskedKey,
    })).select().single());
    return toDoc(row);
  }

  async listWorkspaceApiKeys(workspaceId: string): Promise<DocList> {
    const res = await db().from('workspace_api_keys').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).order('added_at').limit(LIMITS.default);
    return toList(check(res), res.count);
  }

  async deleteWorkspaceApiKey(keyId: string): Promise<void> {
    check(await db().from('workspace_api_keys').delete().eq('id', keyId));
  }

  // ============ STORED FILES ============

  /** Upsert on (cid, workspace_id): re-uploading identical content is a no-op. */
  async createStoredFile(workspaceId: string, data: {
    id?: string;
    cid: string;
    name: string;
    size: number;
    mimeType?: string;
    pinned?: boolean;
  }): Promise<Doc> {
    const row = check(await db().from('stored_files').upsert(defined({
      id: data.id,
      workspace_id: workspaceId,
      cid: data.cid,
      name: data.name,
      size: data.size,
      mime_type: data.mimeType,
      pinned: data.pinned,
    }), { onConflict: 'cid,workspace_id' }).select().single());
    return toDoc(row);
  }

  async listStoredFiles(workspaceId: string): Promise<DocList> {
    const res = await db().from('stored_files').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).order('added_at').limit(LIMITS.default);
    return toList(check(res), res.count);
  }

  async deleteStoredFile(fileId: string): Promise<void> {
    check(await db().from('stored_files').delete().eq('id', fileId));
  }

  // ============ RESOURCE USAGE ============

  async recordUsage(data: {
    workspaceId: string;
    flowId?: string;
    flowName?: string;
    type: string;
    provider?: string;
    tokensUsed?: number;
    computeSeconds?: number;
    costCents?: number;
  }): Promise<Doc> {
    const row = check(await db().from('resource_usage').insert(defined({
      workspace_id: data.workspaceId,
      flow_id: data.flowId,
      flow_name: data.flowName,
      type: data.type,
      provider: data.provider,
      tokens_used: data.tokensUsed,
      compute_seconds: data.computeSeconds,
      cost_cents: data.costCents,
    })).select().single());
    return toDoc(row);
  }

  async listUsage(workspaceId: string, limit: number = LIMITS.usage): Promise<DocList> {
    const res = await db().from('resource_usage').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).order('timestamp', { ascending: false }).limit(limit);
    return toList(check(res), res.count);
  }

  // ============ WHITEBOARDS ============

  async createWhiteboard(workspaceId: string, data: { id?: string; name: string; elementsCid?: string }): Promise<Doc> {
    const row = check(await db().from('whiteboards').insert(defined({
      id: data.id,
      workspace_id: workspaceId,
      name: data.name,
      elements_cid: data.elementsCid,
    })).select().single());
    return toDoc(row);
  }

  async listWhiteboards(workspaceId: string): Promise<DocList> {
    const res = await db().from('whiteboards').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).order('created_at').limit(LIMITS.default);
    return toList(check(res), res.count);
  }

  async updateWhiteboard(whiteboardId: string, data: Record<string, any>): Promise<Doc> {
    const row = check(await db().from('whiteboards')
      .update(pick(data, WHITEBOARD_FIELDS)).eq('id', whiteboardId).select().single());
    return toDoc(row);
  }

  async deleteWhiteboard(whiteboardId: string): Promise<void> {
    check(await db().from('whiteboards').delete().eq('id', whiteboardId));
  }

  // ============ AGREEMENTS (chain mirror) ============

  /** Upserts on chain_agreement_id when given, so repeat mirrors are idempotent. */
  async createAgreement(data: {
    workspaceId: string;
    chainAgreementId?: string;
    documentHash: string;
    title: string;
    type: string;
    issuerAddress: string;
    expiresAt?: string;
    required: boolean;
  }): Promise<Doc> {
    const values = defined({
      workspace_id: data.workspaceId,
      chain_agreement_id: data.chainAgreementId,
      document_hash: data.documentHash,
      title: data.title,
      type: data.type,
      issuer_address: data.issuerAddress,
      expires_at: data.expiresAt,
      required: data.required,
    });
    const q = data.chainAgreementId
      ? db().from('agreements').upsert(values, { onConflict: 'chain_agreement_id' })
      : db().from('agreements').insert(values);
    return toDoc(check(await q.select().single()));
  }

  async listAgreements(workspaceId: string): Promise<DocList> {
    const res = await db().from('agreements').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).order('created_at').limit(LIMITS.default);
    return toList(check(res), res.count);
  }

  /** Looks up by our row id or by the on-chain agreement id. */
  async getAgreement(agreementId: string): Promise<Doc | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agreementId);
    const row = check(await db().from('agreements').select('*')
      .eq(isUuid ? 'id' : 'chain_agreement_id', agreementId).maybeSingle());
    return row ? toDoc(row) : null;
  }

  /** Idempotent on (agreement_id, signer_address); both chain-sync and routes call it. */
  async recordSignature(data: { agreementId: string; signerAddress: string; txHash?: string }): Promise<Doc> {
    const row = check(await db().from('agreement_signatures').upsert(defined({
      agreement_id: data.agreementId,
      signer_address: data.signerAddress,
      tx_hash: data.txHash,
    }), { onConflict: 'agreement_id,signer_address' }).select().single());
    return toDoc(row);
  }

  async getSignatures(agreementId: string): Promise<DocList> {
    const res = await db().from('agreement_signatures').select('*', { count: 'exact' })
      .eq('agreement_id', agreementId).order('signed_at').limit(LIMITS.default);
    return toList(check(res), res.count);
  }

  async getSignaturesByAddress(signerAddress: string): Promise<DocList> {
    const res = await db().from('agreement_signatures').select('*', { count: 'exact' })
      .eq('signer_address', signerAddress).order('signed_at').limit(LIMITS.default);
    return toList(check(res), res.count);
  }

  // ============ TASKS (on-chain milestone mirror) ============

  /**
   * Upsert on task_id. Only supplied fields are written, so a later partial
   * upsert (e.g. chain-sync without a title) won't clobber richer data.
   * With `onlyIfNew`, an existing row is left untouched (returns null).
   */
  async createTask(data: {
    taskId: string;
    workspaceId: string;
    title?: string;
    description?: string;
    milestones?: any;
    assigneeAddress?: string;
    status: string;
    createdBy: string;
  }, opts: { onlyIfNew?: boolean } = {}): Promise<Doc | null> {
    const row = check(await db().from('tasks').upsert(defined({
      task_id: data.taskId,
      workspace_id: data.workspaceId,
      title: data.title,
      description: data.description,
      milestones: data.milestones !== undefined ? json(data.milestones) : undefined,
      assignee_address: data.assigneeAddress,
      status: data.status,
      created_by: data.createdBy,
    }), { onConflict: 'task_id', ignoreDuplicates: !!opts.onlyIfNew }).select().maybeSingle());
    return row ? this.chainTaskDoc(row) : null;
  }

  async listWorkspaceTasks(workspaceId: string): Promise<DocList> {
    const res = await db().from('tasks').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).order('created_at').limit(LIMITS.default);
    const rows = check(res) || [];
    return { documents: rows.map((r: any) => this.chainTaskDoc(r)), total: res.count ?? rows.length };
  }

  /** Update by our row id. */
  async updateTask(docId: string, data: Record<string, any>): Promise<Doc | null> {
    const update = pick(data, CHAIN_TASK_FIELDS);
    if ('milestones' in update) update.milestones = json(update.milestones);
    const row = check(await db().from('tasks').update(update).eq('id', docId).select().maybeSingle());
    return row ? this.chainTaskDoc(row) : null;
  }

  /** Update by on-chain task id in one statement; returns null if not mirrored yet. */
  async updateTaskByChainId(taskId: string, data: Record<string, any>): Promise<Doc | null> {
    const update = pick(data, CHAIN_TASK_FIELDS);
    if ('milestones' in update) update.milestones = json(update.milestones);
    const row = check(await db().from('tasks').update(update).eq('task_id', taskId).select().maybeSingle());
    return row ? this.chainTaskDoc(row) : null;
  }

  async getTaskByChainId(taskId: string): Promise<Doc | null> {
    const row = check(await db().from('tasks').select('*').eq('task_id', taskId).maybeSingle());
    return row ? this.chainTaskDoc(row) : null;
  }

  private chainTaskDoc(row: any): Doc {
    const doc = toDoc(row);
    doc.milestones = doc.milestones || [];
    doc.title = doc.title ?? 'On-chain Task';
    return doc;
  }

  // ============ IP REGISTRATIONS (chain mirror) ============

  /** Idempotent on task_id. */
  async registerIP(data: {
    workspaceId: string;
    taskId: string;
    creatorAddress: string;
    licenseType: string;
    licenseCid?: string;
    txHash?: string;
  }): Promise<Doc> {
    const row = check(await db().from('ip_registrations').upsert(defined({
      workspace_id: data.workspaceId,
      task_id: data.taskId,
      creator_address: data.creatorAddress,
      license_type: data.licenseType,
      license_cid: data.licenseCid,
      tx_hash: data.txHash,
    }), { onConflict: 'task_id' }).select().single());
    return toDoc(row);
  }

  async getIPForTask(taskId: string): Promise<Doc | null> {
    const row = check(await db().from('ip_registrations').select('*').eq('task_id', taskId).maybeSingle());
    return row ? toDoc(row) : null;
  }

  async listWorkspaceIP(workspaceId: string): Promise<DocList> {
    const res = await db().from('ip_registrations').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).order('created_at').limit(LIMITS.default);
    return toList(check(res), res.count);
  }

  // ============ CHAT MESSAGES ============

  async createChatMessage(data: {
    workspaceId: string;
    sender: string;
    senderName: string;
    content: string;
  }): Promise<Doc> {
    const row = check(await db().from('chat_messages').insert({
      workspace_id: data.workspaceId,
      sender: data.sender,
      sender_name: data.senderName,
      content: data.content,
    }).select().single());
    return toDoc(row);
  }

  /** Newest first. */
  async listChatMessages(workspaceId: string, limit: number = LIMITS.chat): Promise<DocList> {
    const res = await db().from('chat_messages').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).order('timestamp', { ascending: false }).limit(limit);
    return toList(check(res), res.count);
  }

  // ============ WORKSPACE TASKS (board tasks, not on-chain) ============

  async createWorkspaceTask(data: {
    id?: string;
    workspaceId: string;
    title: string;
    description?: string;
    status: string;
    priority: string;
    assignee?: string;
    bounty?: string;
    deadline?: string;
  }): Promise<Doc> {
    const row = check(await db().from('workspace_tasks').insert(defined({
      id: data.id,
      workspace_id: data.workspaceId,
      ...pick(data, BOARD_TASK_FIELDS),
    })).select().single());
    return toDoc(row);
  }

  async listWorkspaceBoardTasks(workspaceId: string): Promise<DocList> {
    const res = await db().from('workspace_tasks').select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId).order('created_at').limit(LIMITS.default);
    return toList(check(res), res.count);
  }

  /** Only title, description, status, priority, assignee, bounty, deadline are written. */
  async updateWorkspaceTask(taskId: string, data: Record<string, any>): Promise<Doc | null> {
    const update = pick(data, BOARD_TASK_FIELDS);
    if (Object.keys(update).length === 0) return null;
    const row = check(await db().from('workspace_tasks').update(update).eq('id', taskId).select().maybeSingle());
    return row ? toDoc(row) : null;
  }

  async deleteWorkspaceTask(taskId: string): Promise<void> {
    check(await db().from('workspace_tasks').delete().eq('id', taskId));
  }
}

export const supabaseService = new SupabaseService();
