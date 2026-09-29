// Approximate public list prices (USD per 1M tokens) used for cost estimates.
// Matched by regex against the upstream model id; first match wins.
// These are estimates only - providers change prices and some have free tiers.

interface Price { in: number; out: number; cacheRead?: number; cacheWrite?: number }

const TABLE: Array<[RegExp, Price]> = [
  [/claude-opus-4-5|claude-opus-4\.5|opus-4-5/i, { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  [/claude-(3-)?opus|opus-4/i, { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  [/claude.*haiku-4|haiku-4-5/i, { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
  [/claude-3-5-haiku|claude-3-haiku/i, { in: 0.8, out: 4, cacheRead: 0.08, cacheWrite: 1 }],
  [/claude.*sonnet|sonnet-4/i, { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  [/gpt-5-nano/i, { in: 0.05, out: 0.4, cacheRead: 0.005 }],
  [/gpt-5-mini/i, { in: 0.25, out: 2, cacheRead: 0.025 }],
  [/gpt-5/i, { in: 1.25, out: 10, cacheRead: 0.125 }],
  [/gpt-4\.1-nano/i, { in: 0.1, out: 0.4, cacheRead: 0.025 }],
  [/gpt-4\.1-mini/i, { in: 0.4, out: 1.6, cacheRead: 0.1 }],
  [/gpt-4\.1/i, { in: 2, out: 8, cacheRead: 0.5 }],
  [/gpt-4o-mini/i, { in: 0.15, out: 0.6, cacheRead: 0.075 }],
  [/gpt-4o/i, { in: 2.5, out: 10, cacheRead: 1.25 }],
  [/o4-mini|o3-mini/i, { in: 1.1, out: 4.4, cacheRead: 0.275 }],
  [/o3-pro/i, { in: 20, out: 80 }],
  [/(^|\/)o3/i, { in: 2, out: 8, cacheRead: 0.5 }],
  [/gpt-oss-120b/i, { in: 0.15, out: 0.6 }],
  [/gpt-oss-20b/i, { in: 0.075, out: 0.3 }],
  [/gemini-3.*pro/i, { in: 2, out: 12, cacheRead: 0.2 }],
  [/gemini-3.*flash/i, { in: 0.5, out: 3, cacheRead: 0.05 }],
  [/gemini-2\.5-pro/i, { in: 1.25, out: 10, cacheRead: 0.125 }],
  [/gemini-2\.5-flash-lite/i, { in: 0.1, out: 0.4, cacheRead: 0.01 }],
  [/gemini-2\.5-flash/i, { in: 0.3, out: 2.5, cacheRead: 0.03 }],
  [/gemini-2\.0-flash/i, { in: 0.1, out: 0.4 }],
  [/deepseek/i, { in: 0.28, out: 0.42, cacheRead: 0.028 }],
  [/grok-code-fast/i, { in: 0.2, out: 1.5, cacheRead: 0.02 }],
  [/grok-4/i, { in: 3, out: 15, cacheRead: 0.75 }],
  [/grok-3-mini/i, { in: 0.3, out: 0.5 }],
  [/glm-4\.[56]-air/i, { in: 0.2, out: 1.1 }],
  [/glm-4\.[56]/i, { in: 0.6, out: 2.2, cacheRead: 0.11 }],
  [/kimi-k2/i, { in: 0.6, out: 2.5, cacheRead: 0.15 }],
  [/minimax-m2/i, { in: 0.3, out: 1.2 }],
  [/qwen3?-coder-plus/i, { in: 1, out: 5 }],
  [/qwen3?-coder/i, { in: 0.4, out: 1.6 }],
  [/llama-3\.3-70b/i, { in: 0.59, out: 0.79 }],
  [/llama-3\.1-8b/i, { in: 0.05, out: 0.08 }],
  [/mistral-large/i, { in: 2, out: 6 }],
  [/mistral-medium/i, { in: 0.4, out: 2 }],
  [/mistral-small/i, { in: 0.1, out: 0.3 }],
  [/codestral/i, { in: 0.3, out: 0.9 }],
  [/devstral/i, { in: 0.4, out: 2 }],
  [/sonar-pro/i, { in: 3, out: 15 }],
  [/sonar/i, { in: 1, out: 1 }],
];

export function priceFor(model: string): Price | undefined {
  for (const [re, p] of TABLE) if (re.test(model)) return p;
  return undefined;
}

export function estimateCost(model: string, u: { input: number; output: number; cacheRead?: number; cacheWrite?: number }, local = false): number {
  if (local) return 0;
  const p = priceFor(model);
  if (!p) return 0;
  const cost = (u.input * p.in + u.output * p.out + (u.cacheRead || 0) * (p.cacheRead ?? p.in) + (u.cacheWrite || 0) * (p.cacheWrite ?? p.in)) / 1e6;
  return Math.round(cost * 1e6) / 1e6;
}
