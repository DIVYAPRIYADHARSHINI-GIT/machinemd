import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the FastAPI backend runs on :8000 and Vite proxies /api to it,
// so the browser always talks to one origin - exactly like the Vercel deployment.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY || 'http://127.0.0.1:8000', changeOrigin: true } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY || 'http://127.0.0.1:8000', changeOrigin: true } },
  },
  build: { chunkSizeWarningLimit: 1200 },
});
