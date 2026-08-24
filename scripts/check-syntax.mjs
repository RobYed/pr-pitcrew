#!/usr/bin/env node
/**
 * Parses every script without running it, and every JSON file this package
 * ships as configuration.
 *
 * This is the whole of "lint" here, and deliberately so: the code runs inside a
 * composite action, which gets no install step, so a linter would have to be
 * fetched at run time into a job that holds the model key - or vendored. What a
 * linter would have caught that the tests do not is a syntax error in a file no
 * test imports, and that is exactly what this catches.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

let failed = 0;
let checked = 0;

for (const path of walk(root)) {
  const extension = extname(path);
  const relative = path.slice(root.length + 1);
  try {
    if (extension === '.mjs' || extension === '.js') {
      execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
      checked++;
    } else if (extension === '.json') {
      JSON.parse(readFileSync(path, 'utf8'));
      checked++;
    }
  } catch (error) {
    console.error(`${relative}: ${String(error.stderr ?? error.message).trim()}`);
    failed++;
  }
}

console.log(`${checked} files parse${failed ? `, ${failed} do not` : ''}.`);
process.exit(failed ? 1 : 0);
