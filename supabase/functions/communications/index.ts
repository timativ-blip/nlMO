import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { createCommunicationsHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createCommunicationsHandler({
  admin,
  userClient: token => createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }),
  appOrigin: Deno.env.get('COMMUNICATIONS_APP_ORIGIN') ?? 'https://timativ-blip.github.io',
  media: { url: Deno.env.get('LIVEKIT_URL') ?? '', apiKey: Deno.env.get('LIVEKIT_API_KEY') ?? '', apiSecret: Deno.env.get('LIVEKIT_API_SECRET') ?? '' },
  hookSecret: async () => { const { data } = await admin.from('app_secrets').select('value').eq('key', 'hook_secret').maybeSingle(); return data?.value ?? ''; },
}));
