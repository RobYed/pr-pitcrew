# 6. Agents write in English by default, and the operator can override it

Status: accepted, 2026-08-24

## Context

The agents were originally told to answer in the language the reviewed repository uses. That is the
friendlier default, and it was changed for a concrete reason: **the frame around the agent's text is
English on every run.**

A summary comment is a heading, a verdict, counts by severity, a scope line and a set of links, all
written by this package in English, with one paragraph of the agent's own prose in the middle. A
German sentence inside an English frame does not read as localisation; it reads as a mistake. The
same applies to a criteria table whose headers are English and whose cells are not.

There is also a second, quieter argument. A repository's documentation language and the language its
pull requests are discussed in are not always the same, and "the language this repository uses" is
not a fact an agent can determine reliably from a diff.

## Decision

**English is the default**, stated in each prompt and applied to the reply, the summary, finding
titles and bodies, and criteria evidence.

**`PITCREW_OUTPUT_LANGUAGE` overrides it.** It reaches the prompt as the `$OUTPUT_LANGUAGE`
placeholder, which the harness substitutes before the agent sees the text - the review agents have no
shell and cannot resolve an environment variable themselves.

The frame stays English either way. Translating it would mean translating verdict labels, severity
labels, gate messages and the "no report" wording, and keeping those in step with the prompts in
every language. That is a real feature and not a variable.

## Consequences

- A German team sets one repository variable and gets German findings inside an English frame. That
  is a deliberate mix, and better than the alternative of a mixed-language *sentence*.
- Full localisation of the frame is not offered and is not planned.
- The default is the one that suits an open-source package, not the one that suits the repository
  this code came from - which now sets the variable.
