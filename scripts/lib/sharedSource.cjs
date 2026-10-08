'use strict';
// The roster files (src/characters.ts, src/crews.ts) are shared with the
// backend, which can only deploy what is inside functions/:
//
//   generate(name)  -> the copy sync:chars writes to functions/src/shared/<name>.ts:
//                      the source verbatim under a header, so the backend runs
//                      exactly the code the frontend does, types included
//   load(name)      -> the module's exports, for plain Node scripts that read the roster

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..', '..');
const SHARED = ['characters', 'crews'];

const sourcePath = (name) => path.join(ROOT, 'src', `${name}.ts`);
const generatedPath = (name) => path.join(ROOT, 'functions', 'src', 'shared', `${name}.ts`);

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

module.exports = { SHARED, sourcePath, generatedPath, generate, load };
