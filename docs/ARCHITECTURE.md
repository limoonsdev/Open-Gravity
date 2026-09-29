# Architecture

```
 ┌──────────────── OpenGravity.exe (desktop/, Tauri 2, Rust) ────────────────┐
 │ splash · native window (dashboard) · tray · autostart · watchdog         │
 │ embedded core (gzip) ─► extracted once ─► `open-gravity start --desktop` │
 └──────────────────────────────────┬────────────────────────────────────────┘
                                    ▼
 Claude Code · Codex · Gemini CLI · Cursor · Cline · Continue · Copilot · Open WebUI · SDKs
        │ Anthropic     │ Responses    │ Gemini     │ OpenAI Chat    │ Ollama / Completions / FIM
        ▼               ▼              ▼            ▼                ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ server/        HTTP server · auth (API keys, CSRF, DNS rebinding, CSP)   │
 │                path normalisation (Azure, /api/v0, POST / sniffing)      │
 │                /v1/* inference · raw proxy (images, audio, rerank…)      │
 │                /admin/api/* · /ui/* Next.js dashboard (embedded, Brotli) │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ translate/     client request ──parse──► IRRequest                       │
 │ router/        resolve model ─► candidates (alias → combo → provider/…)  │
 │                budgets (quota.ts) ─► 429 before any upstream call        │
 │                token saver: trim ─► compact near the context window      │
 │                for each candidate × key (rotation, cooldowns, keys       │
 │                exhausted per rate-limit headers skipped):                │
 │                  same protocol? ─► passthrough body                      │
 │                  otherwise      ─► learned fixes · output clamp (modeldb) │
 │                                    · tool emulation ─► build from IR     │
 │                upstream SSE ──decode──► IREvents ──transforms──►         │
 │                  (tool-call parser, <think> tags, args repair)           │
 │                  ──encode──► client SSE / NDJSON                         │
 │                4xx "unsupported feature" ─► compat fix, retry, remember  │
 │                (commit to the client only after the first token, so an   │
 │                 early upstream error can still fall back)                │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ providers/     catalog (105 presets) · upstream HTTP (undici, proxy)     │
 │                free API hub · balances · local engine detection ·        │
 │                Antigravity desktop bridge                                │
 │ core/          config store (hot reload) · usage log · analytics ·       │
 │                client detection · model database (3,500+ models) ·      │
 │                pricing · logger                                          │
 └──────────────────────────────────────────────────────────────────────────┘
        │                  │                 │                 │
        ▼                  ▼                 ▼                 ▼
   OpenAI-compatible   Anthropic-compatible   Gemini       OpenAI Responses
   (OpenAI, OpenRouter, Groq, DeepSeek, Ollama, …)
```

## Intermediate representation

`src/translate/ir.ts` defines a protocol-neutral request (`IRRequest`: system, messages made of text / image / thinking / tool_call / tool_result parts, tools, sampling, reasoning, response format) and a stream of events (`IREvent`: start, text, thinking, thinking_signature, tool_start / tool_args / tool_end, usage, stop, error).

Each protocol module (`openai.ts`, `anthropic.ts`, `gemini.ts`, `responses.ts`) provides the functions below. Client-only protocols (`ollama.ts` for `/api/chat` and `/api/generate` with NDJSON streaming, `completions.ts` for legacy `/v1/completions`) only need the parse / encode / response side.

| Function | Direction |
|---|---|
| `parse…Request(body) → IRRequest` | client → IR |
| `build…Request(ir, opts) → body` | IR → upstream |
| `…StreamDecoder` | upstream SSE → IREvents |
| `…StreamEncoder` | IREvents → client SSE |
| `build…Response(IRResponse)` | IR → client JSON (non-streaming) |

Upstream calls are always streamed; non-streaming clients get the stream aggregated by `Aggregator`. With N protocols this needs 2N translators instead of N².

Notable protocol details handled:

