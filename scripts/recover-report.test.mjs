import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  carve,
  carveAll,
  isReportPath,
  isUsableReport,
  recoverReport,
  writeReportFile,
} from './recover-report.mjs';
import writeReport from './write_report.js';

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-report-'));
  dirs.push(dir);
  return dir;
};

const session = messages => ({ messages });
const assistant = parts => ({ info: { role: 'assistant' }, parts });
const user = parts => ({ info: { role: 'user' }, parts });
const tool = (name, input, status = 'completed') => ({
  type: 'tool',
  tool: name,
  state: { status, input },
});

const report = {
  verdict: 'attention',
  summary: 'One reachable null on the loader.',
  findings: [
    {
      file: 'src/loader.ts',
      line: 12,
      severity: 'medium',
      title: 'Null check missing in the loader',
      body: 'An empty list throws.',
    },
  ],
};

describe('isUsableReport', () => {
  it('accepts an empty findings list: that is a clean review, not a missing one', () => {
    assert.equal(isUsableReport({ verdict: 'pass', summary: 'Nothing.', findings: [] }), true);
  });

  it('rejects an object with no verdict, even if it has findings', () => {
    assert.equal(isUsableReport({ summary: 'Looks off.', findings: report.findings }), false);
  });

  it('rejects the prompt example when it is not an object', () => {
    assert.equal(isUsableReport('{"verdict":"pass"}'), false);
    assert.equal(isUsableReport(null), false);
    assert.equal(isUsableReport([]), false);
  });
});

describe('isReportPath', () => {
  const target = '/home/runner/work/app/app/.pitcrew-run/report.json';

  it('matches the absolute path this run is waiting for', () => {
    assert.equal(isReportPath(target, target), true);
  });

  it('matches a relative path under the working directory', () => {
    assert.equal(isReportPath('.pitcrew-run/report.json', target), true);
  });

  it('does not treat some other scratch file as the report', () => {
    assert.equal(isReportPath('/home/runner/work/app/app/.pitcrew-run/notes.md', target), false);
    assert.equal(isReportPath('src/report.json', target), false);
  });
});

describe('carve', () => {
  it('takes the first complete object and leaves the trailing prose', () => {
    assert.deepEqual(JSON.parse(carve('before {"verdict":"pass","findings":[]} after')), {
      verdict: 'pass',
      findings: [],
    });
  });

  it('does not swallow a second object into the first', () => {
    const docs = carveAll('{"a":1} {"verdict":"fail","findings":[]}');
    assert.deepEqual(
      docs.map(d => JSON.parse(d)),
      [{ a: 1 }, { verdict: 'fail', findings: [] }],
    );
  });
});

