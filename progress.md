# Reseller Settlement Progress

- Read existing settlement UI, reseller admin UI, settlement API, storage backends, and customer mutation flows.
- User confirmed billing should use events that happened in the month.
- Created file-based plan.
- Added `services/reseller_billing_service.py` for billing events, settlement previews, and confirmation.
- Hooked reseller customer create/renew/convert flows into billing event recording.
- Reworked admin settlement UI to preview monthly billing events and confirm them as settled.
- Added backend guard against writing empty settlement records.
- Verification passed:
  - `.venv\Scripts\python.exe -m unittest test.test_account_image_capabilities.ResellerApiAuthTests`
  - `npm run build`
