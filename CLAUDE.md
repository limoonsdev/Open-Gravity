# Open Gravity: contributor notes

Universal local AI router (TypeScript, Node 20+, zero runtime deps besides `undici`). Ships as a Node.js SEA single executable, and as a Tauri desktop app (`desktop/`) that embeds that executable.

## Commands

- `npm run typecheck`: `tsc --noEmit` (strict)
- `npm test`: node:test suites in `test/` (run with tsx); end-to-end tests use mock upstreams from `test/mock-upstream.ts`
- `npm run dev`: run from sources with tsx
- `npm run build`: esbuild bundle to `build/open-gravity.cjs` (builds the dashboard first if `dashboard/out` is missing)
- `npm run build:ui` / `npm run dev:ui`: Next.js dashboard export / dev server
- `npm run exe` / `exe:win` / `exe:all`: single executables to `release/`
- `npm run smoke -- <exe>`: start an executable and check health, dashboard and admin API
- `npm run desktop` (`desktop:bundle` for installers): one-file desktop app to `release/OpenGravity-<target>`; `node scripts/smoke-desktop.mjs <app>` (under `xvfb-run` on Linux)

Run `npm run check` (typecheck + tests + build) before committing.

## Layout

- `src/translate/`: protocol-neutral IR (`ir.ts`) plus one module per protocol (`openai`, `anthropic`, `gemini`, `responses`) exposing parse / build / stream decoder / stream encoder / response builder; client-only protocols `ollama` and `completions`; FIM autocomplete (`fim.ts`); tool-calling emulation (`toolemu.ts`), stream transforms (`transforms.ts`: `<think>` tags, tool-args repair) and `json-repair.ts`. Add protocol behaviour here, never in the executor.
- `src/router/`: model resolution and combo strategies (`resolve.ts`), execution with fallback (`executor.ts`), self-healing compat fixes (`compat.ts`), response cache (`cache.ts`), key health and latency (`health.ts`), provider probe (`probe.ts`), rate-limit tracking and budgets (`quota.ts`), token saver and compaction (`tokensaver.ts`), internal loopback calls (`internal.ts`).
- `src/providers/`: provider catalog (105 presets, `{var}` URL templates), upstream URL/auth/body building, free API hub (`free.ts`), balances (`balance.ts`), local engine detection (`local.ts`), Antigravity bridge.
- `src/server/`: HTTP server, inference routes (`api.ts`), dashboard API (`admin.ts`), security.
- `src/core/`: config store, usage store, analytics (`analytics.ts`), client detection (`clients.ts`), model database (`modeldb.ts`, data in `src/data/models.json`, regenerate with `npx tsx scripts/update-models.ts`), pricing, logger, utils.
- `src/integrations/`: tool configuration writers and launchers.
- `dashboard/`: the dashboard (Next.js static export under `/ui`, React, Tailwind v4, lucide). Pages in `src/app/*/page.tsx`, shared UI in `src/components/ui.tsx`, API shapes in `src/lib/types.ts`. It only calls `/admin/api/*`; never use `dangerouslySetInnerHTML` with untrusted strings. Served from memory by `src/server/assets.ts`.
- `desktop/`: Tauri 2 app (`src-tauri/src/main.rs` window/tray/commands, `core.rs` payload extraction and router process, `splash/` startup screen). Windows builds must use MSVC so the app stays one file.

## Conventions

- Every new translation path gets a test in `test/router.test.ts` (end to end) or `test/translate.test.ts` (unit); tool emulation, compat fixes, strategies and the Ollama API are covered in `test/adaptive.test.ts`; quotas, analytics, free hub, balances, local detection and dashboard serving in `test/v3.test.ts`; token saver in `test/tokensaver.test.ts`; client paths and FIM in `test/clients.test.ts`.
- New compat detections in `router/compat.ts` need the real provider error text in a test (mock quirks live in `test/mock-upstream.ts`).
- Keep the executable dependency-free: anything added must bundle with esbuild into one CJS file.
- Secrets must never reach the browser: `admin.ts` returns masked keys only.
- Every new admin endpoint gets its type in `dashboard/src/lib/types.ts`; run `npm run build:ui` to typecheck the dashboard.
