import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const script = fileURLToPath(new URL('./ensure-coverage.mjs', import.meta.url));
const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ensure-coverage-'));
  dirs.push(dir);
  return dir;
};

const sessionWithReads = paths =>
  JSON.stringify({
    messages: [
      {
        info: { role: 'assistant' },
        parts: paths.map(filePath => ({
          type: 'tool',
          tool: 'read',
          state: { status: 'completed', input: { filePath } },
        })),
      },
    ],
  });

/**
 * A stand-in for the OpenCode CLI. It logs every invocation and answers
 * `session list` / `export` / `run` according to FAKE_MODE. After a continue
 * turn, the next export uses FAKE_SESSION_AFTER when that file exists, so a
 * test can show the agent opening the files it had skipped.
 */
const fakeOpencode = dir => {
  const bin = join(dir, 'opencode.mjs');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, args.join(' ') + '\\n');
const mode = process.env.FAKE_MODE;
if (args[0] === 'session' && args[1] === 'list') {
  if (mode === 'list-fails') process.exit(1);
  if (mode === 'empty') { process.stdout.write('[]'); process.exit(0); }
  process.stdout.write('[{"id":"ses_1","updated":2}]');
  process.exit(0);
}
if (args[0] === 'export') {
  if (mode === 'export-fails') process.exit(1);
  const after = process.env.FAKE_SESSION_AFTER;
  const first = process.env.FAKE_SESSION;
  const source = after && existsSync(process.env.FAKE_LOG) && readFileSync(process.env.FAKE_LOG, 'utf8').includes('run --continue')
    ? after
    : first;
  process.stdout.write(readFileSync(source, 'utf8'));
  process.exit(0);
}
if (args[0] === 'run') process.exit(0);
process.exit(0);
`,
    { mode: 0o755 },
  );
  return bin;
};

const run = (env, { dir }) => {
  const bin = fakeOpencode(dir);
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  const output = execFileSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENCODE_BIN: bin,
      FAKE_LOG: log,
      GITHUB_WORKSPACE: dir,
      ...env,
    },
  });
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8').split('\n').filter(Boolean)
    : [];
  return { output, calls };
};

describe('ensure-coverage', () => {
  it('writes an empty measurement when there is no list, and spends no turn', () => {
    const dir = tmp();
    const coverageFile = join(dir, 'coverage.json');
    const { output, calls } = run(
      { COVERAGE_FILE: coverageFile },
      { dir },
    );
    assert.deepEqual(calls, []);
    assert.equal(JSON.parse(readFileSync(coverageFile, 'utf8')).status, 'empty');
    assert.match(output, /nothing on the list/i);
  });

  it('requires nothing of a markdown-only list, and spends no turn', () => {
    const dir = tmp();
    const changed = join(dir, 'changed-files.txt');
    const coverageFile = join(dir, 'coverage.json');
    writeFileSync(changed, '');
    const { calls } = run(
      { CHANGED_FILES: changed, COVERAGE_FILE: coverageFile },
      { dir },
    );
    assert.deepEqual(calls, []);
    const coverage = JSON.parse(readFileSync(coverageFile, 'utf8'));
    assert.deepEqual(coverage.required, []);
    assert.equal(coverage.missing.length, 0);
  });

  it('records N of N when the session opened every listed file, and spends no extra turn', () => {
    const dir = tmp();
    const changed = join(dir, 'changed-files.txt');
    const coverageFile = join(dir, 'coverage.json');
    const exportFile = join(dir, 'session.json');
    writeFileSync(changed, 'src/a.ts\nsrc/b.ts\n');
    writeFileSync(exportFile, sessionWithReads(['src/a.ts', 'src/b.ts']));
    const { output, calls } = run(
      {
        CHANGED_FILES: changed,
        COVERAGE_FILE: coverageFile,
        SESSION_EXPORT: exportFile,
        ENSURE_COVERAGE_CONTINUE: '0',
      },
      { dir },
    );
    assert.deepEqual(
      calls.filter(call => call.startsWith('run')),
      [],
    );
    const coverage = JSON.parse(readFileSync(coverageFile, 'utf8'));
    assert.deepEqual(coverage.missing, []);
    assert.match(output, /2 of 2 changed files opened/);
  });

  it('names the missing files when the session opened fewer, and does not invent N of N', () => {
    const dir = tmp();
    const changed = join(dir, 'changed-files.txt');
    const coverageFile = join(dir, 'coverage.json');
    const exportFile = join(dir, 'session.json');
    writeFileSync(changed, 'src/a.ts\nsrc/b.ts\nsrc/c.ts\n');
    writeFileSync(exportFile, sessionWithReads(['src/a.ts']));
    const { output } = run(
      {
        CHANGED_FILES: changed,
        COVERAGE_FILE: coverageFile,
        SESSION_EXPORT: exportFile,
        ENSURE_COVERAGE_CONTINUE: '0',
      },
      { dir },
    );
    const coverage = JSON.parse(readFileSync(coverageFile, 'utf8'));
    assert.deepEqual(coverage.missing, ['src/b.ts', 'src/c.ts']);
    assert.match(output, /1 of 3 changed files opened/);
    assert.match(output, /src\/b\.ts/);
    assert.equal(output.includes('3 of 3'), false);
  });

  it('asks the same session to open the missing files, then publishes the second measurement', () => {
    const dir = tmp();
    const changed = join(dir, 'changed-files.txt');
    const coverageFile = join(dir, 'coverage.json');
    const first = join(dir, 'first.json');
    const after = join(dir, 'after.json');
    writeFileSync(changed, 'src/a.ts\nsrc/b.ts\n');
    writeFileSync(first, sessionWithReads(['src/a.ts']));
    writeFileSync(after, sessionWithReads(['src/a.ts', 'src/b.ts']));

    const { output, calls } = run(
      {
        CHANGED_FILES: changed,
        COVERAGE_FILE: coverageFile,
        FAKE_MODE: 'ok',
        FAKE_SESSION: first,
        FAKE_SESSION_AFTER: after,
      },
      { dir },
    );

    assert.ok(
      calls.some(call => call.startsWith('run --continue')),
      'the coverage turn was skipped for a shortfall the session could still fix',
    );
    // The prompt is one argument with newlines, so the file list is not on the
    // same log line as `run --continue`. The raw log still has it.
    assert.match(readFileSync(join(dir, 'calls.log'), 'utf8'), /src\/b\.ts/);
    const coverage = JSON.parse(readFileSync(coverageFile, 'utf8'));
    assert.deepEqual(coverage.missing, []);
    assert.match(output, /2 of 2 changed files opened/);
  });

  it('writes unknown, never N of N, when there is no session to read', () => {
    const dir = tmp();
    const changed = join(dir, 'changed-files.txt');
    const coverageFile = join(dir, 'coverage.json');
    writeFileSync(changed, 'src/a.ts\n');
    const { output, calls } = run(
      {
        CHANGED_FILES: changed,
        COVERAGE_FILE: coverageFile,
        FAKE_MODE: 'empty',
      },
      { dir },
    );
    assert.deepEqual(
      calls.filter(call => call.startsWith('run')),
      [],
    );
    const coverage = JSON.parse(readFileSync(coverageFile, 'utf8'));
    assert.equal(coverage.status, 'unknown');
    assert.equal(output.includes('1 of 1'), false);
    assert.match(output, /will not claim a number/);
  });
});
