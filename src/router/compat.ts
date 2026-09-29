// Self-healing compatibility: when a provider rejects a request because of an
// unsupported feature or parameter, work out a fix from the error message,
// retry, and remember the fix for that provider + model.
import type { IRRequest, IRPart } from '../translate';
import type { UpstreamFormat } from '../translate';

export interface CompatFix {
  emulateTools?: boolean;
  mergeSystem?: boolean;
  stripImages?: boolean;
  noReasoning?: boolean;
  noResponseFormat?: boolean;
  noStreamOptions?: boolean;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  maxTokensCap?: number;
  /** Real context window reported by the provider (drives token-saver compaction). */
  contextWindow?: number;
  /** The provider's native completion endpoint failed: serve autocomplete through chat. */
  noNativeFim?: boolean;
  dropParams?: string[];
  /** Human-readable reasons, newest last. */
  reasons?: string[];
  learnedAt?: number;
}

export const compatKey = (providerId: string, model: string) => `${providerId}::${model}`;

/** Fixes that need the request rebuilt from the IR (no raw passthrough). */
export function needsTranslation(fix: CompatFix): boolean {
  return !!(fix.emulateTools || fix.mergeSystem || fix.stripImages || fix.noReasoning || fix.noResponseFormat || fix.contextWindow);
}

const PROTECTED = new Set(['model', 'messages', 'contents', 'input', 'prompt', 'stream', 'tools', 'functions', 'system', 'instructions', 'max_tokens']);

function camel(s: string) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export interface DetectContext {
  status: number;
  /** Raw error body text from the provider. */
  error: string;
  format: UpstreamFormat;
  current: CompatFix;
  hasTools: boolean;
  hasImages: boolean;
  hasSystem: boolean;
  hasReasoning: boolean;
  hasResponseFormat: boolean;
  requestedMaxTokens?: number;
  /** The token saver can compact the conversation (learn the context window). */
  canCompact?: boolean;
}

