// Google Gemini generateContent <-> IR
import {
  IRRequest, IRMessage, IRPart, IRTool, IRToolChoice, IREvent, IRResponse, IRStop, IRUsage,
  StreamDecoder, StreamEncoder, genId, safeJsonParse, mergeConsecutive, effortToBudget, budgetToEffort,
} from './ir';
import { sseData } from './sse';

// Gemini 3 requires the thought signature attached to each functionCall to be
// sent back with the history. Clients speaking other protocols can't carry it,
// so we remember it by tool-call id.
const SIG_CACHE_MAX = 5000;
const thoughtSignatures = new Map<string, string>();
export function rememberSignature(toolId: string, sig: string) {
  if (!toolId || !sig) return;
  thoughtSignatures.set(toolId, sig);
  if (thoughtSignatures.size > SIG_CACHE_MAX) {
    const first = thoughtSignatures.keys().next().value;
    if (first !== undefined) thoughtSignatures.delete(first);
  }
}
const DUMMY_SIGNATURE = 'skip_thought_signature_validator';

// ---------------------------------------------------------------- request in

export function parseGeminiRequest(body: any, model: string, stream: boolean): IRRequest {
  const system = body.systemInstruction?.parts?.map((p: any) => p.text || '').filter(Boolean).join('\n') || undefined;
  const messages: IRMessage[] = [];
  // Gemini function responses reference calls by name (ids are optional).
  const pendingByName = new Map<string, string[]>();

  for (const c of body.contents || []) {
    const role = c.role === 'model' ? 'assistant' : 'user';
    const parts: IRPart[] = [];
    for (const p of c.parts || []) {
      if (p.thought && typeof p.text === 'string') parts.push({ type: 'thinking', text: p.text, signature: p.thoughtSignature });
      else if (typeof p.text === 'string') {
        if (p.text) parts.push({ type: 'text', text: p.text });
      } else if (p.inlineData) parts.push({ type: 'image', mediaType: p.inlineData.mimeType, data: p.inlineData.data });
      else if (p.fileData) parts.push({ type: 'image', mediaType: p.fileData.mimeType, url: p.fileData.fileUri });
      else if (p.functionCall) {
        const id = p.functionCall.id || genId('call_');
        const list = pendingByName.get(p.functionCall.name) || [];
        list.push(id);
        pendingByName.set(p.functionCall.name, list);
        if (p.thoughtSignature) rememberSignature(id, p.thoughtSignature);
        parts.push({ type: 'tool_call', id, name: p.functionCall.name, args: JSON.stringify(p.functionCall.args || {}) });
      } else if (p.functionResponse) {
        const name = p.functionResponse.name;
        const id = p.functionResponse.id || pendingByName.get(name)?.shift() || `call_${name}`;
        const resp = p.functionResponse.response;
        const text = typeof resp === 'string' ? resp : resp?.output !== undefined && Object.keys(resp).length === 1
          ? (typeof resp.output === 'string' ? resp.output : JSON.stringify(resp.output))
          : JSON.stringify(resp ?? {});
        parts.push({ type: 'tool_result', id, name, content: [{ type: 'text', text }], isError: !!resp?.error });
      }
    }
    messages.push({ role, parts });
  }

  let tools: IRTool[] | undefined;
  for (const t of body.tools || []) {
    for (const fd of t.functionDeclarations || []) {
      tools = tools || [];
      tools.push({ name: fd.name, description: fd.description, parameters: fd.parametersJsonSchema || normalizeGeminiSchema(fd.parameters) || { type: 'object', properties: {} } });
    }
  }

  let toolChoice: IRToolChoice | undefined;
  const mode = body.toolConfig?.functionCallingConfig?.mode;
  const allowed = body.toolConfig?.functionCallingConfig?.allowedFunctionNames;
  if (mode === 'NONE') toolChoice = 'none';
  else if (mode === 'ANY') toolChoice = allowed?.length === 1 ? { name: allowed[0] } : 'required';
  else if (mode === 'AUTO') toolChoice = 'auto';

  const gc = body.generationConfig || {};
  let reasoning: IRRequest['reasoning'];
  const tcfg = gc.thinkingConfig;
  if (tcfg && (tcfg.thinkingBudget > 0 || tcfg.thinkingLevel || tcfg.includeThoughts)) {
    reasoning = {
      budget: tcfg.thinkingBudget > 0 ? tcfg.thinkingBudget : undefined,
      effort: tcfg.thinkingLevel ? (String(tcfg.thinkingLevel).toLowerCase() as any) : undefined,
    };
  }

  let responseFormat: IRRequest['responseFormat'];
  if (gc.responseMimeType === 'application/json') {
    const schema = gc.responseJsonSchema || normalizeGeminiSchema(gc.responseSchema);
    responseFormat = schema ? { type: 'json_schema', schema, name: 'response' } : { type: 'json_object' };
  }

  return {
    model,
    system,
    messages,
    tools,
    toolChoice,
    maxTokens: gc.maxOutputTokens,
    temperature: gc.temperature,
    topP: gc.topP,
    topK: gc.topK,
    stop: gc.stopSequences,
    stream,
    reasoning,
    responseFormat,
  };
}

