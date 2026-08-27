import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'report-harness-failure.mjs');

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pitcrew-harness-'));
});

const run = extra => {
  const out = execFileSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT: 'acceptance-test',
      REPORT_FILE: join(dir, 'report.json'),
      GITHUB_TOKEN: 'token',
      GITHUB_REPOSITORY: 'owner/repo',
      PR_NUMBER: '7',
      RUN_URL: 'https://example.invalid/run',
      DRY_RUN: '1',
      ...extra,
    },
  });
  return { out, report: () => JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) };
};

describe('a precondition that failed before the agent started', () => {
  it('becomes a report the pull request can carry', () => {
    const message = join(dir, 'message.txt');
    writeFileSync(message, 'No Playwright driver in this image.\n');

    const { out, report } = run({ HARNESS_FAILURE_FILE: message });

    assert.deepEqual(report(), {
      verdict: 'attention',
      summary: 'No Playwright driver in this image.',
      findings: [],
      criteria: [],
    });
    // Through the frame every other run uses, not a shape of its own.
    assert.match(out, /Acceptance test/);
    assert.match(out, /No Playwright driver in this image\./);
  });

  it('says something even when the failing step left no sentence', () => {
    const { report } = run({});
    assert.equal(report().verdict, 'attention');
    assert.match(report().summary, /before the agent started/);
  });

  it('never writes over a report that already exists', () => {
    // This step runs on failure, and a run can fail after the agent has written
    // down what it found. That report is the one worth publishing.
    const existing = { verdict: 'fail', summary: 'The agent got this far.', findings: [], criteria: [] };
    writeFileSync(join(dir, 'report.json'), JSON.stringify(existing));

    run({ HARNESS_FAILURE_FILE: join(dir, 'nothing.txt') });

    assert.deepEqual(run({}).report(), existing);
  });
});
