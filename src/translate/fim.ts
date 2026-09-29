// Fill-in-the-middle / raw completions for IDE autocomplete (Continue, Twinny,
// llama.vscode, Tabby...). Clients: /v1/completions (+suffix), Mistral
// /v1/fim/completions, DeepSeek /beta/completions, Ollama /api/generate (+suffix).
//
// Upstream, providers with a native completion endpoint get the prefix/suffix
// as-is (Mistral & Codestral FIM, DeepSeek beta, Ollama and local engines'
// /v1/completions, llama.cpp /infill). Everyone else gets a chat prompt and the
// answer is cleaned (code fences, echoed context) on the fly.
import type { IRRequest, IREvent, IRStop, StreamDecoder } from './ir';
import type { StreamTransform } from './transforms';

export interface IRFim {
  prefix: string;
  suffix: string;
  /** infill = insert between prefix and suffix; complete = continue the prefix. */
  mode: 'infill' | 'complete';
}

/** Mistral-style FIM request body (also used by Codestral clients). */
export function parseFimRequest(body: any): IRRequest {
  const prefix = String(body.prompt ?? '');
  const suffix = String(body.suffix ?? '');
  return fimRequest(body, prefix, suffix, 'infill');
}

export function fimRequest(body: any, prefix: string, suffix: string, mode: IRFim['mode']): IRRequest {
  const stop = typeof body.stop === 'string' ? [body.stop] : Array.isArray(body.stop) ? body.stop.filter((s: any) => typeof s === 'string') : undefined;
  return {
    model: body.model || '',
    messages: [{ role: 'user', parts: [{ type: 'text', text: suffix ? `${prefix}<CURSOR>${suffix}` : prefix }] }],
    maxTokens: body.max_tokens ?? body.num_predict ?? body.options?.num_predict ?? undefined,
    temperature: body.temperature ?? body.options?.temperature ?? undefined,
    topP: body.top_p ?? body.options?.top_p ?? undefined,
    stop,
    stream: !!body.stream,
    includeUsage: !!body.stream_options?.include_usage,
    fim: { prefix, suffix, mode },
  };
}

// ---------------------------------------------------------------- upstream

export type FimRoute = 'mistral' | 'deepseek' | 'completions' | 'completions-suffix' | 'infill';

const COMPLETIONS_ENGINES = new Set([
  'vllm', 'sglang', 'lmstudio', 'localai', 'koboldcpp', 'textgen-webui', 'llamafile', 'xinference', 'tgi', 'jan', 'gpt4all', 'mlx', 'lemonade',
  'together', 'fireworks', 'deepinfra', 'litellm', 'docker-model-runner',
]);

/** Native endpoint a provider offers for this FIM request, if any. */
export function nativeFimRoute(type: string, format: string, fim: IRFim, override?: FimRoute | 'none'): FimRoute | undefined {
  if (override) return override === 'none' ? undefined : override;
  if (format !== 'openai') return undefined;
  if (type === 'mistral' || type === 'codestral') return 'mistral';
  if (type === 'deepseek') return 'deepseek';
  if (type === 'ollama') return 'completions-suffix';
  if (type === 'llamacpp') return fim.mode === 'infill' ? 'infill' : 'completions';
  if (fim.mode === 'complete' && COMPLETIONS_ENGINES.has(type)) return 'completions';
  return undefined;
}

export function nativeFimRequest(route: FimRoute, baseUrl: string, model: string, ir: IRRequest): { url: string; body: any } {
  const fim = ir.fim!;
  const base = baseUrl.replace(/\/+$/, '');
  const root = base.replace(/\/v\d+$/, '');
  const common = { model, max_tokens: ir.maxTokens ?? 256, temperature: ir.temperature, top_p: ir.topP, stop: ir.stop, stream: true };
  switch (route) {
    case 'mistral':
      return { url: `${base}/fim/completions`, body: { ...common, prompt: fim.prefix, suffix: fim.suffix || undefined } };
    case 'deepseek':
      return { url: `${root}/beta/completions`, body: { ...common, prompt: fim.prefix, suffix: fim.suffix || undefined } };
    case 'completions-suffix':
      return { url: `${base}/completions`, body: { ...common, prompt: fim.prefix, suffix: fim.suffix || undefined } };
    case 'completions':
      return { url: `${base}/completions`, body: { ...common, prompt: fim.prefix } };
    case 'infill':
      return {
        url: `${root}/infill`,
        body: { input_prefix: fim.prefix, input_suffix: fim.suffix, n_predict: ir.maxTokens ?? 256, temperature: ir.temperature, top_p: ir.topP, stop: ir.stop, stream: true },
      };
  }
}

/** Decoder for the upstream response of a native route. */
export function fimDecoderFor(route: FimRoute): StreamDecoder | undefined {
  if (route === 'infill') return new InfillDecoder();
  if (route === 'mistral') return undefined; // chat-completion chunks: the regular OpenAI decoder
  return new CompletionsTextDecoder();
}

/** OpenAI legacy completions stream (choices[].text). */
export class CompletionsTextDecoder implements StreamDecoder {
  private started = false;
  private stop: IRStop = 'end_turn';