/** Gemini OpenAPI-style schema (type: "OBJECT") -> JSON schema (type: "object"). */
function normalizeGeminiSchema(s: any): any {
  if (!s || typeof s !== 'object') return s;
  if (Array.isArray(s)) return s.map(normalizeGeminiSchema);
  const out: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'type' && typeof v === 'string') out.type = v.toLowerCase();
    else out[k] = typeof v === 'object' ? normalizeGeminiSchema(v) : v;
  }
  return out;
}

// --------------------------------------------------------------- request out

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  '$schema', '$id', '$ref', '$defs', 'definitions', '$comment', 'additionalProperties', 'unevaluatedProperties',
  'patternProperties', 'propertyNames', 'dependentSchemas', 'dependentRequired', 'dependencies', 'if', 'then', 'else',
  'not', 'contains', 'minContains', 'maxContains', 'const', 'examples', 'default', 'exclusiveMinimum', 'exclusiveMaximum',
  'multipleOf', 'uniqueItems', 'readOnly', 'writeOnly', 'deprecated', 'contentEncoding', 'contentMediaType', 'strict',
  'additionalItems', 'prefixItems', 'unevaluatedItems', 'minProperties', 'maxProperties', 'title',
]);

/** Convert arbitrary JSON Schema into the OpenAPI subset Gemini accepts. */
export function cleanSchemaForGemini(schema: any, defs?: Record<string, any>, depth = 0): any {
  if (!schema || typeof schema !== 'object' || depth > 24) return schema;
  if (Array.isArray(schema)) return schema.map((s) => cleanSchemaForGemini(s, defs, depth + 1));
  const rootDefs = defs || schema.$defs || schema.definitions || {};

  if (schema.$ref && typeof schema.$ref === 'string') {
    const name = schema.$ref.split('/').pop();
    const target = name ? rootDefs[name] : undefined;
    if (target) {
      const merged = schema.description ? { ...target, description: schema.description } : target;
      return cleanSchemaForGemini(merged, rootDefs, depth + 1);
    }
    return { type: 'object' };
  }

  const out: any = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if (key === 'type') {
      if (Array.isArray(value)) {
        const types = value.filter((t) => t !== 'null');
        out.type = types[0] || 'string';
        if (value.includes('null')) out.nullable = true;
      } else out.type = value;
    } else if (key === 'properties' && value && typeof value === 'object') {
      out.properties = {};
      for (const [pk, pv] of Object.entries(value as any)) out.properties[pk] = cleanSchemaForGemini(pv, rootDefs, depth + 1);
    } else if (key === 'items') {
      out.items = cleanSchemaForGemini(Array.isArray(value) ? value[0] : value, rootDefs, depth + 1);
    } else if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      const variants = (value as any[]).map((v) => cleanSchemaForGemini(v, rootDefs, depth + 1));
      const nonNull = variants.filter((v) => v?.type !== 'null');
      if (key === 'allOf') Object.assign(out, ...nonNull);
      else if (nonNull.length === 1) {
        Object.assign(out, nonNull[0]);
        if (nonNull.length !== variants.length) out.nullable = true;
      } else out.anyOf = nonNull;
    } else if (key === 'enum') {
      out.enum = (value as any[]).filter((v) => v !== null).map((v) => String(v));
      if (!out.type) out.type = 'string';
    } else if (key === 'format') {
      if (value === 'enum' || value === 'date-time') out.format = value;
    } else if (key === 'required') {
      if (Array.isArray(value) && value.length) out.required = value;
    } else {
      out[key] = value && typeof value === 'object' ? cleanSchemaForGemini(value, rootDefs, depth + 1) : value;
    }
  }
  if (schema.const !== undefined && !out.enum) {
    out.enum = [String(schema.const)];
    out.type = 'string';
  }
  if (out.enum && out.type && out.type !== 'string') out.type = 'string';
  if (out.required && out.properties) out.required = out.required.filter((r: string) => r in out.properties);
  if (out.type === 'object' && out.properties && !Object.keys(out.properties).length) delete out.properties;
  return out;
}

