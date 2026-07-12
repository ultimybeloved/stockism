import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor libs change only when we upgrade a dependency, so keeping them
        // in their own chunks lets returning players reuse the cached copies
        // across our frequent app deploys. Order matters: the @sentry check
        // must run before the react check (@sentry/react contains "react").
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('firebase')) return 'vendor-firebase';
          if (id.includes('@sentry')) return 'vendor-sentry';
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
  },
});
