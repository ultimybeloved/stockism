import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Build identity, baked in at build time. Without it a bug report can't be tied
// to a deploy and Sentry can't group errors by release: every error from every
// version lands in one undifferentiated pile.
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
const commitSha = (() => {
  // Vercel checks out without full git history in some configs, so prefer the
  // commit it hands us and fall back to git only for local builds.
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
})();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version}+${commitSha}`),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Vite 5's default browser list. Vite 7+ defaults to newer browsers
    // (Safari 16.4+), which would drop players on older iPhones.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
    rolldownOptions: {
      output: {
        // Vendor libs change only when we upgrade a dependency, so keeping them
        // in their own chunks lets returning players reuse the cached copies
        // across our frequent app deploys. Order matters: the @sentry check
        // must run before the react check (@sentry/react contains "react").
        codeSplitting: {
          groups: [
            {
              name(id) {
                if (!id.includes('node_modules')) return null;
                if (id.includes('firebase')) return 'vendor-firebase';
                if (id.includes('@sentry')) return 'vendor-sentry';
                if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
                return null;
              },
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    projects: [
      { extends: true, test: { name: 'frontend', include: ['src/**/*.test.{ts,tsx}'] } },
      {
        extends: true,
        test: {
          name: 'backend',
          include: ['functions/src/**/*.test.ts', 'scripts/**/*.test.js'],
          setupFiles: ['functions/test/setup.ts'],
        },
      },
    ],
  },
});