export interface GeminiBuildOptions {
  model: string;
}

function isGemini3(model: string): boolean {
  return /gemini-3/i.test(model);
}

export function buildGeminiRequest(ir: IRRequest, opts: GeminiBuildOptions): any {
  const nameById = new Map<string, string>();
  for (const m of ir.messages) for (const p of m.parts) if (p.type === 'tool_call') nameById.set(p.id, p.name);

  const contents: any[] = [];
  for (const m of mergeConsecutive(ir.messages)) {
    const parts: any[] = [];
    let sawCall = false;
    for (const p of m.parts) {
      switch (p.type) {
        case 'text':
          if (p.text) parts.push({ text: p.text });
          break;
        case 'image':
          if (p.data) parts.push({ inlineData: { mimeType: p.mediaType || 'image/png', data: p.data } });
          else if (p.url) parts.push({ fileData: { mimeType: p.mediaType || 'image/png', fileUri: p.url } });
          break;
        case 'thinking':
          break;
        case 'tool_call': {
          const part: any = { functionCall: { name: p.name, args: safeJsonParse(p.args, {}) } };
          const sig = thoughtSignatures.get(p.id);
          // Only the first call of a parallel batch carries the signature.
          if (sig) part.thoughtSignature = sig;
          else if (!sawCall && isGemini3(opts.model)) part.thoughtSignature = DUMMY_SIGNATURE;
          sawCall = true;
          parts.push(part);
          break;
        }
        case 'tool_result': {
          const text = p.content.filter((c) => c.type === 'text').map((c: any) => c.text).join('\n');
          const parsed = safeJsonParse(text, undefined);
          const response = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { output: text };
          if (p.isError && !('error' in response)) (response as any).error = true;
          parts.push({ functionResponse: { name: p.name || nameById.get(p.id) || 'tool', response } });
          for (const c of p.content) if (c.type === 'image' && c.data) parts.push({ inlineData: { mimeType: c.mediaType || 'image/png', data: c.data } });
          break;
        }
      }
    }
    if (parts.length) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }

  const body: any = { contents };
  if (ir.system) body.systemInstruction = { role: 'user', parts: [{ text: ir.system }] };

  if (ir.tools?.length) {
    body.tools = [{
      functionDeclarations: ir.tools.map((t) => {
        const params = cleanSchemaForGemini(t.parameters || { type: 'object', properties: {} });
        const fd: any = { name: t.name, description: t.description || '' };
        if (params && (params.properties || params.type !== 'object')) fd.parameters = params;
        return fd;
      }),
    }];
    if (ir.toolChoice) {
      const tc = ir.toolChoice;
      body.toolConfig = {
        functionCallingConfig: tc === 'auto' ? { mode: 'AUTO' } : tc === 'none' ? { mode: 'NONE' } : tc === 'required' ? { mode: 'ANY' } : { mode: 'ANY', allowedFunctionNames: [tc.name] },
      };
    }
  }

  const gc: any = {};
  if (ir.maxTokens) gc.maxOutputTokens = ir.maxTokens;
  if (ir.temperature !== undefined) gc.temperature = ir.temperature;
  if (ir.topP !== undefined) gc.topP = ir.topP;
  if (ir.topK !== undefined) gc.topK = ir.topK;
  if (ir.stop?.length) gc.stopSequences = ir.stop.slice(0, 5);
  if (ir.responseFormat) {
    gc.responseMimeType = 'application/json';
    if (ir.responseFormat.schema) gc.responseSchema = cleanSchemaForGemini(ir.responseFormat.schema);
  }
  if (ir.reasoning) {
    if (isGemini3(opts.model)) {
      const effort = ir.reasoning.effort || budgetToEffort(ir.reasoning.budget);
      gc.thinkingConfig = { thinkingLevel: effort === 'high' || effort === 'medium' ? 'high' : 'low', includeThoughts: true };
    } else {
      gc.thinkingConfig = { thinkingBudget: ir.reasoning.budget || effortToBudget(ir.reasoning.effort), includeThoughts: true };
    }
  }
  if (Object.keys(gc).length) body.generationConfig = gc;
  return body;
}

