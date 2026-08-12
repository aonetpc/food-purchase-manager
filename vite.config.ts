import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'recharts': ['recharts'],
          'xlsx': ['xlsx'],
          'lucide': ['lucide-react'],
          'supabase': ['@supabase/supabase-js'],
          'date-fns': ['date-fns'],
          'qrcode': ['qrcode.react'],
        },
      },
    },
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    tsconfigPaths(),
    viteCompression({
      verbose: false,
      algorithm: 'gzip',
      threshold: 10240,
      ext: '.gz',
    }),
    viteCompression({
      verbose: false,
      algorithm: 'brotliCompress',
      threshold: 10240,
      ext: '.br',
    }),
  ],
})
