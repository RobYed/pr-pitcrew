import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Resolved from this file, not from the cwd: `node --test` may be started from
// anywhere, and the script sits next to its test.
const script = fileURLToPath(new URL('./ensure-report.mjs', import.meta.url));
const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ensure-report-'));
  dirs.push(dir);
  return dir;
};

const report = {
  verdict: 'pass',
  summary: 'Nothing to report.',
  findings: [],
};

/**
 * A stand-in for the OpenCode CLI, so the tests below can ask what the script
 * *did* rather than what it printed. It logs every invocation, answers
 * `session list` and `export` according to FAKE_MODE, and - this is the point -
 * writes an empty pass whenever it is asked to `run`. That is what the real
 * runtime does with a `--continue` that has nothing to continue, and a test
 * that only checked the log would not notice the report appearing.
 */
const fakeOpencode = dir => {
  const bin = join(dir, 'opencode.mjs');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, args.join(' ') + '\\n');
const mode = process.env.FAKE_MODE;
if (args[0] === 'session' && args[1] === 'list') {
  if (mode === 'list-fails') process.exit(1);
  if (mode === 'empty') { process.stdout.write('[]'); process.exit(0); }
  if (mode === 'not-json') { process.stdout.write('not json at all'); process.exit(0); }
  if (mode === 'no-id') { process.stdout.write('[{"updated":2}]'); process.exit(0); }
  process.stdout.write('[{"id":"ses_1","updated":2}]');
  process.exit(0);
}
if (args[0] === 'export') {
  if (mode === 'export-fails') process.exit(1);
  process.stdout.write(JSON.stringify({ messages: [] }));
  process.exit(0);
}
if (args[0] === 'run') {
  writeFileSync(process.env.REPORT_FILE, JSON.stringify({ verdict: 'pass', summary: 'No defects found.', findings: [] }));
  process.exit(0);
}
process.exit(0);
`,
    { mode: 0o755 },
  );
  return bin;
};

/** Runs the script against the fake CLI and hands back its output and its call log. */
const runWithFakeCli = (mode, { dir, reportFile }) => {
  const bin = fakeOpencode(dir);
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');

  const output = execFileSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      REPORT_FILE: reportFile,
      OPENCODE_BIN: bin,
      FAKE_LOG: log,
      FAKE_MODE: mode,
      // Both cleared rather than merely unset: these tests exercise the CLI
      // path, and an ambient value for either would send them somewhere else.
      SESSION_EXPORT: '',
      ENSURE_REPORT_CONTINUE: '',
      RUNNER_TEMP: dir,
      MODEL: 'test-model',
    },
  });

  return { output, calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
};

/** `expect(actual).toMatchObject(expected)`: every key of `expected`, no more. */
const matchObject = (actual, expected) => {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual?.[key], value, `key ${key}`);
  }
};

describe('ensure-report', () => {
  it('writes REPORT_FILE from a session export and does not need a second model turn', () => {
    const dir = tmp();
    const reportFile = join(dir, 'report.json');
    const exportFile = join(dir, 'session.json');
    writeFileSync(
      exportFile,
      JSON.stringify({
        messages: [
          {
            info: { role: 'assistant' },
            parts: [{ type: 'text', text: `Here is the report:\n${JSON.stringify(report)}` }],
          },
        ],
      }),
    );

    const output = execFileSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        REPORT_FILE: reportFile,
        SESSION_EXPORT: exportFile,
        ENSURE_REPORT_CONTINUE: '0',
      },
    });

    assert.ok(output.includes('Recovered the report from the session (text)'));
    matchObject(JSON.parse(readFileSync(reportFile, 'utf8')), report);
  });

  it('leaves a missing report missing when the session has only prose', () => {
    const dir = tmp();
    const reportFile = join(dir, 'report.json');
    const exportFile = join(dir, 'session.json');
    writeFileSync(
      exportFile,
      JSON.stringify({
        messages: [
          {
            info: { role: 'assistant' },
            parts: [{ type: 'text', text: 'I reviewed the diff and found nothing.' }],
          },
        ],
      }),
    );

    const output = execFileSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        REPORT_FILE: reportFile,
        SESSION_EXPORT: exportFile,
        ENSURE_REPORT_CONTINUE: '0',
      },
    });

    assert.ok(output.includes('No usable report in the session'));
    assert.throws(() => readFileSync(reportFile));
  });

  // The bug this guard exists for: the agent step died before OpenCode had a
  // session, `--continue` opened a fresh one whose only instruction was to call
  // write_report, and the model obliged from an empty context. The pull request
  // then carried `verdict: pass`, `No defects found.` for a diff nobody read.
  for (const mode of ['empty', 'list-fails', 'not-json', 'no-id']) {
    it(`spends no model turn and invents no pass when the session list says ${mode}`, () => {
      const dir = tmp();
      const reportFile = join(dir, 'report.json');

      const { output, calls } = runWithFakeCli(mode, { dir, reportFile });

      assert.deepEqual(
        calls.filter(call => call.startsWith('run')),
        [],
        'the script asked a model for a report it could not have',
      );
      assert.equal(existsSync(reportFile), false);
      assert.ok(output.includes('This run is published as one that reviewed nothing.'));
    });
  }

  // The other half of the guard, and the reason it keys on the id rather than on
  // the export: a session that exists but cannot be read is still a session
  // holding a review, and asking it for the tool is what this script is for.
  it('still spends the turn when a session exists but its export cannot be read', () => {
    const dir = tmp();
    const reportFile = join(dir, 'report.json');

    const { calls } = runWithFakeCli('export-fails', { dir, reportFile });

    assert.ok(
      calls.some(call => call.startsWith('run --continue')),
      'the recovery turn was skipped for a session that was there all along',
    );
    matchObject(JSON.parse(readFileSync(reportFile, 'utf8')), { verdict: 'pass' });
  });
});
