import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: [{ find: /^(\.\.\/|\.\/)lib\/supabase$/, replacement: fileURLToPath(new URL('./supabase-mock.ts', import.meta.url)) }] },
});
