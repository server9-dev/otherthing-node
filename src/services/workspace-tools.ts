/**
 * Workspace Tools — registers AI-accessible tools via the agent adapter pattern
 */

import type { WorkspaceManager } from './workspace-manager';

interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>, context?: any) => Promise<string>;
}

// In-memory task store reference (shared with tasks route)
let tasksStoreRef: Map<string, any[]> | null = null;
let chatMessagesRef: Map<string, any[]> | null = null;
let workspaceManagerRef: WorkspaceManager | null = null;

export function setWorkspaceToolRefs(
  tasks: Map<string, any[]>,
  chat: Map<string, any[]>,
  wm: WorkspaceManager
): void {
  tasksStoreRef = tasks;
  chatMessagesRef = chat;
  workspaceManagerRef = wm;
}

export function getWorkspaceTools(): ToolDef[] {
  return [
    {
      name: 'update_task',
      description: 'Update a task in the workspace. Can change status, priority, assignee, etc.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: 'Workspace ID' },
          taskId: { type: 'string', description: 'Task ID to update' },
          updates: { type: 'object', description: 'Fields to update (status, priority, assignee, title, description)' },
        },
        required: ['workspaceId', 'taskId', 'updates'],
      },
      execute: async (params) => {
        if (!tasksStoreRef) return 'Task store not available';
        const tasks = tasksStoreRef.get(params.workspaceId as string) || [];
        const task = tasks.find(t => t.id === params.taskId);
        if (!task) return `Task ${params.taskId} not found`;
        Object.assign(task, params.updates, { updatedAt: new Date().toISOString() });
        return `Task "${task.title}" updated successfully`;
      },
    },
    {
      name: 'create_task',
      description: 'Create a new task in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          assignee: { type: 'string' },
        },
        required: ['workspaceId', 'title'],
      },
      execute: async (params) => {
        if (!tasksStoreRef) return 'Task store not available';
        const wsId = params.workspaceId as string;
        if (!tasksStoreRef.has(wsId)) tasksStoreRef.set(wsId, []);
        const task = {
          id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: params.title,
          description: params.description || '',
          status: 'todo',
          priority: params.priority || 'medium',
          assignee: params.assignee,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        tasksStoreRef.get(wsId)!.push(task);
        return `Task "${task.title}" created (ID: ${task.id})`;
      },
    },
    {
      name: 'list_tasks',
      description: 'List tasks in the workspace, optionally filtered by status.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          status: { type: 'string', description: 'Filter by status (todo, in-progress, done)' },
        },
        required: ['workspaceId'],
      },
      execute: async (params) => {
        if (!tasksStoreRef) return 'Task store not available';
        let tasks = tasksStoreRef.get(params.workspaceId as string) || [];
        if (params.status) {
          tasks = tasks.filter(t => t.status === params.status);
        }
        if (tasks.length === 0) return 'No tasks found';
        return tasks.map(t => `[${t.status}] ${t.title} (${t.priority}) - ${t.id}`).join('\n');
      },
    },
    {
      name: 'search_chat',
      description: 'Search team chat messages for keywords.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number' },
        },
        required: ['workspaceId', 'query'],
      },
      execute: async (params) => {
        if (!chatMessagesRef) return 'Chat not available';
        const msgs = chatMessagesRef.get(params.workspaceId as string) || [];
        const query = (params.query as string).toLowerCase();
        const matches = msgs.filter(m => m.content.toLowerCase().includes(query));
        const limited = matches.slice(-(params.limit as number || 20));
        if (limited.length === 0) return `No messages matching "${params.query}"`;
        return limited.map(m => `[${m.senderName}] ${m.content}`).join('\n');
      },
    },
    {
      name: 'get_workspace_state',
      description: 'Get an overview of the current workspace state including task counts, recent activity.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
        },
        required: ['workspaceId'],
      },
      execute: async (params) => {
        const wsId = params.workspaceId as string;
        const tasks = tasksStoreRef?.get(wsId) || [];
        const msgs = chatMessagesRef?.get(wsId) || [];

        const statusCounts: Record<string, number> = {};
        for (const t of tasks) {
          statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
        }

        return JSON.stringify({
          taskCount: tasks.length,
          tasksByStatus: statusCounts,
          recentMessages: msgs.length,
          lastMessageAt: msgs.length > 0 ? msgs[msgs.length - 1].timestamp : null,
        }, null, 2);
      },
    },
  ];
}
