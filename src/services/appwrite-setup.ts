/**
 * Appwrite Setup Script
 * Run this once to create database and collections in Appwrite
 *
 * Usage: npx ts-node src/services/appwrite-setup.ts
 */

import { Client, Databases, ID } from 'node-appwrite';

const DATABASE_ID = 'otherthing_main';

// Collection schemas
const collections = [
  {
    id: 'workspaces',
    name: 'Workspaces',
    attributes: [
      { key: 'name', type: 'string', size: 255, required: true },
      { key: 'description', type: 'string', size: 2000, required: false },
      { key: 'ownerId', type: 'string', size: 36, required: true },
      { key: 'isPrivate', type: 'boolean', required: true },
      { key: 'inviteCode', type: 'string', size: 10, required: true },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'ownerId_idx', type: 'key', attributes: ['ownerId'] },
      { key: 'inviteCode_idx', type: 'unique', attributes: ['inviteCode'] },
    ],
  },
  {
    id: 'workspace_members',
    name: 'Workspace Members',
    attributes: [
      { key: 'workspaceId', type: 'string', size: 36, required: true },
      { key: 'userId', type: 'string', size: 36, required: true },
      { key: 'role', type: 'string', size: 50, required: true }, // owner, admin, member, viewer
      { key: 'joinedAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'workspaceId_idx', type: 'key', attributes: ['workspaceId'] },
      { key: 'userId_idx', type: 'key', attributes: ['userId'] },
      { key: 'unique_member', type: 'unique', attributes: ['workspaceId', 'userId'] },
    ],
  },
  {
    id: 'workspace_flows',
    name: 'Workspace Flows',
    attributes: [
      { key: 'workspaceId', type: 'string', size: 36, required: true },
      { key: 'name', type: 'string', size: 255, required: true },
      { key: 'description', type: 'string', size: 2000, required: false },
      { key: 'flow', type: 'string', size: 1000000, required: false }, // JSON string
      { key: 'createdBy', type: 'string', size: 36, required: true },
      { key: 'uafEnabled', type: 'boolean', required: false },
      { key: 'uafArchitecture', type: 'string', size: 1000000, required: false }, // JSON string
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'workspaceId_idx', type: 'key', attributes: ['workspaceId'] },
    ],
  },
  {
    id: 'uaf_elements',
    name: 'UAF Elements',
    attributes: [
      { key: 'workspaceId', type: 'string', size: 36, required: true },
      { key: 'name', type: 'string', size: 255, required: true },
      { key: 'description', type: 'string', size: 5000, required: false },
      { key: 'viewpoint', type: 'string', size: 50, required: true },
      { key: 'modelKind', type: 'string', size: 50, required: true },
      { key: 'elementType', type: 'string', size: 100, required: true },
      { key: 'properties', type: 'string', size: 100000, required: false }, // JSON
      { key: 'createdBy', type: 'string', size: 36, required: true },
      { key: 'version', type: 'integer', required: true },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'workspaceId_idx', type: 'key', attributes: ['workspaceId'] },
      { key: 'viewpoint_idx', type: 'key', attributes: ['viewpoint'] },
      { key: 'modelKind_idx', type: 'key', attributes: ['modelKind'] },
      { key: 'elementType_idx', type: 'key', attributes: ['elementType'] },
      { key: 'grid_idx', type: 'key', attributes: ['workspaceId', 'viewpoint', 'modelKind'] },
    ],
  },
  {
    id: 'uaf_relationships',
    name: 'UAF Relationships',
    attributes: [
      { key: 'workspaceId', type: 'string', size: 36, required: true },
      { key: 'sourceId', type: 'string', size: 36, required: true },
      { key: 'targetId', type: 'string', size: 36, required: true },
      { key: 'relationshipType', type: 'string', size: 100, required: true },
      { key: 'properties', type: 'string', size: 10000, required: false }, // JSON
      { key: 'createdBy', type: 'string', size: 36, required: true },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'sourceId_idx', type: 'key', attributes: ['sourceId'] },
      { key: 'targetId_idx', type: 'key', attributes: ['targetId'] },
      { key: 'workspaceId_idx', type: 'key', attributes: ['workspaceId'] },
    ],
  },
  {
    id: 'smart_contracts',
    name: 'Smart Contracts',
    attributes: [
      { key: 'workspaceId', type: 'string', size: 36, required: true },
      { key: 'contractAddress', type: 'string', size: 100, required: true },
      { key: 'chainId', type: 'integer', required: true },
      { key: 'contractType', type: 'string', size: 50, required: true }, // payment, ip_license, escrow, milestone
      { key: 'abi', type: 'string', size: 500000, required: false }, // JSON
      { key: 'status', type: 'string', size: 20, required: true }, // active, paused, completed
      { key: 'createdBy', type: 'string', size: 36, required: true },
      { key: 'createdAt', type: 'datetime', required: true },
    ],
    indexes: [
      { key: 'workspaceId_idx', type: 'key', attributes: ['workspaceId'] },
      { key: 'contractAddress_idx', type: 'unique', attributes: ['contractAddress', 'chainId'] },
    ],
  },
  {
    id: 'compute_jobs',
    name: 'Compute Jobs',
    attributes: [
      { key: 'workspaceId', type: 'string', size: 36, required: true },
      { key: 'type', type: 'string', size: 20, required: true }, // wasm, container, native
      { key: 'payload', type: 'string', size: 1000000, required: true }, // JSON
      { key: 'requirements', type: 'string', size: 10000, required: false }, // JSON
      { key: 'status', type: 'string', size: 20, required: true }, // pending, running, completed, failed
      { key: 'assignedTo', type: 'string', size: 100, required: false }, // P2P node ID
      { key: 'result', type: 'string', size: 1000000, required: false }, // JSON
      { key: 'createdBy', type: 'string', size: 36, required: true },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
      { key: 'completedAt', type: 'datetime', required: false },
    ],
    indexes: [
      { key: 'workspaceId_idx', type: 'key', attributes: ['workspaceId'] },
      { key: 'status_idx', type: 'key', attributes: ['status'] },
      { key: 'assignedTo_idx', type: 'key', attributes: ['assignedTo'] },
    ],
  },
];