// ------------------------------------------------------------ stream decode

const FINISH_MAP: Record<string, IRStop> = {
  STOP: 'end_turn',
  MAX_TOKENS: 'max_tokens',
  SAFETY: 'content_filter',
  RECITATION: 'content_filter',
  BLOCKLIST: 'content_filter',
  PROHIBITED_CONTENT: 'content_filter',
  SPII: 'content_filter',
  IMAGE_SAFETY: 'content_filter',
  LANGUAGE: 'content_filter',
  MALFORMED_FUNCTION_CALL: 'end_turn',
  OTHER: 'end_turn',
};

export function usageFromGemini(u: any): Partial<IRUsage> | undefined {
  if (!u) return undefined;
  const cached = u.cachedContentTokenCount || 0;
  return {
    input: Math.max(0, (u.promptTokenCount || 0) - cached),
    output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
    cacheRead: cached || undefined,
    reasoning: u.thoughtsTokenCount || undefined,
  };
}

export class GeminiStreamDecoder implements StreamDecoder {
  private started = false;
  private nextTool = 0;
  private stop?: IRStop;

  push(_event: string | undefined, data: any): IREvent[] {
    const out: IREvent[] = [];
    // Some gateways wrap the payload as { response: {...} }.
    if (data?.response && !data.candidates) data = data.response;
    if (data?.error) {
      out.push({ type: 'error', message: data.error.message || 'Gemini error', status: data.error.code });
      return out;
    }
    if (!this.started) {
      this.started = true;
      out.push({ type: 'start', id: data?.responseId, model: data?.modelVersion });
    }
    const cand = data?.candidates?.[0];
    for (const p of cand?.content?.parts || []) {
      if (p.thought && typeof p.text === 'string') {
        if (p.text) out.push({ type: 'thinking', text: p.text });
        if (p.thoughtSignature) out.push({ type: 'thinking_signature', signature: p.thoughtSignature });
      } else if (p.functionCall) {
        const idx = this.nextTool++;
        const id = p.functionCall.id || genId('call_');
        if (p.thoughtSignature) rememberSignature(id, p.thoughtSignature);
        out.push({ type: 'tool_start', index: idx, id, name: p.functionCall.name });
        out.push({ type: 'tool_args', index: idx, delta: JSON.stringify(p.functionCall.args || {}) });
        out.push({ type: 'tool_end', index: idx });
      } else if (typeof p.text === 'string' && p.text) {
        out.push({ type: 'text', text: p.text });
      }
    }
    if (cand?.finishReason) this.stop = FINISH_MAP[cand.finishReason] || 'end_turn';
    if (data?.promptFeedback?.blockReason) this.stop = 'content_filter';
    const usage = usageFromGemini(data?.usageMetadata);
    if (usage) out.push({ type: 'usage', usage });
    return out;
  }

