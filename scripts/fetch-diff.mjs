/**
 * Puts the diff the agent should review into a file, and says which diff it is.
 *
 * On the first review of a pull request there is only one sensible answer: the
 * whole thing. On a later push there are two, and the difference decides whether
 * this bundle is worth keeping. Handing over the whole diff again invites the
 * agent to re-litigate code that was already reviewed - and every round it may
 * word an old objection slightly differently, so it reads as a new finding.
 * A pull request then never converges: fix, review, fix, review.
 *
 * So a push is reviewed as what it is - the commits since the last review
 * (`before...after` from the event) - while the checkout still holds the whole
 * pull request for context. `publish-report.mjs` drops anything that lands on
 * a line somebody has already commented on, as the second line of defence.
 *
 * Falls back to the full diff whenever the incremental one cannot be trusted:
 * a force-push leaves `before` unreachable, and a comment trigger has no
 * `before` at all - `/review` is how a human asks for the whole pull request
 * to be looked at again.
 *
 * The same parse that writes the diff also writes the list of paths the agent
 * has to open. The hunk is three lines of context; the file is what the change
 * means. Without that list, nothing downstream can tell a review that opened
 * the files from one that only read the hunks.
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { changedFilesFromDiff, formatChangedFiles } from './changed-files.mjs';

const api = process.env.GITHUB_API_URL || 'https://api.github.com';
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;
const diffFile = process.env.DIFF_FILE;
const token = process.env.GITHUB_TOKEN;

// A diff that does not fit in the model's context is worse than a shortened one
// that says it was shortened.
const LIMIT = 1024 * 1024;
const EMPTY_SHA = '0000000000000000000000000000000000000000';

async function diff(path) {
  const response = await fetch(`${api}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github.v3.diff',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) return null;
  return await response.text();
}

async function main() {
  if (!repository || !prNumber || !diffFile || !token) {
    console.error('::error::fetch-diff.mjs needs GITHUB_REPOSITORY, PR_NUMBER, DIFF_FILE and GITHUB_TOKEN.');
    process.exit(1);
  }

  const before = process.env.BEFORE_SHA || '';
  const after = process.env.AFTER_SHA || '';

  let text = null;
  let scope = '';

  if (before && after && before !== after && before !== EMPTY_SHA) {
    text = await diff(`/repos/${repository}/compare/${before}...${after}`);
    if (text === null) {
      // Force-pushed, or the commit was garbage collected: `before` no longer
      // describes anything this repository can reach.
      console.log(`No comparison between ${before.slice(0, 7)} and ${after.slice(0, 7)}; reviewing the whole pull request.`);
    } else if (text.trim() === '') {
      // A merge of the base branch, or a push that changed nothing under review.
      console.log('The new commits change no files; reviewing the whole pull request.');
      text = null;
    } else {
      scope = `the ${before.slice(0, 7)}..${after.slice(0, 7)} push - the commits added since the last review. Earlier commits in this pull request have already been reviewed.`;
    }
  }

  if (text === null) {
    text = await diff(`/repos/${repository}/pulls/${prNumber}`);
    if (text === null) {
      console.error(`::error::Could not fetch the diff of pull request #${prNumber}.`);
      process.exit(1);
    }
    scope = 'the whole pull request.';
  }

  if (text.length > LIMIT) {
    text = `${text.slice(0, LIMIT)}\n\n*** TRUNCATED at ${LIMIT} bytes. Review what is above and say in the report that the diff was cut. ***\n`;
  }

  writeFileSync(diffFile, text);
  console.log(`Diff: ${text.split('\n').length} lines, ${text.length} bytes - ${scope}`);

  const changedFile =
    (process.env.CHANGED_FILES ?? '').trim() || join(dirname(diffFile), 'changed-files.txt');
  const changed = changedFilesFromDiff(text);
  writeFileSync(changedFile, formatChangedFiles(changed));
  console.log(`Changed files to open: ${changed.length} (${changedFile})`);

  if (process.env.GITHUB_ENV) {
    appendFileSync(
      process.env.GITHUB_ENV,
      `DIFF_FILE=${diffFile}\nDIFF_SCOPE=${scope}\nCHANGED_FILES=${changedFile}\n`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
