// Fake upstream LLM APIs (OpenAI chat, Anthropic, Gemini, Responses) for tests.
// Behaviour is selected by the model name:
//   *text*   -> streams "Hello world"
//   *tool*   -> streams a tool call get_weather({"city":"Paris"})
//   *think*  -> streams reasoning then text
//   fail-429 / fail-500 / fail-401 / fail-400 -> HTTP error
//   err-stream -> 200 then an in-stream error before any content
import http from 'http';
import type { AddressInfo } from 'net';

export interface Received {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

export interface MockUpstream {
  url: string;
  received: Received[];
  close(): Promise<void>;
}

const sse = (res: http.ServerResponse, data: any, event?: string) => {
  res.write(`${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
};

function failFor(model: string): number | null {
  const m = /fail-(\d{3})/.exec(model);
  return m ? Number(m[1]) : null;
}

function openai(res: http.ServerResponse, model: string, body: any) {
  const stream = body.stream;
  const id = 'chatcmpl-mock';
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id, object: 'chat.completion', model, choices: [{ index: 0, message: { role: 'assistant', content: 'Hello world' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta: any, finish: string | null = null) => sse(res, { id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: finish }] });
  if (model.includes('err-stream')) {
    sse(res, { error: { message: 'overloaded', code: 503 } });
    res.end();
    return;
  }
  chunk({ role: 'assistant', content: '' });
  if (model.includes('think')) chunk({ reasoning_content: 'Let me think.' });
  if (model.includes('tool')) {
    chunk({ tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'get_weather', arguments: '' } }] });
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] });
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"Paris"}' } }] });
    chunk({}, 'tool_calls');
  } else {
    chunk({ content: 'Hello' });
    chunk({ content: ' world' });
    chunk({}, 'stop');
  }
  if (body.stream_options?.include_usage) sse(res, { id, object: 'chat.completion.chunk', model, choices: [], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } });
  sse(res, '[DONE]');
  res.end();
}

function anthropic(res: http.ServerResponse, model: string, body: any) {
  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'Hello world' }], stop_reason: 'end_turn', usage: { input_tokens: 21, output_tokens: 3 } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type: string, data: any) => sse(res, { type, ...data }, type);
  ev('message_start', { message: { id: 'msg_mock', type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: 21, output_tokens: 1, cache_read_input_tokens: 5 } } });
  if (model.includes('err-stream')) {
    ev('error', { error: { type: 'overloaded_error', message: 'Overloaded' } });
    res.end();
    return;
  }
  let i = 0;
  if (model.includes('think')) {
    ev('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '' } });
    ev('content_block_delta', { index: i, delta: { type: 'thinking_delta', thinking: 'Let me think.' } });
    ev('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: 'sig_'.padEnd(40, 'x') } });
    ev('content_block_stop', { index: i++ });
  }
  if (model.includes('tool')) {
    ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: 'toolu_01', name: 'get_weather', input: {} } });
    ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: '{"city":' } });
    ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: '"Paris"}' } });
    ev('content_block_stop', { index: i });
    ev('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 9 } });
  } else {
    ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: 'Hello' } });
    ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: ' world' } });
    ev('content_block_stop', { index: i });
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } });
  }
  ev('message_stop', {});
  res.end();
}

function gemini(res: http.ServerResponse, model: string) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const usageMetadata = { promptTokenCount: 30, candidatesTokenCount: 4, totalTokenCount: 34 };
  if (model.includes('err-stream')) {
    sse(res, { error: { code: 503, message: 'The model is overloaded', status: 'UNAVAILABLE' } });
    res.end();
    return;
  }
  if (model.includes('think')) sse(res, { candidates: [{ content: { role: 'model', parts: [{ text: 'Let me think.', thought: true }] } }] });
  if (model.includes('tool')) {
    sse(res, { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'Paris' } }, thoughtSignature: 'gem-sig-123' }] }, finishReason: 'STOP' }], usageMetadata });
  } else {
    sse(res, { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] } }] });
    sse(res, { candidates: [{ content: { role: 'model', parts: [{ text: ' world' }] }, finishReason: 'STOP' }], usageMetadata });
  }
  res.end();
}

function responses(res: http.ServerResponse, model: string, body: any) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  let seq = 0;
  const ev = (type: string, data: any) => sse(res, { type, sequence_number: seq++, ...data }, type);
  const resp = { id: 'resp_mock', object: 'response', model, status: 'in_progress', output: [] as any[] };
  ev('response.created', { response: resp });
  if (model.includes('tool')) {
    const item = { id: 'fc_1', type: 'function_call', call_id: 'call_r1', name: 'get_weather', arguments: '', status: 'in_progress' };
    ev('response.output_item.added', { output_index: 0, item });
    ev('response.function_call_arguments.delta', { item_id: 'fc_1', output_index: 0, delta: '{"city":"Paris"}' });
    ev('response.output_item.done', { output_index: 0, item: { ...item, arguments: '{"city":"Paris"}', status: 'completed' } });
  } else {
    ev('response.output_item.added', { output_index: 0, item: { id: 'msg_1', type: 'message', role: 'assistant', content: [] } });
    ev('response.output_text.delta', { item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Hello' });
    ev('response.output_text.delta', { item_id: 'msg_1', output_index: 0, content_index: 0, delta: ' world' });
  }
  ev('response.completed', { response: { ...resp, status: 'completed', usage: { input_tokens: 40, output_tokens: 5, total_tokens: 45, input_tokens_details: { cached_tokens: 10 } } } });
  void body;
  res.end();
}

export async function startMockUpstream(): Promise<MockUpstream> {
  const received: Received[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
    const url = new URL(req.url || '/', 'http://x');
    received.push({ path: url.pathname + url.search, headers: req.headers, body });

    if (req.method === 'GET' && url.pathname.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-text' }, { id: 'mock-tool' }, { id: 'text-embedding-3-small' }] }));
      return;
    }

    let model = body.model || '';
    const gm = /\/models\/([^:]+):/.exec(url.pathname);
    if (gm) model = decodeURIComponent(gm[1]);

    const code = failFor(model);
    if (code) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (code === 429) headers['retry-after'] = '30';
      res.writeHead(code, headers);
      res.end(JSON.stringify({ error: { message: `mock failure ${code}`, type: 'mock_error' } }));
      return;
    }

    if (url.pathname.endsWith('/embeddings')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }], model }));
      return;
    }
    if (url.pathname.endsWith('/chat/completions')) return openai(res, model, body);
    if (url.pathname.endsWith('/v1/messages')) return anthropic(res, model, body);
    if (url.pathname.includes(':streamGenerateContent')) return gemini(res, model);
    if (url.pathname.endsWith('/responses')) return responses(res, model, body);
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

/** Parse an SSE body into [{event, data}] */
export function parseSSE(text: string): Array<{ event?: string; data: any }> {
  const out: Array<{ event?: string; data: any }> = [];
  for (const block of text.split(/\n\n+/)) {
    if (!block.trim() || block.startsWith(':')) continue;
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (!data.length) continue;
    const d = data.join('\n');
    let parsed: any = d;
    try { parsed = JSON.parse(d); } catch { /* keep string */ }
    out.push({ event, data: parsed });
  }
  return out;
}