async function setup() {
  // Get config from environment or prompt
  const endpoint = process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;

  if (!projectId || !apiKey) {
    console.error('Error: Missing APPWRITE_PROJECT_ID or APPWRITE_API_KEY environment variables');
    console.log('\nUsage:');
    console.log('  APPWRITE_PROJECT_ID=your-project-id APPWRITE_API_KEY=your-api-key npx ts-node src/services/appwrite-setup.ts');
    process.exit(1);
  }

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

  const databases = new Databases(client);

  console.log('Setting up Appwrite database and collections...\n');

  // Create database
  try {
    await databases.create(DATABASE_ID, 'Otherthing Main Database');
    console.log(`✓ Created database: ${DATABASE_ID}`);
  } catch (error: any) {
    if (error.code === 409) {
      console.log(`• Database already exists: ${DATABASE_ID}`);
    } else {
      throw error;
    }
  }

  // Create collections
  for (const collection of collections) {
    try {
      await databases.createCollection(DATABASE_ID, collection.id, collection.name);
      console.log(`✓ Created collection: ${collection.name}`);
    } catch (error: any) {
      if (error.code === 409) {
        console.log(`• Collection already exists: ${collection.name}`);
      } else {
        console.error(`✗ Error creating collection ${collection.name}:`, error.message);
        continue;
      }
    }

    // Create attributes
    for (const attr of collection.attributes) {
      try {
        switch (attr.type) {
          case 'string':
            await databases.createStringAttribute(
              DATABASE_ID,
              collection.id,
              attr.key,
              attr.size!,
              attr.required
            );
            break;
          case 'integer':
            await databases.createIntegerAttribute(
              DATABASE_ID,
              collection.id,
              attr.key,
              attr.required
            );
            break;
          case 'boolean':
            await databases.createBooleanAttribute(
              DATABASE_ID,
              collection.id,
              attr.key,
              attr.required
            );
            break;
          case 'datetime':
            await databases.createDatetimeAttribute(
              DATABASE_ID,
              collection.id,
              attr.key,
              attr.required
            );
            break;
        }
        console.log(`  + Attribute: ${attr.key}`);
      } catch (error: any) {
        if (error.code === 409) {
          console.log(`  • Attribute exists: ${attr.key}`);
        } else {
          console.error(`  ✗ Error creating attribute ${attr.key}:`, error.message);
        }
      }
    }

    // Wait for attributes to be ready before creating indexes
    console.log('  ... waiting for attributes to sync');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Create indexes
    if (collection.indexes) {
      for (const index of collection.indexes) {
        try {
          await databases.createIndex(
            DATABASE_ID,
            collection.id,
            index.key,
            index.type as any,
            index.attributes
          );
          console.log(`  + Index: ${index.key}`);
        } catch (error: any) {
          if (error.code === 409) {
            console.log(`  • Index exists: ${index.key}`);
          } else {
            console.error(`  ✗ Error creating index ${index.key}:`, error.message);
          }
        }
      }
    }
  }

  console.log('\n✓ Setup complete!');
  console.log('\nNext steps:');
  console.log('1. Add these to your .env file:');
  console.log(`   APPWRITE_ENDPOINT=${endpoint}`);
  console.log(`   APPWRITE_PROJECT_ID=${projectId}`);
  console.log(`   APPWRITE_API_KEY=${apiKey}`);
  console.log('2. Initialize appwriteService in your app startup');
}

setup().catch(console.error);
