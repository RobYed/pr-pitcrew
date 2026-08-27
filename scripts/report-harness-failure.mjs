#!/usr/bin/env node
/**
 * Leaves a sentence on the pull request when a precondition failed before the
 * agent ever started.
 *
 * A browser that could not be proven and a deployment serving somebody else's
 * commit both end the job in seconds, which is the point of checking them. What
 * they used to end without is a word on the pull request: the check went red and
 * whoever asked for the walk-through had to open the run to find out why.
 *
 * So the failure becomes a report of its own - `attention`, no criteria, the
 * failure message as the summary - and publish-report.mjs renders it through the
 * frame every other run uses. The job still fails; it stops failing silently.
 *
 * Nothing here may fail the job further. The step that failed has already said
 * what is wrong, and a rescue that fails on top of it only hides that.
 *
 * Environment: AGENT, REPORT_FILE, HARNESS_FAILURE_FILE, plus what
 * publish-report.mjs needs (GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, RUN_URL).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAgent } from './build-config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const home = process.env.PITCREW_HOME || join(here, '..');
const reportFile = (process.env.REPORT_FILE ?? '').trim();

function sentence() {
  const file = (process.env.HARNESS_FAILURE_FILE ?? '').trim();
  const written = file && existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  return written || 'A precondition of this run failed before the agent started, so nothing was demonstrated.';
}

try {
  if (!reportFile) {
    console.log('::warning::REPORT_FILE is not set, so the failure cannot be published.');
    process.exit(0);
  }

  // Never over a report that exists. This step runs on failure, and a run can
  // fail after the agent has written down what it found.
  if (existsSync(reportFile)) {
    console.log(`${reportFile} already exists, so it is published as it is.`);
    process.exit(0);
  }

  const { manifest } = readAgent(home, process.env.AGENT || 'acceptance-test');

  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(
    reportFile,
    `${JSON.stringify({ verdict: 'attention', summary: sentence(), findings: [], criteria: [] }, null, 2)}\n`,
    'utf8',
  );

  execFileSync(process.execPath, [join(home, 'scripts', 'publish-report.mjs')], {
    stdio: 'inherit',
    env: {
      ...process.env,
      REVIEW_TITLE: manifest.title,
      REPORT_KIND: manifest.report,
      // The step that failed is the run's red check and names the cause. A gate
      // that fails a second time, for a different reason, only competes with it.
      PITCREW_FAIL_ON: 'never',
      PITCREW_REQUIRE_FULL_COVERAGE: 'false',
    },
  });
} catch (error) {
  console.log(`::warning::The harness failure could not be published: ${error.shortMessage ?? error.message}`);
}
