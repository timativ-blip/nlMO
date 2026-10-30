import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
// ?demo в адресе — посмотреть демонстрацию даже на рабочем сайте
const forceDemo = new URLSearchParams(location.search).has('demo');
export const AUTH_STORAGE_KEY = url ? `sb-${new URL(url).hostname.split('.')[0]}-auth-token` : '';

export const sb = url && key && !forceDemo ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY } }) : null;
export const BACKEND = !!sb;
export const FUNCTIONS_URL = url ? `${url}/functions/v1` : '';
