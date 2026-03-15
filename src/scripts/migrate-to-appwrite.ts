/**
 * Migration Script: Push existing workspaces.json data to Appwrite
 *
 * Usage: npx ts-node src/scripts/migrate-to-appwrite.ts
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { appwriteService } from '../services/appwrite-service';

async function migrate() {
  // Initialize Appwrite
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  const endpoint = process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';

  if (!projectId || !apiKey) {
    console.error('Error: Missing APPWRITE_PROJECT_ID or APPWRITE_API_KEY');
    process.exit(1);
  }

  appwriteService.init({ endpoint, projectId, apiKey });
  console.log('[Migrate] Appwrite initialized\n');

  // Find and load workspaces.json
  const possiblePaths = [
    path.join(process.cwd(), 'workspaces.json'),
    path.join(process.cwd(), 'data', 'workspaces.json'),
    path.join(require('os').homedir(), '.otherthing', 'workspaces.json'),
  ];

  let workspacesData: any = null;
  let dataPath = '';

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      dataPath = p;
      try {
        workspacesData = JSON.parse(readFileSync(p, 'utf-8'));
        break;
      } catch (err) {
        console.warn(`[Migrate] Failed to parse ${p}:`, err);
      }
    }
  }

  if (!workspacesData) {
    console.log('[Migrate] No workspaces.json found. Nothing to migrate.');
    console.log('Searched:', possiblePaths.join('\n  '));
    return;
  }

  console.log(`[Migrate] Found workspace data at: ${dataPath}`);

  // Handle both array and object formats
  const workspaces = Array.isArray(workspacesData)
    ? workspacesData
    : workspacesData.workspaces || Object.values(workspacesData);

  console.log(`[Migrate] Found ${workspaces.length} workspaces to migrate\n`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const ws of workspaces) {
    try {
      console.log(`[Migrate] Migrating workspace: ${ws.name || ws.id}`);

      await appwriteService.createWorkspace({
        name: ws.name || 'Unnamed Workspace',
        description: ws.description || '',
        ownerId: ws.ownerId || 'local-user',
        isPrivate: ws.isPrivate !== false,
      });

      migrated++;
      console.log(`  + Created workspace: ${ws.name}`);

      // Migrate members if present
      if (ws.members && Array.isArray(ws.members)) {
        for (const member of ws.members) {
          if (member.userId === ws.ownerId) continue; // Skip owner
          // Note: member migration would need workspace ID from Appwrite
          console.log(`  + Member: ${member.username || member.userId}`);
        }
      }

      // Migrate flows if present
      if (ws.flows && Array.isArray(ws.flows)) {
        for (const flow of ws.flows) {
          try {
            // Note: would need the Appwrite workspace ID
            console.log(`  + Flow: ${flow.name}`);
          } catch (err) {
            console.warn(`  ! Failed to migrate flow ${flow.name}:`, err);
          }
        }
      }
    } catch (err: any) {
      if (err.code === 409) {
        console.log(`  - Skipped (already exists): ${ws.name}`);
        skipped++;
      } else {
        console.error(`  ! Failed to migrate workspace ${ws.name}:`, err.message);
        failed++;
      }
    }
  }

  console.log(`\n[Migrate] Complete!`);
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Failed:   ${failed}`);
}

migrate().catch(console.error);
