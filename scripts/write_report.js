/**
 * Submits the structured report this run publishes.
 *
 * The filename is the tool name (`write_report`). Arguments are JSON Schema
 * rather than Zod so this file has no package to install: OpenCode loads it
 * from `~/.config/opencode/tools/` (copied there by the composite action) and
 * accepts either form.
 *
 * It writes `REPORT_FILE` itself. The generic write/edit tools remain as a
 * fallback the recover step can still read; this is the call the prompts name.
 */

const finding = {
  type: 'object',
  additionalProperties: true,
  properties: {
    file: { type: 'string', description: 'Path relative to the repository root.' },
    line: { type: 'integer', description: 'Line in the new version of the file.' },
    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
    title: { type: 'string', description: 'Short, specific, no punctuation at the end.' },
    body: { type: 'string', description: 'What goes wrong, for which input, and how to fix it.' },
  },
  required: ['title', 'body'],
};

const criterion = {
  type: 'object',
  additionalProperties: true,
  properties: {
    title: { type: 'string', description: 'The criterion, as the issue words it.' },
    status: { type: 'string', enum: ['met', 'unmet', 'not-demonstrable'] },
    at: { type: 'string', description: 'Timestamp in the recording, mm:ss.' },
    evidence: { type: 'string', description: 'What you did and what the app showed.' },
  },
  required: ['title'],
};

export default {
  description:
    'Submit what this run publishes (verdict, summary, findings or criteria). Call it as soon as you have something, and again whenever it changes — the last call is the one that gets published. You MUST call it at least once before you reply, even when there is nothing to report: a reply without it is published as a failed review. Empty findings or criteria arrays are valid.',
  args: {
    verdict: {
      type: 'string',
      enum: ['pass', 'attention', 'fail'],
      description:
        'pass when nothing was found (or every criterion is met); attention for low/medium findings or undemonstrated criteria; fail when a finding is high or a criterion is unmet.',
    },
    summary: {
      type: 'string',
      description: 'One or two sentences shown above the inline comments.',
    },
    findings: {
      type: 'array',
      description: 'Defects, or an empty list. Used by bug and security review. Omit or leave empty for the acceptance test.',
      items: finding,
    },
    criteria: {
      type: 'array',
      description: 'Acceptance criteria, or an empty list. Used by the acceptance test. Omit or leave empty for a code review.',
      items: criterion,
    },
  },
  async execute(args) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { dirname } = await import('node:path');

    const target = (process.env.REPORT_FILE ?? '').trim();
    if (!target) {
      return 'REPORT_FILE is not set, so there is nowhere to write the report.';
    }

    const report = {
      verdict: args.verdict,
      summary: typeof args.summary === 'string' ? args.summary : '',
      findings: Array.isArray(args.findings) ? args.findings : [],
      criteria: Array.isArray(args.criteria) ? args.criteria : [],
    };

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return `Wrote the report to ${target}. Call this tool again if anything changes; reply when you are done.`;
  },
};