- Anthropic: tool results first in user turns, tool-id sanitising, thinking only when signed history allows it, synthetic/unsigned thinking dropped before replay, prompt caching breakpoints, `max_tokens` defaults, temperature clamping.
- OpenAI: `max_completion_tokens` and `reasoning_effort` for reasoning models, `stream_options.include_usage` (hidden from clients that didn't ask for it, retried without it if rejected), Mistral 9-character tool ids, DeepSeek `reasoning_content` echo, OpenRouter unified `reasoning`.
- Gemini: JSON Schema → OpenAPI subset (refs, nullable unions, const, unsupported keywords), thought signatures cached per tool-call id (with the documented bypass value for foreign history), function responses matched by name, `thinkingLevel` vs `thinkingBudget`.
- Responses (Codex): instructions + developer messages, function / custom (freeform) / local-shell tool calls, reasoning summaries, full event sequence with `sequence_number`, `response.completed` usage.

## Tool-calling emulation and stream transforms

`translate/toolemu.ts` rewrites a request for a model without function calling: tool definitions go into the system prompt with the `<tool_call>{"name":…,"arguments":…}</tool_call>` protocol (the Hermes/Qwen convention), previous tool calls and results are rendered as text (`<tool_response name id>`), consecutive same-role turns are merged (local chat templates require alternation) and `<tool_response` is added as a stop sequence. On the way back, `ToolCallStreamParser` scans the text stream incrementally, holding back only a possible opener prefix, and turns `<tool_call>` blocks, Qwen3-Coder `<function=…>` XML, `<invoke>` blocks and fenced JSON into `tool_start / tool_args / tool_end` events, so clients receive ordinary native tool calls.

`translate/transforms.ts` runs on every translated stream: `ThinkTagExtractor` turns `<think>` text into thinking events, and `ToolArgsNormalizer` buffers each tool call's arguments, repairs them (`json-repair.ts`: trailing commas, single quotes, unquoted keys, code fences, truncation) and coerces them to the tool's JSON schema, and fixes the tool name (case, `functions.` prefix).

Emulation is used when the provider's tool mode is `emulate`, when the model database says the model has no tools, or when a learned compat fix says so.

## Self-healing compatibility

`router/compat.ts` reads 4xx error bodies (OpenAI, vLLM, Ollama, llama.cpp, TGI, pydantic `extra_forbidden`, Gemini `Unknown name`, Anthropic…) and maps them to a `CompatFix`: emulate tools, drop `tool_choice` / `parallel_tool_calls` / any named parameter, no `stream_options`, rename or cap `max_tokens` (including a cap derived from "maximum context length is N"), merge the system prompt, strip images, drop reasoning or `response_format`. The executor applies the fix, retries the same target immediately (up to 5 adaptive rounds, not counted against `maxAttempts`) and stores it per `provider::model` in `config.compat`. IR-level fixes are applied before building the upstream body; body-level fixes also apply to passthrough requests.

## Model database

`core/modeldb.ts` holds a compact table compiled from the MIT-licensed LiteLLM catalog (`scripts/update-models.ts` regenerates `src/data/models.json`, bundled in the executable; the app refreshes `~/.open-gravity/cache/modeldb.json` weekly). Lookups go by provider family then fuzzy name normalisation (dates, `-latest`, `-preview`, separators). It drives the output-token clamp, tool emulation decisions, cost estimates, the `cheapest` strategy, context windows in `/v1/models` and `/api/show`, and capability tags in the dashboard.

## Routing and resilience

`router/resolve.ts` turns a model string into ordered candidates. `router/executor.ts` tries them:

- keys are picked per provider (`round-robin` or `fill-first`), skipping keys paused by `router/health.ts`;
- 429 pauses a key for one model (honouring `Retry-After` / Gemini `retryDelay`), 401/402/403 pause the whole key, 5xx/timeouts pause key+model briefly;
- 4xx errors caused by an unsupported feature are fixed and retried on the same candidate (see above); other 4xx request errors skip to the next candidate;
- combo strategies: `fallback`, `round-robin`, `random`, `fastest` (EWMA of time to first token per target, unmeasured targets first so they get measured), `cheapest` (model database prices) and `race` (first two targets in parallel; the loser is aborted and recorded as cancelled, without cooldown);
- an optional exact-match response cache (`router/cache.ts`, LRU, keyed by a hash of the normalised IR) replays stored responses as events;
- up to `maxAttempts` attempts overall; if everything is paused, one last pass ignores cooldowns;
- output is buffered until the first content event (or 20 s), so errors at the start of a stream still fall back; afterwards SSE keep-alive pings protect long reasoning phases;
- client disconnects abort the upstream request.

## Autocomplete (FIM)

`translate/fim.ts` parses fill-in-the-middle requests from every client style (`/v1/completions` with `suffix`, Mistral `/v1/fim/completions`, DeepSeek `/beta/completions`, llama.cpp `/infill`, Ollama `/api/generate` with `suffix`) into `IRFim`. `nativeFimRoute` picks the provider's own FIM endpoint when it has one (Codestral, DeepSeek, Ollama, llama.cpp, `completions` engines) and a matching decoder; any other model gets an emulated FIM prompt on the chat API, and `FimCleaner` strips code fences and echoed prefix lines from the stream. A 404 on the native route is learned (`noNativeFim`) and the model falls back to emulation.

## Quotas and budgets

`router/quota.ts` keeps, per provider key (and model), the last rate-limit headers (`x-ratelimit-*` in OpenAI, Groq, Cerebras and generic forms, `anthropic-ratelimit-*`, `retry-after`); a key whose remaining requests or tokens reached 0 is skipped until its reset time, before a call fails. `LimitRule`s (scope global / provider / key / model / router key / client app, period minute → month on the local calendar, max requests / tokens / cost, block or warn) are evaluated against the usage log; blocking rules answer 429 with `Retry-After` before any upstream call, and 80 % / 100 % crossings raise alerts (dashboard + log). `providers/balance.ts` reads account balances where the provider exposes them (OpenRouter, DeepSeek, Moonshot, SiliconFlow, one-api), cached for 5 minutes.

## Token saver

`router/tokensaver.ts` works on the IR before it is sent. Stage 1 trims what agents resend on every turn: old tool outputs above a size (head and tail kept), duplicate outputs, JSON minification, whitespace, old images and reasoning. Stage 2 compacts: when the request reaches `compactAt` × the context window (model database, or learned from an overflow error), older turns are replaced by a digest (tool calls, files, requests) or a summary produced by a configured model through an internal loopback call (`router/internal.ts`), cached by content hash. The protected tail and the compaction cut move in steps of 8 messages so provider prompt caches keep hitting between steps; orphaned tool results are repaired. Savings (tokens, cost at the model's input price, actions) are recorded per request.

## Analytics

`core/analytics.ts` aggregates the usage log for a range: totals with latency / TTFT percentiles, output speed, prompt-cache ratio, fallbacks, emulated tools, auto-fixes and cache hits; time series; breakdowns by model, provider, key, client app (`core/clients.ts` recognises 30+ tools from headers and user agents), router key, endpoint and combo; status codes, top errors, a weekday × hour heatmap, savings, a month projection and a formula-safe CSV export.

## Dashboard

`dashboard/` is a Next.js (App Router) static export under `basePath: /ui`, React 19, Tailwind CSS v4 and lucide icons, with self-hosted fonts and provider logos (LobeHub icons, MIT). `scripts/build.mjs` collects `dashboard/out`, Brotli-compresses text assets and embeds them in the bundle; `server/assets.ts` serves them with ETags, immutable caching for hashed files and decompression for clients without Brotli. The dashboard talks only to `/admin/api/*` (JSON + an SSE stream of logs and finished requests). In development, `npm run dev:ui` proxies the API to a running router.

## Desktop app

`desktop/src-tauri` is a Tauri 2 app. `build.rs` embeds the gzip-compressed command-line executable (`OG_CORE_PAYLOAD`) and derives a content id; on start the app shows a splash screen, extracts the core once per id into its data folder, and either attaches to a router already answering `/health` on the configured port or starts `open-gravity start --desktop --no-open --parent-pid <pid>` (no console window on Windows) and waits for its `OG_READY <url>` line. The main window then loads `<url>/ui/`; only local URLs may load in it, other links open in the browser. A watchdog restarts the core if it dies (at most 5 times in 10 minutes), the tray menu shows the router address and opens the dashboard (in the app or the browser), restarts the router or quits, and the core watches the parent pid so it never outlives the app. On Windows the window is frameless with the native shadow (Windows 11 rounds the corners) and the dashboard draws its own window controls; on macOS the title bar is an overlay.

## Security

`server/security.ts`: Host header check against DNS rebinding when bound to loopback; API keys required for remote or cross-origin (browser) callers; admin API requires the `x-og-admin` header (not settable cross-origin without a preflight that is never granted) and same-origin; optional dashboard password (scrypt) with HMAC-signed session cookies.

## Packaging

`scripts/build.mjs` bundles everything (the dashboard export through esbuild `define`, built first if missing; the model database as JSON) into `build/open-gravity.cjs`. `scripts/build-exe.mjs` turns it into a Node.js SEA for each target: it downloads and verifies the official Node binary of the same version when cross-compiling, strips the Authenticode signature on Windows, brands the exe with `rcedit` on Windows hosts, injects the blob with `postject` and signs ad hoc on macOS. The executable for the build host also embeds a V8 code cache (faster cold start); cross-compiled targets use a portable blob.

`scripts/build-desktop.mjs` builds the core for the target, compresses it, runs `tauri build` (optionally with installers) and copies the single-file app to `release/OpenGravity-<target>[.exe]`. Windows builds use the MSVC toolchain so WebView2's loader is linked statically and the app stays one file.
