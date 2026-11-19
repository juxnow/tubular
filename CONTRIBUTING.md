# Contributing to Tubular

Thanks for helping build Tubular. Start with the [README](README.md) and the
[engineering contract](AGENTS.md) to understand what the library does and how
its boundaries work.

## Branches and pull requests

Use a branch name that makes your work easy to find. `bplate/` is short for
boilerplate and is used for maintenance and project setup. Other prefixes can
take shape as the project needs them; there is no enforced naming scheme.

Give your pull request a clear title and enough context for someone else to
understand the change and its implications. The pull request template offers a
starting point, not a checklist. Mention compatibility changes, tradeoffs, or
unfinished work when they matter. GitHub already shows the branch and commits,
so there is no need to repeat them in the description.

If an issue tracker is connected later, its references should be derived from
the branch when possible rather than requested as duplicate information. There
is no tracker integration configured yet.

## Checks

Use Node.js 24 or newer and install the locked dependencies with `npm ci`. Before
opening or updating a pull request, run:

```sh
npm run check
```

This runs formatting and source checks, documentation and generated-contract
checks, typechecking, the build, tests, examples, and a packed-package consumer
check. GitHub Actions runs the same command for pull requests and for updates to
`mainframe`. The workflow reports its result; repository branch rules determine
whether a passing result is required to merge.
