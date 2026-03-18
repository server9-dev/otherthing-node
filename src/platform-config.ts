/**
 * Platform Configuration — hardcoded constants for the OtherThing platform.
 * Users should NOT need to configure any of these. Everything auto-detects.
 *
 * These are platform service credentials scoped by backend permissions.
 * Same pattern as Firebase/Supabase shipping their config with the client.
 */

export const PLATFORM = {
  // Appwrite backend (cloud profiles, workspace metadata)
  appwrite: {
    endpoint: 'https://sfo.cloud.appwrite.io/v1',
    projectId: '69855da10039ded42d2b',
    apiKey: 'standard_3bd7b4744dca16ff4534907a513c45262f507c0e6470c43c2620b592cad9fdd4956b22ce84391d52aad24cee97478d79717d9166a716d9454d5c9c6d0952b60ee0431e3592e6be68ef8b72a03e7ade902600cc0791ac9e9d7a6dc09d3ebd1a82299cd49ac313a9fdcfd658803da6d7b6a79ae24a8e010ca9f82566232cfa6fa5',
  },

  // GitHub OAuth (repo connection)
  github: {
    clientId: 'Ov23lio9LlRahc5rsi79',
    clientSecret: '432ad2e2d076ad0f6ff687e3e3807a4139f9f4a8',
  },

  // Groq — Whisper transcription (key loaded from env to satisfy GitHub push protection)
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
  },

  // Remote inference — premium tier hosted AI
  inference: {
    apiKey: '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',
    model: 'google/gemma-3-4b-it:free',
    dailyLimit: 100,
  },

  // Blockchain
  chain: {
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    network: 'sepolia' as const,
  },

  // API server
  server: {
    port: 8080,
    fallbackPort: 8081,
  },
} as const;
