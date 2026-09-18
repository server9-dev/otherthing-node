/**
 * Workspace directory — workspaces and membership live in Supabase; each node
 * keeps a local mirror in WorkspaceManager for the data that is still
 * local-only (flows, API keys, repos, whiteboards, ...).
 *
 * All calls run as whoever `db()` resolves to: the request's user, or the node
 * session for background/startup work.
 */

import { db } from './supabase-client';
import type { Workspace, WorkspaceManager } from './workspace-manager';

const WORKSPACE_SELECT =
  'id, name, description, is_private, invite_code, owner_id, ipfs_swarm_key, created_at, ' +
  'workspace_members ( user_id, role, joined_at, user_profiles ( display_name ) )';

function toMirror(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    isPrivate: row.is_private,
    inviteCode: row.invite_code,
    ownerId: row.owner_id,
    ipfsSwarmKey: row.ipfs_swarm_key,
    createdAt: row.created_at,
    members: (row.workspace_members || []).map((m: any) => ({
      userId: m.user_id,
      username: m.user_profiles?.display_name || m.user_id.slice(0, 8),
      role: m.role,
      joinedAt: m.joined_at,
    })),
  };
}

function fail(error: { message: string } | null, context: string): never {
  throw new Error(`${context}: ${error?.message || 'unknown error'}`);
}

export class WorkspaceDirectory {
  constructor(private workspaceManager: WorkspaceManager) {}

  /** Workspaces the current user belongs to; refreshes local mirrors and drops stale ones. */
  async listMine(userId: string): Promise<Workspace[]> {
    const { data, error } = await db()
      .from('workspaces')
      .select(WORKSPACE_SELECT)
      .order('created_at', { ascending: true });
    if (error) fail(error, 'List workspaces');

    const remoteIds = new Set<string>();
    const result = (data || []).map((row: any) => {
      remoteIds.add(row.id);
      return this.workspaceManager.mirrorRemote(toMirror(row));
    });

    // Local copies this user no longer has access to (deleted, left, removed)
    for (const local of this.workspaceManager.getUserWorkspaces(userId)) {
      if (!remoteIds.has(local.id)) this.workspaceManager.removeLocal(local.id);
    }
    return result;
  }

  async get(workspaceId: string): Promise<Workspace | null> {
    const { data, error } = await db()
      .from('workspaces')
      .select(WORKSPACE_SELECT)
      .eq('id', workspaceId)
      .maybeSingle();
    if (error) fail(error, 'Get workspace');
    if (!data) {
      this.workspaceManager.removeLocal(workspaceId);
      return null;
    }
    return this.workspaceManager.mirrorRemote(toMirror(data));
  }

  async create(ownerId: string, name: string, description: string): Promise<Workspace> {
    const { data, error } = await db()
      .from('workspaces')
      .insert({ name, description, owner_id: ownerId })
      .select('id')
      .single();
    if (error) fail(error, 'Create workspace');
    return (await this.get(data.id))!;
  }

  async join(inviteCode: string): Promise<Workspace> {
    const { data, error } = await db().rpc('join_workspace', { code: inviteCode });
    if (error) fail(error, 'Join workspace');
    return (await this.get((data as any).id))!;
  }

  async leave(workspaceId: string, userId: string): Promise<void> {
    const ws = await this.get(workspaceId);
    if (!ws) throw new Error('Workspace not found');
    if (ws.ownerId === userId) {
      throw new Error('Owner cannot leave workspace. Transfer ownership or delete it.');
    }
    const { error } = await db()
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId);
    if (error) fail(error, 'Leave workspace');
    this.workspaceManager.removeLocal(workspaceId);
  }

  async remove(workspaceId: string): Promise<void> {
    // RLS only lets the owner delete; a non-owner's delete matches zero rows.
    const { data, error } = await db().from('workspaces').delete().eq('id', workspaceId).select('id');
    if (error) fail(error, 'Delete workspace');
    if (!data || data.length === 0) throw new Error('Only the owner can delete a workspace');
    this.workspaceManager.removeLocal(workspaceId);
  }

  async regenerateInviteCode(workspaceId: string): Promise<string> {
    const { data, error } = await db().rpc('regenerate_invite_code', { ws: workspaceId });
    if (error) fail(error, 'Regenerate invite code');
    await this.get(workspaceId);
    return data as string;
  }
}
