module.exports = {
  root: true,
  env: { node: true, es2021: true },
  parserOptions: { ecmaVersion: 2021 },
  rules: { 'no-undef': 'error', 'no-unused-vars': 'off' },
  // File-size limits from CLAUDE.md, enforced.
  overrides: [
    { files: ['services/**/*.js'], rules: { 'max-lines': ['error', 600] } },
    { files: ['index.js'], rules: { 'max-lines': ['error', 15] } },
  ],
};
