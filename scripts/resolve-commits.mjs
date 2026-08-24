#!/usr/bin/env node
/**
 * Writes the two commits a pull request can be identified by into GITHUB_OUTPUT:
 * the tip of its branch (`head-sha`) and the test merge commit GitHub keeps at
 * `refs/pull/N/merge` (`merge-sha`).
 *
 * Both are needed by the step that asks the deployment which commit it is
 * serving. A preview built by a `pull_request` workflow reports `GITHUB_SHA`,
 * and for that event `GITHUB_SHA` is the merge commit rather than the head - so
 * checking only the head would call every such deployment somebody else's.
 *
 * Looked up through the API rather than taken from the event, because on the
 * `/acceptance` comment trigger the payload carries neither: an `issue_comment`
 * event knows the issue, not the branch behind it.
 *
 * Failure here is a warning, not an error. Both values are optional downstream -
 * without them the deployment simply is not verified, which is the same place a
 * repository without TARGET_HEALTH_URL is in.
 *
 * Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER.
 */

import { appendFileSync } from 'node:fs';

const apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com';

const write = (headSha, mergeSha) => {
  console.log(`head ${headSha || '(unknown)'}, merge ${mergeSha || '(unknown)'}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `head-sha=${headSha}\nmerge-sha=${mergeSha}\n`);
  }
};

const response = await fetch(`${apiBase}/repos/${process.env.GITHUB_REPOSITORY}/pulls/${process.env.PR_NUMBER}`, {
  headers: {
    authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'pr-pitcrew-resolve-commits',
  },
});

if (!response.ok) {
  console.log(`::warning::Could not read the pull request (${response.status}); the deployed commit cannot be verified.`);
  write('', '');
} else {
  const pr = await response.json();
  // merge_commit_sha is absent while GitHub is still computing the test merge,
  // and on a conflicted pull request it stays absent. One candidate among
  // several, never a requirement.
  write(pr.head?.sha ?? '', pr.merge_commit_sha ?? '');
}
