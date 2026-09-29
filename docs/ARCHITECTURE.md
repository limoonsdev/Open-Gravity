# Architecture

```
 Claude Code · Codex · Gemini CLI · OpenCode · Cursor · Cline · Aider · SDKs
        │ Anthropic        │ Responses       │ Gemini          │ OpenAI Chat
        ▼                  ▼                 ▼                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ server/        HTTP server · auth (API keys, CSRF, DNS rebinding)        │
 │                /v1/* inference endpoints · /admin/api/* · web panel      │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ translate/     client request ──parse──► IRRequest                       │
 │ router/        resolve model ─► candidates (alias → combo → provider/…)  │
 │                for each candidate × key (rotation, cooldowns):           │
 │                  same protocol? ─► passthrough body                      │
 │                  otherwise      ─► build upstream request from IR        │
 │                upstream SSE ──decode──► IREvents ──encode──► client SSE  │
 │                (commit to the client only after the first token, so an   │
 │                 early upstream error can still fall back)                │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ providers/     catalog (28 templates) · upstream HTTP (undici, proxy)    │
 │                Antigravity desktop bridge                                │
 │ core/          config store (hot reload) · usage log & analytics ·       │
 │                pricing · logger                                          │
 └──────────────────────────────────────────────────────────────────────────┘
        │                  │                 │                 │
        ▼                  ▼                 ▼                 ▼
   OpenAI-compatible   Anthropic-compatible   Gemini       OpenAI Responses
   (OpenAI, OpenRouter, Groq, DeepSeek, Ollama, …)
```

## Intermediate representation

`src/translate/ir.ts` defines a protocol-neutral request (`IRRequest`: system, messages made of text / image / thinking / tool_call / tool_result parts, tools, sampling, reasoning, response format) and a stream of events (`IREvent`: start, text, thinking, thinking_signature, tool_start / tool_args / tool_end, usage, stop, error).

Each protocol module (`openai.ts`, `anthropic.ts`, `gemini.ts`, `responses.ts`) provides:

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

## Routing and resilience

`router/resolve.ts` turns a model string into ordered candidates. `router/executor.ts` tries them:

- keys are picked per provider (`round-robin` or `fill-first`), skipping keys paused by `router/health.ts`;
- 429 pauses a key for one model (honouring `Retry-After` / Gemini `retryDelay`), 401/402/403 pause the whole key, 5xx/timeouts pause key+model briefly;
- 4xx request errors skip to the next candidate;
- up to `maxAttempts` attempts overall; if everything is paused, one last pass ignores cooldowns;
- output is buffered until the first content event (or 20 s), so errors at the start of a stream still fall back; afterwards SSE keep-alive pings protect long reasoning phases;
- client disconnects abort the upstream request.

## Security

`server/security.ts`: Host header check against DNS rebinding when bound to loopback; API keys required for remote or cross-origin (browser) callers; admin API requires the `x-og-admin` header (not settable cross-origin without a preflight that is never granted) and same-origin; optional dashboard password (scrypt) with HMAC-signed session cookies.

## Packaging

`scripts/build.mjs` bundles everything (the web panel is inlined through esbuild `define`) into `build/open-gravity.cjs`. `scripts/build-exe.mjs` turns it into a Node.js SEA for each target: it downloads and verifies the official Node binary of the same version when cross-compiling, strips the Authenticode signature on Windows, brands the exe with `rcedit` on Windows hosts, injects the blob with `postject` and signs ad hoc on macOS.
