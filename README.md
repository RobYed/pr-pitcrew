# PR Pitcrew

[![CI](https://github.com/RobYed/pr-pitcrew/actions/workflows/ci.yml/badge.svg)](https://github.com/RobYed/pr-pitcrew/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A pit crew for your pull requests. Several specialists, each with one job, all at once, and the car
leaves in better shape than it arrived.

Three of them ship today:

| Agent | Check | What it does |
| --- | --- | --- |
| `bug-review` | `Pitcrew / Bug Review` | Reads the diff, reports defects it can prove, as comments at the code. Fails the check from a severity you choose. |
| `security-review` | `Pitcrew / Security Review` | The same, for security defects. |
| `acceptance-test` | `Pitcrew / Acceptance Test` | Drives your deployed app in a browser, proves the linked issue's acceptance criteria, and uploads the video. |

They run on [OpenCode](https://opencode.ai) inside **your** runner, against **your**
OpenAI-compatible endpoint, with **your** key. No third-party service sits in between, and no model
is preselected: which model reads your code is a decision you make with your provider.

## Quickstart

One file in your repository. That is the whole installation.

```yaml
# .github/workflows/pitcrew-bug-review.yml
name: Bug Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write
  issues: write

concurrency:
  group: bug-review-${{ github.event.pull_request.number || github.event.issue.number }}-${{ github.event.comment.id || 'push' }}
  cancel-in-progress: true

jobs:
  bug-review:
    uses: RobYed/pr-pitcrew/.github/workflows/bug-review.yml@v1
    secrets:
      api-key: ${{ secrets.PITCREW_API_KEY }}
```

Then, under **Settings → Secrets and variables → Actions**:

| | |
| --- | --- |
| secret `PITCREW_API_KEY` | the key for your endpoint |
| variable `PITCREW_API_BASE_URL` | the endpoint, including the version segment: `https://api.example.com/v1` |
| variable `PITCREW_MODEL` | a model id that endpoint serves, e.g. `gpt-4o-mini` |

Open a pull request. There is no fourth step.

`examples/` has the same file for all three agents. Enable one, two or all three; none of them needs
the others.

## What you get

**Findings at the code, not in a wall of text.** Each finding becomes a comment on the line it is
about. Above them, one summary comment in a frame the package writes: heading, verdict, counts by
severity, scope, links. The shape of a comment tells a reader what happened before they read a word
of it.

**A check that can be red.** `PITCREW_FAIL_ON` decides the severity from which findings fail the
build; `high` by default, `never` to keep the agents advisory. A finding stays red until somebody
changes the line or resolves the thread. The next push cannot turn it green by not mentioning it
again.

**No repetition.** A push is reviewed as the commits it added, not as the whole pull request again,
and a finding is dropped when one of the package's own earlier comments already made that point
within two lines of it. Otherwise a pull request never converges: fix, review, fix, review.

**A record of the work.** Every run appends its own transcript to the run summary: one line per tool
call, its input behind a fold, and what the agent wrote. The verdict and the work are different
questions.

**Read-only by construction.** The two review agents have no shell, no `webfetch`, no `websearch`
and no sub-agents; they cannot read `/proc`, `/sys` or `.git/`; they may write only inside a
git-ignored run directory. That is not a promise made to the model in a prompt, it is a permission
profile that ships with this package, so a pull request cannot grant its own reviewer a shell even
by editing every file it can reach. See [`docs/threat-model.md`](docs/threat-model.md).

## Updating, and pinning

`@v1` is a moving tag: a fix here reaches you without you touching a file. If you would rather
decide when that happens, pin the commit instead and let Dependabot propose the bumps:

```yaml
uses: RobYed/pr-pitcrew/.github/workflows/bug-review.yml@a1b2c3d4...  # v1.0.0
```

Both are supported. `@v1` is the convenient one, a SHA is the deliberate one.

## The acceptance test

This one costs more than the other two: a container, a browser, up to half an hour, and real
operations against a real environment. So **it does not start itself**. It starts when somebody
requests a review from the account in `PITCREW_ACCEPTANCE_REVIEWER`, which is the same gesture a
human reviewer gets. Removing that reviewer and adding them back is how you ask for a second run.
`/acceptance` in a comment does the same.

It needs `PITCREW_TARGET_URL` (the deployed app), and takes credentials for it if it has a login. It
refuses to run in a public repository unless you switch that off knowingly: it has a shell, and in a
public repository anyone can write the pull request comments that reach it. See
[`examples/acceptance-test.yml`](examples/acceptance-test.yml) and
[`docs/threat-model.md`](docs/threat-model.md).

## Your project's rules are the review's rules

The agents read your repository's `AGENTS.md` (or `CLAUDE.md`) on their own, because the runtime
loads it, and the prompts tell them a rule written there outranks their general expectations about
how such code is usually written. Nothing has to be written down twice, and nothing drifts: it is
the same file your own coding agent reads.

For what belongs to one agent and is not a project rule, append to its prompt rather than forking
it - see [`docs/adding-an-agent.md`](docs/adding-an-agent.md).

## Documentation

| | |
| --- | --- |
| [`docs/how-it-works.md`](docs/how-it-works.md) | How a run is put together, and why each part is the way it is. Most of it is a bug somebody paid for. |
| [`docs/configuration.md`](docs/configuration.md) | Every secret, variable and input. |
| [`docs/threat-model.md`](docs/threat-model.md) | What this defends against, what it does not, and where your data goes. |
| [`docs/costs.md`](docs/costs.md) | What a run costs, and the knobs that make it cost less. |
| [`docs/adding-an-agent.md`](docs/adding-an-agent.md) | A fourth agent, from nothing to its first comment. |
| [`docs/adr/`](docs/adr/) | The decisions behind the shape of this package. |

## Requirements

- GitHub Actions, Linux runners. Node 20.10 or newer, which every current runner image and the
  Playwright container both have.
- An OpenAI-compatible endpoint and a key. Any provider: this package names no vendor, no host and
  no model.
- Nothing to install. There are no npm dependencies, on purpose.

## Where this came from

The three agents grew inside a private application repository, as a replacement for a hosted review
service whose model choice and billing were not visible from the outside. Everything project-specific
was removed for this package; the reasoning was kept, translated and rewritten. That repository is
still a consumer of this one.

This project is not affiliated with, endorsed by or connected to OpenCode, Microsoft (whose
Playwright image the acceptance test runs in), or any model provider. It runs on OpenCode; that is
the whole relationship.

## Licence

MIT. See [`LICENSE`](LICENSE).
