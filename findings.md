# Reseller Settlement Findings

- Existing settlements are generic records stored through `storage.load_settlements()` / `save_settlements()`.
- Current settlement UI manually asks for period, customer count, amount, status, notes.
- Reseller customer event points:
  - `api/reseller.py` creates customers.
  - `api/reseller.py` converts trials to paid.
  - `api/reseller.py` updates customers and handles `renew_days`.
- Storage backends store settlement rows as arbitrary JSON dicts, so adding fields to settlement records is low risk.
- No dedicated event table exists. Billing events can be appended as settlement-like records with `record_type: "billing_event"` unless a new storage interface is added.
- Implemented settlement records with `record_type: "settlement"` and kept legacy records visible by treating missing `record_type` as settlement.
- Package billing stores the reseller customer unit price on the event at the time of create/renew/convert.
- Trial and unlimited rates are applied at preview/confirmation time so admins can configure them per settlement run.
