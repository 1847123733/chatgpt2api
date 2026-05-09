# Task Plan

## Goal
Review the current project and identify concrete optimization opportunities without changing source code unless requested.

## Phases
- [x] Inventory project structure and git status
- [x] Inspect backend architecture and risky code paths
- [x] Inspect frontend architecture and build/dependency hygiene
- [x] Run available tests/checks where practical
- [ ] Summarize prioritized optimization recommendations

## Notes
- Working tree was clean at start.
- Backend tests could not run because `pytest` is not declared/available.
- Frontend build passes, but TypeScript validation is disabled in Next config.
