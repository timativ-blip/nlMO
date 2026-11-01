import { createClient } from '@supabase/supabase-js';
import { createBackendTransport } from './backend-transport';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
const gateway = import.meta.env.VITE_SUPABASE_GATEWAY_URL as string | undefined;
// ?demo в адресе — посмотреть демонстрацию даже на рабочем сайте
const forceDemo = new URLSearchParams(location.search).has('demo');
export const AUTH_STORAGE_KEY = url ? `sb-${new URL(url).hostname.split('.')[0]}-auth-token` : '';
const transport = url ? createBackendTransport(url, gateway) : null;
export const backendUrl = (value: string) => transport?.route(value) ?? value;

export const sb = url && key && !forceDemo ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY }, global: { fetch: transport!.fetch } }) : null;
export const BACKEND = !!sb;
export const FUNCTIONS_URL = url ? backendUrl(`${url}/functions/v1`) : '';
