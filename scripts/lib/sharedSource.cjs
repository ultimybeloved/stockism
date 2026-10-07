'use strict';
// The roster files (src/characters.ts, src/crews.ts) are TypeScript, but the
// backend and these Node scripts run plain JavaScript. This strips the types:
//
//   generate(name)  -> the JS text written to functions/<name>.js by sync:chars
//   load(name)      -> the module's exports, for scripts that read the roster
//
// Types are only removed, never transformed, so the backend runs exactly the
// code the frontend does.

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..', '..');
const SHARED = ['characters', 'crews'];

const sourcePath = (name) => path.join(ROOT, 'src', `${name}.ts`);
const generatedPath = (name) => path.join(ROOT, 'functions', `${name}.js`);

const transpile = (name, module) =>
  ts.transpileModule(fs.readFileSync(sourcePath(name), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module, removeComments: false },
    fileName: `${name}.ts`,
  }).outputText;

const generate = (name) =>
  `// GENERATED from src/${name}.ts by \`npm run sync:chars\`. Do not edit.\n` + transpile(name, ts.ModuleKind.ESNext);

const load = (name) => {
  const m = new Module(sourcePath(name));
  m.filename = sourcePath(name);
  m.paths = Module._nodeModulePaths(path.dirname(sourcePath(name)));
  // crews.ts imports nothing local and characters.ts nothing at all; if that
  // changes, relative requires resolve from src/ through m.paths/filename.
  m._compile(transpile(name, ts.ModuleKind.CommonJS), sourcePath(name));
  return m.exports;
};

module.exports = { SHARED, sourcePath, generatedPath, generate, load };
