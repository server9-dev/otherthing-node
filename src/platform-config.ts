/**
 * Platform Configuration — hardcoded constants for the OtherThing platform.
 * Users should NOT need to configure any of these. Everything auto-detects.
 *
 * Nothing secret belongs in this file: it is compiled into every app build and
 * the repo is public. Secrets come from the environment (.env).
 */

export const PLATFORM = {
  // Supabase backend (self-hosted). Only the publishable key belongs here —
  // access is enforced by row-level security on the user's own session.
  supabase: {
    url: process.env.SUPABASE_URL || 'https://supabase.otherthing.ai',
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
  },

  // GitHub OAuth (repo connection)
  github: {
    clientId: 'Ov23lio9LlRahc5rsi79',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
  },

  // Groq — Whisper transcription (key loaded from env to satisfy GitHub push protection)
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
  },

  // Remote inference — premium tier hosted AI
  inference: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
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
