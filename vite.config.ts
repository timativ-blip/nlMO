import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' — сайт работает из любой папки (GitHub Pages: https://<логин>.github.io/<репозиторий>/)
export default defineConfig({ base: './', plugins: [react()], server: { port: 5180 } });
