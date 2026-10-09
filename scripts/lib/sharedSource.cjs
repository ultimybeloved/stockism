'use strict';
// Code the frontend and backend must run identically: the roster files
// (src/characters.ts, src/crews.ts) and every game-rule module in src/rules/.
// The backend can only deploy what is inside functions/, so each one is copied
// to the same relative place under functions/src/shared/ (src/rules/ladder.ts ->
// functions/src/shared/rules/ladder.ts). Relative imports between them keep
// working because the layout is the same on both sides.
//
//   generate(name)  -> the copy sync:chars writes: the source verbatim under a
//                      header, so the backend runs exactly the code the frontend
//                      does, types included
//   load(name)      -> the module's exports, for plain Node scripts that read the roster
//   staleCopies()   -> generated rule copies whose source no longer exists

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..', '..');
const RULES_DIR = path.join(ROOT, 'src', 'rules');
const RULES_COPY_DIR = path.join(ROOT, 'functions', 'src', 'shared', 'rules');

const ruleNames = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map((f) => `rules/${f.slice(0, -3)}`)
        .sort()
    : [];

const SHARED = ['characters', 'crews', ...ruleNames(RULES_DIR)];

const sourcePath = (name) => path.join(ROOT, 'src', `${name}.ts`);
const generatedPath = (name) => path.join(ROOT, 'functions', 'src', 'shared', `${name}.ts`);

const staleCopies = () => ruleNames(RULES_COPY_DIR).filter((name) => !SHARED.includes(name));

const transpile = (name, module) =>
  ts.transpileModule(fs.readFileSync(sourcePath(name), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module, removeComments: false },
    fileName: `${name}.ts`,
  }).outputText;

const generate = (name) =>
  `// GENERATED from src/${name}.ts by \`npm run sync:chars\`. Do not edit.\n` +
  fs.readFileSync(sourcePath(name), 'utf8');

const load = (name) => {
  const m = new Module(sourcePath(name));
  m.filename = sourcePath(name);
  m.paths = Module._nodeModulePaths(path.dirname(sourcePath(name)));
  // crews.ts imports nothing local and characters.ts nothing at all; if that
  // changes, relative requires resolve from src/ through m.paths/filename.
  m._compile(transpile(name, ts.ModuleKind.CommonJS), sourcePath(name));
  return m.exports;
};

module.exports = { SHARED, sourcePath, generatedPath, generate, load, staleCopies, RULES_COPY_DIR };
