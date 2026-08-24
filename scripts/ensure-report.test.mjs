import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
});
