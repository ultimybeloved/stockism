module.exports = {
  root: true,
  env: { node: true, es2021: true },
  parserOptions: { ecmaVersion: 2021 },
  rules: { 'no-undef': 'error', 'no-unused-vars': 'off' },
  // File-size limits from CLAUDE.md, enforced.
  overrides: [
    {
      files: ['services/**/*.js'],
      rules: { 'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }] },
    },
    { files: ['index.js'], rules: { 'max-lines': ['error', { max: 15, skipBlankLines: true, skipComments: true }] } },
  ],
};
