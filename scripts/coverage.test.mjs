/**
 * Measuring which of the listed files a session actually opened.
 *
 * The comparison has to survive the three ways a path arrives from the runtime
 * — relative, absolute, through a symlink — and it must not invent `N of N`
 * from an unreadable export.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCoverageGate,
  coverageCaption,
  coverageFailReason,
  measureCoverage,
  openedPathsFromSession,
  repoPath,
  unknownCoverage,
  unreadLine,
} from './coverage.mjs';

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'coverage-'));
  dirs.push(dir);
  return dir;
};

const session = messages => ({ messages });
const assistant = parts => ({ info: { role: 'assistant' }, parts });
const tool = (name, input, status = 'completed') => ({
  type: 'tool',
  tool: name,
  state: { status, input },
});

describe('repoPath', () => {
  it('turns an absolute path under the workspace into a repo-relative one', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'app.ts'), 'export {}\n');
    assert.equal(repoPath(join(dir, 'app.ts'), dir), 'app.ts');
  });

  it('keeps a relative path relative', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'app.ts'), 'export {}\n');
    assert.equal(repoPath('app.ts', dir), 'app.ts');
    assert.equal(repoPath('./app.ts', dir), 'app.ts');
  });

  it('follows a symlink so both names count as the same file', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'real.ts'), 'export {}\n');
    symlinkSync(join(dir, 'src', 'real.ts'), join(dir, 'src', 'link.ts'));
    assert.equal(repoPath('src/link.ts', dir), 'src/real.ts');
    assert.equal(repoPath(join(dir, 'src', 'link.ts'), dir), 'src/real.ts');
  });
});

describe('openedPathsFromSession', () => {
  it('collects completed reads and ignores searches, failures and unfinished calls', () => {
    const paths = openedPathsFromSession(
      session([
        assistant([
          tool('read', { filePath: 'src/app.ts' }),
          tool('read', { path: 'src/other.ts' }),
          tool('grep', { filePath: 'src/app.ts', pattern: 'todo' }),
          tool('glob', { pattern: 'src/**' }),
          tool('read', { filePath: 'src/broken.ts' }, 'error'),
          tool('read', { filePath: 'src/pending.ts' }, 'pending'),
          { type: 'text', text: 'I have the full diff.' },
        ]),
      ]),
    );
    assert.deepEqual(paths, ['src/app.ts', 'src/other.ts']);
  });
});

describe('measureCoverage', () => {
  it('counts a relative read, an absolute read and a symlink read as the same file', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'real.ts'), 'export {}\n');
    symlinkSync(join(dir, 'src', 'real.ts'), join(dir, 'src', 'link.ts'));

    const relative = measureCoverage(['src/real.ts'], ['src/real.ts'], dir);
    const absolute = measureCoverage(['src/real.ts'], [join(dir, 'src', 'real.ts')], dir);
    const viaLink = measureCoverage(['src/real.ts'], ['src/link.ts'], dir);

    assert.deepEqual(relative.missing, []);
    assert.deepEqual(absolute.missing, []);
    assert.deepEqual(viaLink.missing, []);
    assert.equal(relative.opened.length, 1);
  });

  it('names the files that were not opened, in the paths the diff used', () => {
    const result = measureCoverage(['src/a.ts', 'src/b.ts', 'src/c.ts'], ['src/a.ts'], '/workspace');
    assert.deepEqual(result.missing, ['src/b.ts', 'src/c.ts']);
    assert.deepEqual(result.opened, ['src/a.ts']);
    assert.equal(coverageCaption(result), '1 of 3 changed files opened');
    assert.equal(unreadLine(result), '**Not opened:** `src/b.ts`, `src/c.ts`.');
  });

  it('requires nothing of an empty list', () => {
    const result = measureCoverage([], [], '/workspace');
    assert.equal(result.status, 'measured');
    assert.equal(coverageCaption(result), '');
    assert.equal(unreadLine(result), '');
  });
});

describe('unknown coverage', () => {
  it('never looks like N of N', () => {
    const coverage = unknownCoverage('the session export could not be read');
    assert.equal(coverageCaption(coverage), '');
    assert.equal(unreadLine(coverage), '');
    assert.equal(coverage.status, 'unknown');
  });
});

describe('applyCoverageGate', () => {
  const passed = { failed: false, mark: '✅', label: 'passed', reason: 'Nothing at or above `high`.', standing: [] };
  const shortfall = measureCoverage(['a.ts', 'b.ts'], ['a.ts'], '/workspace');

  it('leaves the gate alone when the repository switched the floor off', () => {
    assert.equal(applyCoverageGate(passed, shortfall, false).failed, false);
  });

  it('fails a measured shortfall when full coverage is required', () => {
    const gate = applyCoverageGate(passed, shortfall, true);
    assert.equal(gate.failed, true);
    assert.equal(gate.kind, 'coverage');
    assert.equal(gate.reason.includes('1 of 2'), true);
    assert.equal(gate.reason.includes('`b.ts`'), true);
  });

  it('does not fail an unknown measurement: a missing number is a warning, not a silent pass claimed as N of N', () => {
    const gate = applyCoverageGate(passed, unknownCoverage('unreadable export'), true);
    assert.equal(gate.failed, false);
  });

  it('does not overwrite a findings failure: that reason is the one a reader can act on', () => {
    const findings = { failed: true, kind: 'findings', mark: '❌', label: 'failed', reason: '1 finding at or above `high`.', standing: [] };
    const gate = applyCoverageGate(findings, shortfall, true);
    assert.equal(gate.kind, 'findings');
    assert.equal(gate.reason, findings.reason);
  });

  it('does not fail a markdown-only diff', () => {
    const empty = measureCoverage([], [], '/workspace');
    assert.equal(applyCoverageGate(passed, empty, true).failed, false);
  });
});

describe('coverageFailReason', () => {
  it('says the verdict is not evidence, and names the unread files', () => {
    const reason = coverageFailReason(measureCoverage(['a.ts', 'b.ts'], ['a.ts'], '/workspace'));
    assert.match(reason, /not evidence/);
    assert.match(reason, /`b.ts`/);
  });
});
