# Security

## Reporting a vulnerability

Open a private GitHub Security Advisory on this repository: **Security → Report a
vulnerability**. Do not open a public issue for anything that looks exploitable.

Include what you did, what happened, and which version was pinned. A workflow
file and a run link say more than a description.

Response is best effort. This is a side project maintained by one person; there
is no service-level promise and no on-call. If a report is serious and correct,
it gets a fix and an advisory. If it sits for a week, that is because nobody has
had an evening, not because it was ignored.

## Supported versions

| Version | Supported |
| --- | --- |
| latest `v1.x` | Yes |
| everything older | No |

Fixes land on `main` and go out as a new `v1.x` tag; the moving `v1` tag is
force-moved to it. A repository pinned to `v1` gets the fix without touching a
file. A repository pinned to an exact tag or a commit sha decides when to move,
and gets nothing until it does. Older tags are never patched in place.

## What this project defends against

The full picture is in [`docs/threat-model.md`](docs/threat-model.md). The
headline, stated plainly:

**What it defends against is the *content* a run reads - a diff, a pull request
body, a comment - not a change to the package or the workflow by somebody who
can already push.** The agent configuration, its permission profile and its
prompt come from this package at the ref you pinned, never from the repository
under review, so a pull request cannot grant its own reviewer a shell. A
collaborator who can push to your default branch can change the workflow
instead, and that is outside what any of this stops.

Runs are refused for pull requests from forks, including comment-triggered ones:
an `issue_comment` event always runs in the base repository with its secrets,
whatever pull request it names.

## Supply chain

Third-party actions are pinned to commit shas, and a test fails the build if one
is not. The OpenCode runtime is different, and worth knowing about: the wrapper
action installs it at run time with a `curl | bash` installer from
`opencode.ai`, into a process that holds the model key and the repository token.
The version is pinned (`opencode-version`, default in
[`actions/agent/action.yml`](actions/agent/action.yml)), so a new release cannot
arrive on its own - but a version is not a checksum, and the download still
comes from that host. If that is not acceptable in your environment, do not run
this.

The session transcript stays on your runner: OpenCode session sharing is
switched off on every run, so nothing is uploaded to opencode.ai. The diff does
leave, to the model provider you configured and to nobody else. What goes and
what does not is listed in
[`docs/threat-model.md`](docs/threat-model.md#where-your-data-goes).

## No affiliation

This project is not affiliated with, endorsed by or connected to OpenCode or
anomaly, Microsoft (whose Playwright image the acceptance test runs in), or any
model provider. It calls their software; that is the whole relationship.
