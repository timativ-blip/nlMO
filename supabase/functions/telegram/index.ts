// Telegram webhook, notification bridge and signed Mini App authentication.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { createTelegramHandler } from './handler.ts';
const url = Deno.env.get('SUPABASE_URL')!;
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
Deno.serve(
  createTelegramHandler({
    admin: createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options),
    authClient: () => createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, options),
    token: Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '',
    supabaseUrl: url,
  }),
);
