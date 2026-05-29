// Frontend lint config. Focus: catch real React hook bugs and dead code.
// Most stylistic rules are warnings so the build is never blocked.
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
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
    'no-unused-vars': 'warn',
    'no-empty': 'warn',
    'react/no-unescaped-entities': 'off',
  },
};
