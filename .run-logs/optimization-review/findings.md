# Findings

## Inventory
- Repository contains a Python/FastAPI backend, storage services, OpenAI protocol adapters, tests, and a Next.js frontend under `web/`.
- Git status was clean at the start of review.

## Checks
- `uv run pytest` failed before test collection: pytest executable was not found.
- `npm run build` in `web/` succeeded, but output says type validation is skipped.
- Direct TypeScript check with `.\node_modules\.bin\tsc.exe --noEmit` fails in `src/components/image-lightbox.tsx` due React.TouchList vs DOM TouchList typing.
- `npm exec eslint -- .` reports 4 errors and 12 warnings.

## Backend Optimization Findings
- JSON/config/log saves mostly use direct `write_text`; image tasks already use temp-file replacement, so the safer pattern exists and can be reused.
- Database storage rewrites all rows with `session.query(model).delete()` before insert, which is simple but expensive and risky under concurrent writes.
- R2 object listing parses XML with string splits instead of XML parser.
- Several background threads swallow broad exceptions without structured logs, making production diagnosis harder.

## Frontend Optimization Findings
- Next config has `typescript.ignoreBuildErrors: true`; production build can pass while type errors exist.
- ESLint disables unused variables and explicit `any`, reducing signal.
- Package metadata still says `next-starter`; both `bun.lock` and `package-lock.json` are present while Docker copies `bun.lock` but runs `npm install`.
