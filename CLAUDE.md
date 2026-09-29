# Open Gravity: contributor notes

Universal local AI router (TypeScript, Node 20+, zero runtime deps besides `undici`). Ships as a Node.js SEA single executable.

## Commands

- `npm run typecheck`: `tsc --noEmit` (strict)
- `npm test`: node:test suites in `test/` (run with tsx); end-to-end tests use mock upstreams from `test/mock-upstream.ts`
- `npm run dev`: run from sources with tsx
- `npm run build`: esbuild bundle to `build/open-gravity.cjs`
- `npm run exe` / `exe:win` / `exe:all`: single executables to `release/`
- `npm run smoke -- <exe>`: start an executable and check health, dashboard and admin API

Run `npm run check` (typecheck + tests + build) before committing.

## Layout

- `src/translate/`: protocol-neutral IR (`ir.ts`) plus one module per protocol (`openai`, `anthropic`, `gemini`, `responses`) exposing parse / build / stream decoder / stream encoder / response builder; client-only protocols `ollama` and `completions`; tool-calling emulation (`toolemu.ts`), stream transforms (`transforms.ts`: `<think>` tags, tool-args repair) and `json-repair.ts`. Add protocol behaviour here, never in the executor.
- `src/router/`: model resolution and combo strategies (`resolve.ts`), execution with fallback (`executor.ts`), self-healing compat fixes (`compat.ts`), response cache (`cache.ts`), key health and latency (`health.ts`), provider probe (`probe.ts`).
- `src/providers/`: provider catalog (103 presets, `{var}` URL templates), upstream URL/auth/body building, Antigravity bridge.
- `src/server/`: HTTP server, inference routes (`api.ts`), dashboard API (`admin.ts`), security.
- `src/core/`: config store, usage store, model database (`modeldb.ts`, data in `src/data/models.json`, regenerate with `npx tsx scripts/update-models.ts`), pricing, logger, utils.
- `src/integrations/`: tool configuration writers and launchers.
- `src/web/index.html`: the whole dashboard (vanilla JS, no build step). Build DOM with `h()`; never inject untrusted strings with `innerHTML`.

## Conventions

- Every new translation path gets a test in `test/router.test.ts` (end to end) or `test/translate.test.ts` (unit); tool emulation, compat fixes, strategies and the Ollama API are covered in `test/adaptive.test.ts`.
- New compat detections in `router/compat.ts` need the real provider error text in a test (mock quirks live in `test/mock-upstream.ts`).
- Keep the executable dependency-free: anything added must bundle with esbuild into one CJS file.
- Secrets must never reach the browser: `admin.ts` returns masked keys only.