describe('recoverReport', () => {
  const reportFile = '/tmp/.pitcrew-run/report.json';

  it('prefers a write_report call over JSON in the reply', () => {
    const found = recoverReport(
      session([
        assistant([
          { type: 'text', text: JSON.stringify({ verdict: 'fail', summary: 'stale', findings: [] }) },
          tool('write_report', report),
        ]),
      ]),
      reportFile,
    );
    assert.equal(found?.source, 'write_report');
    assert.equal(found?.report.summary, report.summary);
  });

  it('reads a write of the report file', () => {
    const found = recoverReport(
      session([
        assistant([
          tool('write', {
            filePath: reportFile,
            content: JSON.stringify(report),
          }),
        ]),
      ]),
      reportFile,
    );
    assert.equal(found?.source, 'write');
    assert.equal(found?.report.verdict, 'attention');
  });

  it('reads JSON the agent put in its reply when it never called a tool', () => {
    const found = recoverReport(
      session([
        assistant([{ type: 'text', text: `Done.\n\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`` }]),
      ]),
      reportFile,
    );
    assert.equal(found?.source, 'text');
    assert.equal(found?.report.findings.length, 1);
  });

  it('ignores JSON that is only in an earlier assistant message, not the last reply', () => {
    const found = recoverReport(
      session([
        assistant([{ type: 'text', text: JSON.stringify(report) }]),
        assistant([{ type: 'text', text: 'Nothing further.' }]),
      ]),
      reportFile,
    );
    assert.equal(found, null);
  });

  it('ignores a verdict-only object in the reply: that is not a submitted report', () => {
    const found = recoverReport(
      session([assistant([{ type: 'text', text: '{"verdict":"pass","findings":[]}' }])]),
      reportFile,
    );
    assert.equal(found, null);
  });

  it('ignores the worked example in the user prompt', () => {
    const found = recoverReport(
      session([
        user([{ type: 'text', text: JSON.stringify(report) }]),
        assistant([{ type: 'text', text: 'Nothing to report.' }]),
      ]),
      reportFile,
    );
    assert.equal(found, null);
  });

  it('does not publish a report the agent only echoed from the prompt', () => {
    const found = recoverReport(
      session([
        user([{ type: 'text', text: `Example:\n${JSON.stringify(report)}` }]),
        assistant([{ type: 'text', text: `Done.\n${JSON.stringify(report)}` }]),
      ]),
      reportFile,
    );
    assert.equal(found, null);
  });

  it('does not publish a report the agent only echoed from a file it read', () => {
    const echoed = { verdict: 'pass', summary: 'Clean.', findings: [] };
    const withOutput = session([
      assistant([
        {
          type: 'tool',
          tool: 'read',
          state: {
            status: 'completed',
            input: { filePath: 'src/fixture.json' },
            output: JSON.stringify(echoed, null, 2),
          },
        },
        { type: 'text', text: `I saw this:\n${JSON.stringify(echoed)}` },
      ]),
    ]);
    assert.equal(recoverReport(withOutput, reportFile), null);
  });

  it('does not publish a report that already sits in the reviewed diff', () => {
    const echoed = { verdict: 'pass', summary: 'Minted from the diff.', findings: [] };
    const found = recoverReport(
      session([assistant([{ type: 'text', text: JSON.stringify(echoed) }])]),
      reportFile,
      `some patch\n+${JSON.stringify(echoed)}\n`,
    );
    assert.equal(found, null);
  });

  it('still takes write_report when the same object also appears in the prompt', () => {
    const found = recoverReport(
      session([
        user([{ type: 'text', text: JSON.stringify(report) }]),
        assistant([tool('write_report', report)]),
      ]),
      reportFile,
    );
    assert.equal(found?.source, 'write_report');
  });

  it('skips a write_report call that failed', () => {
    const found = recoverReport(
      session([
        assistant([
          tool('write_report', report, 'error'),
          { type: 'text', text: 'I could not write the file.' },
        ]),
      ]),
      reportFile,
    );
    assert.equal(found, null);
  });

  it('takes the newest report when the agent called the tool twice', () => {
    const found = recoverReport(
      session([
        assistant([tool('write_report', { verdict: 'fail', summary: 'first', findings: [] })]),
        assistant([tool('write_report', { verdict: 'pass', summary: 'second', findings: [] })]),
      ]),
      reportFile,
    );
    assert.equal(found?.report.summary, 'second');
  });
});

describe('write_report tool', () => {
  it('writes REPORT_FILE from its arguments', async () => {
    const dir = tmp();
    const target = join(dir, 'report.json');
    const previous = process.env.REPORT_FILE;
    process.env.REPORT_FILE = target;
    try {
      const output = await writeReport.execute({
        verdict: 'pass',
        summary: 'Clean.',
        findings: [],
      });
      assert.ok(output.includes(target));
      assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), {
        verdict: 'pass',
        summary: 'Clean.',
        findings: [],
        criteria: [],
      });
    } finally {
      if (previous === undefined) delete process.env.REPORT_FILE;
      else process.env.REPORT_FILE = previous;
    }
  });
});

describe('writeReportFile', () => {
  it('creates the directory and pretty-prints the report', () => {
    const target = join(tmp(), 'nested', 'report.json');
    writeReportFile(target, { verdict: 'pass', extra: 'dropped' });
    assert.equal(
      readFileSync(target, 'utf8'),
      `${JSON.stringify({ verdict: 'pass', summary: '', findings: [], criteria: [] }, null, 2)}\n`,
    );
  });
});