/** Context window size mentioned in a "prompt too long" error. */
export function contextWindowFrom(t: string): number | undefined {
  const pats = [
    /maximum context length is (\d{3,8})/,
    /(\d{3,8}) tokens? > (\d{3,8}) maximum/,
    /(?:available )?context (?:size|window|length)[^\d]{0,24}\(?(\d{3,8})\s*tokens?/,
    /maximum number of tokens allowed \((\d{3,8})\)/,
    /exceeds? (?:the )?(?:model'?s? )?(?:maximum )?(?:context|token) (?:length|limit|window)[^\d]{0,20}(?:of )?(\d{3,8})/,
  ];
  for (const re of pats) {
    const m = re.exec(t);
    if (m) {
      const n = Number(m[m.length - 1]);
      if (n >= 512) return n;
    }
  }
  return undefined;
}

export interface DetectedFix {
  fix: CompatFix;
  reason: string;
}

const NOT_SUPPORTED = String.raw`(not (supported|enabled|available|allowed|permitted)|unsupported|isn'?t supported|does not support|cannot be used|not recogni[sz]ed|unrecogni[sz]ed|invalid)`;

function numbersIn(s: string): number[] {
  return [...s.matchAll(/\b(\d{3,7})\b/g)].map((m) => Number(m[1]));
}

/** Inspect a 4xx error and propose a fix that is not already applied. */
export function detectCompatFix(c: DetectContext): DetectedFix | null {
  if (c.status < 400 || c.status >= 500) return null;
  const t = c.error.toLowerCase();
  const cur = c.current;
  const drop = (params: string[], reason: string): DetectedFix | null => {
    const fresh = params.filter((p) => p && !PROTECTED.has(p.split('.').pop()!) && !(cur.dropParams || []).includes(p));
    return fresh.length ? { fix: { dropParams: [...(cur.dropParams || []), ...fresh] }, reason } : null;
  };

  // --- tool calling
  if (c.hasTools && !cur.emulateTools) {
    if (/tool_choice/.test(t) && new RegExp(`tool_choice[^.]{0,80}${NOT_SUPPORTED}|${NOT_SUPPORTED}[^.]{0,40}tool_choice`).test(t) && !/tools? (are|is) not supported/.test(t)) {
      const d = drop(['tool_choice'], 'tool_choice not supported');
      if (d) return d;
    }
    if (/parallel_tool_calls/.test(t)) {
      const d = drop(['parallel_tool_calls'], 'parallel_tool_calls not supported');
      if (d) return d;
    }
    const toolsUnsupported =
      /does not support (tools|tool[ _-]?(use|calling|calls)|function[ _-]?calling|functions)/.test(t)
      || /no endpoints found that support tool use/.test(t)
      || new RegExp(String.raw`\b(tools?|tool[ _-]?(use|calling|calls)|function[ _-]?call(ing|s)?|functions)\b[^.]{0,80}` + NOT_SUPPORTED).test(t)
      || /(unrecognized|unknown|unexpected|extra)[^.]{0,40}\b(tools|functions)\b/.test(t)
      || /"tools"[^.]{0,40}(not allowed|not permitted)/.test(t);
    if (toolsUnsupported) return { fix: { emulateTools: true }, reason: 'native tool calling not supported: using emulated tools' };
  }

  // --- stream_options
  if (/stream_options/.test(t) && !cur.noStreamOptions) return { fix: { noStreamOptions: true }, reason: 'stream_options not supported' };

  // --- max tokens field name
  if (c.format === 'openai' || c.format === 'responses') {
    if (/max_tokens/.test(t) && /max_completion_tokens/.test(t) && cur.maxTokensField !== 'max_completion_tokens') {
      return { fix: { maxTokensField: 'max_completion_tokens' }, reason: 'model expects max_completion_tokens' };
    }
    if (/max_completion_tokens/.test(t) && new RegExp(`max_completion_tokens[^.]{0,60}${NOT_SUPPORTED}|extra inputs`).test(t) && cur.maxTokensField !== 'max_tokens') {
      return { fix: { maxTokensField: 'max_tokens' }, reason: 'model expects max_tokens' };
    }
  }

  // --- output limit too large / context overflow caused by the output budget
  const req = c.requestedMaxTokens || 0;
  const ctx = /maximum context length is (\d+)[\s\S]{0,160}?\((\d+) in the messages/.exec(t);
  if (req && ctx) {
    const cap = Number(ctx[1]) - Number(ctx[2]) - 64;
    if (cap >= 256 && cap < req && cap !== cur.maxTokensCap) return { fix: { maxTokensCap: cap }, reason: `output budget reduced to ${cap} tokens to fit the context window` };
  }
  const aboutOutput = /(max_tokens|max_completion_tokens|max_output_tokens|maxoutputtokens|num_predict|output tokens|completion tokens|max new tokens|max_new_tokens)/.test(t);
  const tooLarge = /(too large|too high|exceed|must be (less|at most|<=|smaller|between)|maximum|at most|larger than|greater than|out of range|up to|should be less|> ?\d)/.test(t);
  const contextOverflow = /(context (length|window)|prompt is too long|input is too long|too many (input )?tokens|input tokens exceed)/.test(t);
  if (req && aboutOutput && tooLarge && !contextOverflow) {
    const below = numbersIn(t).filter((n) => n >= 256 && n < req);
    const cap = below.length ? Math.max(...below) : Math.max(1024, Math.floor(req / 2));
    if (!cur.maxTokensCap || cap < cur.maxTokensCap) return { fix: { maxTokensCap: cap }, reason: `max output tokens capped at ${cap}` };
  }

  // --- the prompt itself is larger than the context window: learn it, the token saver compacts
  if (c.canCompact && contextOverflow || (c.canCompact && /context_length_exceeded|context length|context window|too many tokens|prompt is too long/.test(t))) {
    const win = contextWindowFrom(t);
    if (win && (!cur.contextWindow || win < cur.contextWindow)) return { fix: { contextWindow: win }, reason: `context window is ${win} tokens: compacting the conversation` };
  }

  // --- sampling parameters
  const sampling = new RegExp(String.raw`\b(temperature|top_p|top_k|presence_penalty|frequency_penalty|seed|logit_bias|repetition_penalty|min_p)\b[^.]{0,80}(${NOT_SUPPORTED}|only (the )?default|must be|cannot be|is not allowed)`).exec(t);
  if (sampling) {
    const params = sampling[1] === 'temperature' ? ['temperature', 'top_p', 'top_k'] : [sampling[1]];
    const mapped = c.format === 'gemini' ? params.map((p) => `generationConfig.${camel(p)}`) : params;
    const d = drop(mapped, `${sampling[1]} not supported`);
    if (d) return d;
  }

  // --- reasoning / thinking
  if (c.hasReasoning && !cur.noReasoning && new RegExp(String.raw`\b(reasoning_effort|reasoning|thinking|thinkingconfig|thinking_config|include_reasoning|budget_tokens)\b[^.]{0,80}(${NOT_SUPPORTED}|unknown|extra inputs|not a valid)`).test(t)) {
    return { fix: { noReasoning: true }, reason: 'reasoning parameters not supported' };
  }

  // --- system prompt
  if (c.hasSystem && !cur.mergeSystem && (
    new RegExp(String.raw`(system (message|prompt|role|instruction)s?|role[^.]{0,12}system|developer (message|role)s?|systeminstruction|system_instruction)[^.]{0,80}${NOT_SUPPORTED}`).test(t)
    || /does not support system/.test(t)
  )) return { fix: { mergeSystem: true }, reason: 'system messages not supported: merged into the first user message' };

  // --- images
  if (c.hasImages && !cur.stripImages && (
    new RegExp(String.raw`\b(image|images|vision|image_url|multimodal|multi-modal|inline_?data|input_image|image_content)\b[^.]{0,80}${NOT_SUPPORTED}`).test(t)
    || /does not support (image|vision|multimodal|multi-modal)/.test(t)
    || /(only (supports )?text|text-only|text only)/.test(t)
  )) return { fix: { stripImages: true }, reason: 'images not supported: replaced with a placeholder' };

  // --- structured output
  if (c.hasResponseFormat && !cur.noResponseFormat && new RegExp(String.raw`\b(response_format|json_schema|json_object|responseschema|response_schema|responsemimetype|response_mime_type|structured output)\b[^.]{0,80}${NOT_SUPPORTED}`).test(t)) {
    return { fix: { noResponseFormat: true }, reason: 'response_format not supported: using a JSON instruction' };
  }

  // --- generic unknown parameter
  const raw = c.error;
  const found: string[] = [];
  const unrecognized = /unrecognized request arguments? supplied:?\s*([\w.,\s]+)/i.exec(raw);
  if (unrecognized) found.push(...unrecognized[1].split(/[,\s]+/).filter(Boolean));
  for (const m of raw.matchAll(/unknown name\s+\\?"([\w]+)\\?"(?:\s+at\s+'([\w.]+)')?/gi)) {
    const loc = m[2] ? m[2].split('.').filter((x) => !/^\d+$/.test(x) && !/\[/.test(x)).map((x) => (c.format === 'gemini' ? camel(x) : x)).join('.') : '';
    found.push(loc ? `${loc}.${m[1]}` : m[1]);
  }
  for (const m of raw.matchAll(/"loc"\s*:\s*\[\s*"body"\s*,\s*"(\w+)"(?:\s*,\s*"(\w+)")?[^\]]*\][^}]*?"msg"\s*:\s*"extra (inputs|fields)/gi)) found.push(m[2] ? `${m[1]}.${m[2]}` : m[1]);
  for (const m of raw.matchAll(/(?:^|[\s"'`{])([\w.]+)["'`]?\s*:\s*extra (?:inputs|fields) (?:are )?not permitted/gi)) found.push(m[1]);
  for (const m of raw.matchAll(/(?:unknown|unsupported|unexpected|unrecognized|invalid) (?:field|parameter|argument|property|key)s?\s*:?\s*["'`]?([\w.]+)["'`]?/gi)) found.push(m[1]);
  for (const m of raw.matchAll(/["'`]([\w.]+)["'`] (?:is|are) not (?:permitted|allowed|supported)/gi)) found.push(m[1]);
  if (found.length) {
    const d = drop([...new Set(found)], `unsupported parameter${found.length > 1 ? 's' : ''}: ${[...new Set(found)].join(', ')}`);
    if (d) return d;
  }
  return null;
}

export function mergeFix(a: CompatFix, b: CompatFix, reason: string): CompatFix {
  return {
    ...a,
    ...b,
    dropParams: [...new Set([...(a.dropParams || []), ...(b.dropParams || [])])],
    reasons: [...(a.reasons || []), reason].slice(-10),
    learnedAt: Date.now(),
  };
}

// ------------------------------------------------------------------- apply

/** IR-level adjustments (tool emulation itself is applied by the executor). */
export function applyIrCompat(ir: IRRequest, fix: CompatFix): IRRequest {
  let out: IRRequest = ir;
  if (fix.stripImages) {
    const strip = (p: IRPart): IRPart[] => (p.type === 'image' ? [{ type: 'text', text: '[image omitted: this model does not accept images]' }] : [p]);
    out = {
      ...out,
      messages: out.messages.map((m) => ({
        role: m.role,
        parts: m.parts.flatMap((p) => (p.type === 'tool_result' ? [{ ...p, content: p.content.flatMap(strip) as any }] : strip(p))),
      })),
    };
  }
  if (fix.noReasoning) out = { ...out, reasoning: undefined };
  if (fix.noResponseFormat && out.responseFormat) {
    const schema = out.responseFormat.schema ? ` matching this JSON schema: ${JSON.stringify(out.responseFormat.schema)}` : '';
    out = { ...out, responseFormat: undefined, system: [out.system, `Respond only with valid JSON${schema}.`].filter(Boolean).join('\n\n') };
  }
  if (fix.mergeSystem && out.system) {
    const messages = [...out.messages];
    const first = messages.findIndex((m) => m.role === 'user');
    const prefix: IRPart = { type: 'text', text: `${out.system}\n\n` };
    if (first >= 0) messages[first] = { role: 'user', parts: [prefix, ...messages[first].parts] };
    else messages.unshift({ role: 'user', parts: [prefix] });
    out = { ...out, system: undefined, messages };
  }
  if (fix.maxTokensCap) out = { ...out, maxTokens: Math.min(out.maxTokens || fix.maxTokensCap, fix.maxTokensCap) };
  return out;
}

function deletePath(obj: any, path: string) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur?.[parts[i]];
    if (!cur || typeof cur !== 'object') return;
  }
  if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
}

const MAX_FIELDS = ['max_tokens', 'max_completion_tokens', 'max_output_tokens'];

/** Body-level adjustments, valid for translated and passthrough requests. */
export function applyBodyCompat(body: any, format: UpstreamFormat, fix: CompatFix): any {
  if (!body || typeof body !== 'object') return body;
  const out = { ...body };
  if (out.generationConfig) out.generationConfig = { ...out.generationConfig };
  for (const p of fix.dropParams || []) deletePath(out, p);
  if (fix.noStreamOptions) delete out.stream_options;
  if (format === 'openai' && fix.maxTokensField) {
    const other = fix.maxTokensField === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
    if (out[other] !== undefined && out[fix.maxTokensField] === undefined) {
      out[fix.maxTokensField] = out[other];
      delete out[other];
    }
  }
  if (fix.maxTokensCap) {
    for (const f of MAX_FIELDS) if (typeof out[f] === 'number' && out[f] > fix.maxTokensCap) out[f] = fix.maxTokensCap;
    if (out.generationConfig?.maxOutputTokens > fix.maxTokensCap) out.generationConfig.maxOutputTokens = fix.maxTokensCap;
    if (format === 'anthropic' && out.thinking?.budget_tokens >= out.max_tokens) out.thinking = { ...out.thinking, budget_tokens: Math.max(1024, Math.floor(out.max_tokens / 2)) };
  }
  return out;
}

export function irHasImages(ir: IRRequest): boolean {
  return ir.messages.some((m) => m.parts.some((p) => p.type === 'image' || (p.type === 'tool_result' && p.content.some((c) => c.type === 'image'))));
}
