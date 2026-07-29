# AI Free development instructions

## Workflow

- Define observable success criteria before changing product code.
- For every bug fix or behavior change, add or update the focused test first and confirm that it fails for the expected reason.
- Implement the smallest product change that makes the focused test pass.
- Run focused tests during iteration, then the full relevant test suite and build checks before completion.

## Design

- Keep modules focused and dependencies explicit.
- Extract functions when they isolate reusable behavior, remove meaningful duplication, or make testing simpler.
- Keep desktop and VS Code implementations synchronized when they share behavior.
- Prefer composition and small pure functions over broad classes or speculative abstractions.
- Use decorators or wrapper functions for repeated cross-cutting behavior such as retries, logging, caching, timing, validation, or authorization. Do not introduce them for one-off logic.
- Avoid unrelated refactors and compatibility layers that create maintenance debt.

## Verification

- Do not claim a fix without an automated test or a reproducible verification step.
- For UI changes, verify computed styles and inspect screenshots at representative desktop and narrow viewports.
- Keep generated packages, screenshots, archives, and local runtime data out of Git unless explicitly required for a release.
