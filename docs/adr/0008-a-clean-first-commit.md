# 8. A clean first commit, with the origin stated

Status: accepted, 2026-08-24

## Context

The code has a history worth reading: roughly forty commits, each fixing something that had cost a
run. Carrying it over would have meant `git filter-repo` on the source repository.

That repository is a private application. Its history contains the whole application - every file,
every commit message, in German, including work that has nothing to do with these agents. A
subtree extraction would have to be exact, and an extraction that is *nearly* exact publishes
something nobody meant to publish. The value on the other side of that risk is a commit log for a
package that has, at that point, no users.

## Decision

One clean initial commit. The origin is named in the README rather than reconstructed in the log.

The history that matters was not in the commit messages anyway. It is in the code comments and in the
documentation, which is where it was deliberately put: almost every rule in this package is followed
by the sentence explaining which bug produced it. That survived the move intact.

## Consequences

- `git log` starts at the first public commit. `git blame` on any line older than that points there.
- No commit in the public repository can leak anything from a private one.
- The German reasoning documents from the source repository were rewritten in English for
  [`docs/`](../), not translated line by line. Where the two ever disagree, this repository is the
  one that describes the code.
