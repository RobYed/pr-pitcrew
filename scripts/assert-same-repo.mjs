#!/usr/bin/env node
/**
 * Refuses to run when the pull request's head branch lives in another
 * repository - a fork.
 *
 * The `pull_request` trigger already withholds repository secrets from a fork's
 * pull request, and that is the boundary the whole design leans on. The comment
 * triggers punch a hole in it: an `issue_comment` event always runs in the base
 * repository, on its default branch, **with** secrets - no matter where the pull
 * request it refers to came from. A maintainer typing `/review` on a fork's pull
 * request would therefore hand a stranger's diff to an agent whose environment
 * holds the model key and a repository token.
 *
 * There is no way to express this in a workflow `if:`, because the
 * `issue_comment` payload carries no `head.repo`. So it is a step, and it runs
 * before anything reads the diff.
 *
 * Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, optionally
 * GITHUB_API_URL.
 */

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;
const apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com';

for (const [name, value] of Object.entries({ GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository, PR_NUMBER: prNumber })) {
  if (!value) {
    console.error(`::error::Environment variable ${name} is not set.`);
    process.exit(1);
  }
}

const response = await fetch(`${apiBase}/repos/${repository}/pulls/${prNumber}`, {
  headers: {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'pr-pitcrew-assert-same-repo',
  },
});

if (!response.ok) {
  console.error(`::error::Could not read pull request #${prNumber}: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const pr = await response.json();
const head = pr.head?.repo?.full_name;

// A deleted fork leaves head.repo null. Unknown origin is not the same as a
// known-good one.
if (!head || head !== repository) {
  console.error(
    `::error::The head branch of pull request #${prNumber} lives in ${head ?? 'a repository that no longer exists'}, not in ${repository}. ` +
      'This workflow runs with repository secrets and will not read a fork\'s changes. ' +
      'Review a fork\'s pull request by hand, or push its branch into this repository first.',
  );
  process.exit(1);
}

console.log(`Head branch is in ${head}. Continuing.`);