  end(): IREvent[] {
    let stop = this.stop || 'end_turn';
    if (this.nextTool > 0 && stop === 'end_turn') stop = 'tool_use';
    return [{ type: 'stop', reason: stop }];
  }
}

// ------------------------------------------------------------ stream encode

const STOP_TO_GEMINI: Record<IRStop, string> = {
  end_turn: 'STOP',
  stop_sequence: 'STOP',
  tool_use: 'STOP',
  max_tokens: 'MAX_TOKENS',
  content_filter: 'SAFETY',
  error: 'OTHER',
};

function usageToGemini(u: IRUsage) {
  const prompt = u.input + (u.cacheRead || 0) + (u.cacheWrite || 0);
  const thoughts = u.reasoning || 0;
  const candidates = Math.max(0, u.output - thoughts);
  return {
    promptTokenCount: prompt,
    candidatesTokenCount: candidates,
    totalTokenCount: prompt + u.output,
    ...(thoughts ? { thoughtsTokenCount: thoughts } : {}),
    ...(u.cacheRead ? { cachedContentTokenCount: u.cacheRead } : {}),
  };
}

export class GeminiStreamEncoder implements StreamEncoder {
  private finished = false;
  private usage: IRUsage = { input: 0, output: 0 };
  private tools = new Map<number, { id: string; name: string; args: string }>();
  private responseId = genId('', 20);

  constructor(private model: string) {}

  private chunk(parts: any[], finishReason?: string, usage?: IRUsage): string {
    const cand: any = { content: { role: 'model', parts }, index: 0 };
    if (finishReason) cand.finishReason = finishReason;
    const payload: any = { candidates: [cand], modelVersion: this.model, responseId: this.responseId };
    if (usage) payload.usageMetadata = usageToGemini(usage);
    return sseData(payload);
  }

  push(ev: IREvent): string {
    if (this.finished) return '';
    switch (ev.type) {
      case 'text':
        return this.chunk([{ text: ev.text }]);
      case 'thinking':
        return this.chunk([{ text: ev.text, thought: true }]);
      case 'tool_start':
        this.tools.set(ev.index, { id: ev.id, name: ev.name, args: '' });
        return '';
      case 'tool_args': {
        const t = this.tools.get(ev.index);
        if (t) t.args += ev.delta;
        return '';
      }
      case 'tool_end': {
        const t = this.tools.get(ev.index);
        if (!t) return '';
        this.tools.delete(ev.index);
        return this.chunk([{ functionCall: { name: t.name, args: safeJsonParse(t.args, {}) } }]);
      }
      case 'usage':
        Object.assign(this.usage, Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v !== undefined)));
        return '';
      case 'stop':
        return this.finish(ev.reason);
      case 'error':
        this.finished = true;
        return sseData({ error: { code: ev.status || 500, message: ev.message, status: 'INTERNAL' } });
    }
    return '';
  }

  private finish(reason: IRStop): string {
    if (this.finished) return '';
    let out = '';
    for (const idx of [...this.tools.keys()]) out += this.push({ type: 'tool_end', index: idx });
    this.finished = true;
    return out + this.chunk([{ text: '' }], STOP_TO_GEMINI[reason], this.usage);
  }

  end(): string {
    return this.finish('end_turn');
  }
}

// ---------------------------------------------------------- non-stream out

export function buildGeminiResponse(res: IRResponse, model: string): any {
  const parts: any[] = [];
  for (const p of res.parts) {
    if (p.type === 'thinking' && p.text) parts.push({ text: p.text, thought: true });
    else if (p.type === 'text') parts.push({ text: p.text });
    else if (p.type === 'tool_call') parts.push({ functionCall: { name: p.name, args: safeJsonParse(p.args, {}) } });
  }
  if (!parts.length) parts.push({ text: '' });
  return {
    candidates: [{ content: { role: 'model', parts }, finishReason: STOP_TO_GEMINI[res.stop], index: 0 }],
    usageMetadata: usageToGemini(res.usage),
    modelVersion: model,
    responseId: genId('', 20),
  };
}

export function geminiError(message: string, code = 500, status = 'INTERNAL') {
  return { error: { code, message, status } };
}
