import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.FRONTEND_PORT || '8443'),
    strictPort: false,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.FRONTEND_PORT || '8443'),
  },
  build: {
    sourcemap: false,
    minify: true,
    cssMinify: true,
  },
})
