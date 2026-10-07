// Frontend lint config. Focus: catch real React hook bugs and dead code.
// Most stylistic rules are warnings so the build is never blocked.
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  // Build-time constants injected by vite `define` (see vite.config.js).
  globals: { __APP_VERSION__: 'readonly', __BUILD_TIME__: 'readonly' },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: { react: { version: 'detect' } },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  plugins: ['react', 'react-hooks'],
  ignorePatterns: ['dist', 'functions', 'scripts', 'node_modules', '*.config.js'],
  rules: {
    // PropTypes aren't used in this codebase.
    'react/prop-types': 'off',
    // These two are the high-value ones: rules-of-hooks catches real bugs.
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    // `_` is the convention for intentionally-ignored params/destructure slots.
    'no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_$',
        destructuredArrayIgnorePattern: '^_',
      },
    ],
    'no-empty': 'warn',
    'react/no-unescaped-entities': 'off',
  },
  // File-size limits from CLAUDE.md, enforced. Split the file rather than raise these.
  overrides: [
    {
      files: ['src/components/**/*.{js,jsx}'],
      excludedFiles: ['**/*.test.*'],
      rules: { 'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }] },
    },
    {
      files: ['src/pages/**/*.{js,jsx}'],
      excludedFiles: ['**/*.test.*'],
      rules: { 'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }] },
    },
    {
      files: ['src/hooks/**/*.{js,jsx}'],
      excludedFiles: ['**/*.test.*'],
      rules: { 'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }] },
    },
    {
      files: ['src/App.jsx'],
      rules: { 'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }] },
    },
    // Over their limit after the 2026-10 reformat. Warn-only until the frontend
    // restructure splits them (docs/MODERNIZATION.md). Remove entries as they're split.
    {
      files: [
        'src/App.jsx',
        'src/components/MarketIndex.jsx',
        'src/components/admin/UsersTab.jsx',
        'src/components/admin/WatchlistTab.jsx',
        'src/components/modals/AboutModal.jsx',
        'src/hooks/useTradeManagement.js',
        'src/pages/LeaderboardPage.jsx',
        'src/pages/StockPage.jsx',
      ],
      rules: { 'max-lines': 'warn' },
    },
  ],
};
