import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

if (!process.env.SUPABASE_URL)              throw new Error('Missing SUPABASE_URL')
if (!process.env.SUPABASE_ANON_KEY)         throw new Error('Missing SUPABASE_ANON_KEY')
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

// Use ONLY to verify incoming JWTs from client requests
export const supabaseAuth = createClient<Database>(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

// Use for ALL server-side DB reads and writes — bypasses RLS intentionally
// NEVER send this client or key to any client
export const supabase = createClient<Database>(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