  push(_event: string | undefined, data: any): IREvent[] {
    const out: IREvent[] = [];
    if (!this.started) {
      this.started = true;
      out.push({ type: 'start', id: data?.id, model: data?.model });
    }
    if (data?.error) {
      out.push({ type: 'error', message: data.error.message || String(data.error) });
      return out;
    }
    const ch = data?.choices?.[0];
    if (typeof ch?.text === 'string' && ch.text) out.push({ type: 'text', text: ch.text });
    if (ch?.finish_reason) this.stop = ch.finish_reason === 'length' ? 'max_tokens' : 'end_turn';
    if (data?.usage) out.push({ type: 'usage', usage: { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 } });
    return out;
  }

  end(): IREvent[] {
    return [{ type: 'stop', reason: this.stop }];
  }
}

/** llama.cpp /infill stream ({content, stop}). */
export class InfillDecoder implements StreamDecoder {
  private started = false;
  private stop: IRStop = 'end_turn';

  push(_event: string | undefined, data: any): IREvent[] {
    const out: IREvent[] = [];
    if (!this.started) {
      this.started = true;
      out.push({ type: 'start' });
    }
    if (typeof data?.content === 'string' && data.content) out.push({ type: 'text', text: data.content });
    if (data?.stop) {
      if (data.stopped_limit || data.stop_type === 'limit') this.stop = 'max_tokens';
      if (data.tokens_predicted !== undefined || data.tokens_evaluated !== undefined) {
        out.push({ type: 'usage', usage: { input: data.tokens_evaluated ?? 0, output: data.tokens_predicted ?? 0 } });
      }
    }
    return out;
  }

  end(): IREvent[] {
    return [{ type: 'stop', reason: this.stop }];
  }
}

// ----------------------------------------------------------- chat emulation

const FIM_SYSTEM = [
  'You are a code completion engine inside an editor.',
  'Reply with ONLY the text to insert at <CURSOR>: no explanations, no markdown, no code fences.',
  'Do not repeat the code before or after the cursor. Match the surrounding indentation and style. Keep it short: complete the current statement or block.',
].join(' ');

const COMPLETE_SYSTEM = 'Continue the text exactly where it stops. Reply with the continuation only: no explanations, no markdown fences, do not repeat the given text.';

/** Chat prompt for models without a native completion endpoint (bounded context). */
export function emulateFim(ir: IRRequest): IRRequest {
  const fim = ir.fim!;
  const prefix = fim.prefix.length > 12_000 ? fim.prefix.slice(-12_000) : fim.prefix;
  const suffix = fim.suffix.length > 4_000 ? fim.suffix.slice(0, 4_000) : fim.suffix;
  const text = fim.mode === 'infill' ? `${prefix}<CURSOR>${suffix}` : prefix;
  return {
    ...ir,
    fim: undefined,
    system: fim.mode === 'infill' ? FIM_SYSTEM : COMPLETE_SYSTEM,
    messages: [{ role: 'user', parts: [{ type: 'text', text }] }],
    temperature: ir.temperature ?? 0.2,
    maxTokens: ir.maxTokens ?? 256,
  };
}

/**
 * Cleans chat answers used as completions: drops a leading ```lang fence, a
 * trailing fence, and text that repeats the end of the prefix.
 */
export class FimCleaner implements StreamTransform {
  private head = '';
  private headDone = false;
  private tail = '';

  constructor(private prefix: string) {}

  private clean(start: string): string {
    let s = start.replace(/^\s*```[\w+.-]*[ \t]*\n/, '');
    // Remove an echo of the last lines before the cursor (models often repeat them).
    const lines = this.prefix.split('\n');
    for (let k = Math.min(3, lines.length); k >= 1; k--) {
      const tail = lines.slice(-k).join('\n');
      if (tail.trim().length >= 3 && s.startsWith(tail)) {
        s = s.slice(tail.length);
        break;
      }
    }
    return s;
  }

  push(ev: IREvent): IREvent[] {
    if (ev.type !== 'text') {
      if (ev.type === 'stop') return [...this.flush(), ev];
      return [ev];
    }
    if (!this.headDone) {
      this.head += ev.text;
      // Enough text to spot an opening fence line and an echo of the prefix's last lines.
      const need = Math.min(400, this.prefix.split('\n').slice(-3).join('\n').length + 24);
      const fenceOpen = /^\s*```[^\n]*$/.test(this.head);
      if (this.head.length < need || fenceOpen) return [];
      this.headDone = true;
      return this.emit(this.clean(this.head));
    }
    return this.emit(ev.text);
  }

  private emit(text: string): IREvent[] {
    // Hold back a few chars that could be the start of a closing fence.
    const all = this.tail + text;
    const keep = Math.min(all.length, 5);
    this.tail = all.slice(all.length - keep);
    const out = all.slice(0, all.length - keep);
    return out ? [{ type: 'text', text: out }] : [];
  }

  flush(): IREvent[] {
    let rest = this.headDone ? this.tail : this.clean(this.head);
    this.head = '';
    this.tail = '';
    this.headDone = true;
    rest = rest.replace(/\n?```\s*$/, '');
    return rest ? [{ type: 'text', text: rest }] : [];
  }
}
