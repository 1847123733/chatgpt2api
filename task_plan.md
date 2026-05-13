# Reseller Settlement Billing Plan

## Goal
Replace manual reseller settlement entry with an automatic monthly billing list based on customer events in the selected period.

## Decisions
- Billing scope: events that happened during the selected month, not current account state.
- Categories:
  - package accounts: limited paid packages, priced by reseller `cost_per_user`.
  - trial accounts: 1-day/10-image trials, default 1 RMB per account, configurable.
  - unlimited accounts: priced by active days at default 2 RMB/day, configurable.
- Events to record: package creation, trial creation, unlimited creation, trial-to-paid conversion, package renewal, unlimited renewal.
- Confirming a settlement marks the selected period's included events as settled.

## Phases
- [complete] Inspect storage and existing reseller flows.
- [complete] Add backend billing event recording and settlement generation APIs.
- [complete] Update admin settlement UI to preview and confirm generated lists.
- [complete] Add focused tests and run verification.
