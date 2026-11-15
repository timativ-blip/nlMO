import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { createMediaAuthorsHandler } from './handler.ts';
const apiKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
Deno.serve(createMediaAuthorsHandler({ apiKey, authorize: async token => {
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const profile = await admin.from('profiles').select('data').eq('id', data.user.id).maybeSingle();
  return profile.error ? null : profile.data?.data ?? null;
} }));
