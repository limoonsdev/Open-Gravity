'use client';
import { Brain, Columns2, Eraser, Send, Settings2, Square, User, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AppLogo, ProviderLogo } from '@/components/logos';
import { ModelPicker } from '@/components/model-picker';
import { Badge, Button, Card, Field, Input, PageHeader, Switch, Textarea } from '@/components/ui';
import { cn, ms, num } from '@/lib/format';
import { useQueryParam } from '@/lib/hooks';
import { useAppState } from '@/lib/state';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  meta?: { provider?: string; model?: string; ms?: number; ttft?: number; input?: number; output?: number; emulated?: boolean; error?: string };
  streaming?: boolean;
}

interface Pane {
  model: string;
  messages: Msg[];
}

/** Render text with ``` fenced code blocks (content is escaped by React). */
function Rich({ text }: { text: string }) {
  const parts = text.split(/```/);
  return (
    <div className="space-y-2 text-[14px] leading-relaxed">
      {parts.map((p, i) => {
        if (i % 2 === 1) {
          const nl = p.indexOf('\n');
          const lang = nl > 0 ? p.slice(0, nl).trim() : '';
          const code = nl > 0 ? p.slice(nl + 1) : p;
          return (
            <pre key={i} className="overflow-x-auto rounded-xl border border-line bg-surface-2 px-3.5 py-3 font-mono text-[12.5px] leading-relaxed">
              {lang && <div className="mb-1.5 text-[11px] text-fg-3">{lang}</div>}
              <code>{code.replace(/\n$/, '')}</code>
            </pre>
          );
        }
        return p ? <p key={i} className="whitespace-pre-wrap">{p}</p> : null;
      })}
    </div>
  );
}

function Message({ m }: { m: Msg }) {
  const state = useAppState();
  const p = m.meta?.provider ? state.providers.find((x) => x.id === m.meta!.provider) : undefined;
  const [showReasoning, setShowReasoning] = useState(false);
  if (m.role === 'user') {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-accent px-4 py-2.5 text-[14px] whitespace-pre-wrap text-accent-fg shadow-sm">{m.content}</div>
        <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-3 ring-1 ring-line"><User className="size-3.5" /></span>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className="mt-1 shrink-0">{p ? <ProviderLogo type={p.type} name={p.name} color={p.color} size={28} rounded="rounded-full" /> : <AppLogo size={28} />}</span>
      <div className="min-w-0 flex-1">
        {m.reasoning && (
          <button onClick={() => setShowReasoning((v) => !v)} className="mb-2 inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-[12px] text-fg-3 hover:text-fg">
            <Brain className="size-3.5" /> {showReasoning ? 'Hide' : 'Show'} reasoning ({num(m.reasoning.length / 4)} tokens)
          </button>
        )}
        {showReasoning && m.reasoning && <div className="mb-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-[12.5px] whitespace-pre-wrap text-fg-3">{m.reasoning}</div>}
        {m.meta?.error ? <p className="text-[13.5px] text-bad">{m.meta.error}</p> : <Rich text={m.content || (m.streaming ? '…' : '')} />}
        {m.meta && !m.streaming && !m.meta.error && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.meta.provider && <Badge className="font-mono">{m.meta.provider}/{m.meta.model}</Badge>}
            {m.meta.ms !== undefined && <Badge>{ms(m.meta.ms)}</Badge>}
            {m.meta.ttft !== undefined && <Badge>first token {ms(m.meta.ttft)}</Badge>}
            {m.meta.output !== undefined && <Badge>{num(m.meta.input)} → {num(m.meta.output)} tok</Badge>}
            {m.meta.emulated && <Badge tone="accent" icon={<Wrench className="size-3" />}>tools emulated</Badge>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlaygroundPage() {
  const state = useAppState();
  const initial = useQueryParam('model');
  const [panes, setPanes] = useState<Pane[]>([{ model: '', messages: [] }]);
  const [input, setInput] = useState('');
  const [system, setSystem] = useState('');
  const [temperature, setTemperature] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [stream, setStream] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const aborts = useRef<AbortController[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPanes((p) => (p[0].model ? p : [{ ...p[0], model: initial || state.effectiveDefault || state.models[0]?.id || '' }, ...p.slice(1)]));
  }, [initial, state.effectiveDefault, state.models]);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [panes]);

  const update = (pi: number, fn: (m: Msg) => Msg) =>
    setPanes((all) => all.map((p, i) => (i === pi ? { ...p, messages: p.messages.map((m, j) => (j === p.messages.length - 1 ? fn(m) : m)) } : p)));

  const runPane = async (pi: number, pane: Pane, text: string) => {
    const history = [...pane.messages, { role: 'user' as const, content: text }];
    setPanes((all) => all.map((p, i) => (i === pi ? { ...p, messages: [...history, { role: 'assistant', content: '', streaming: true }] } : p)));
    const ac = new AbortController();
    aborts.current.push(ac);
    const t0 = performance.now();
    let ttft: number | undefined;
    try {
      const body: any = {
        model: pane.model, stream, messages: [...(system.trim() ? [{ role: 'system', content: system }] : []), ...history.map((m) => ({ role: m.role, content: m.content }))],
        ...(stream ? { stream_options: { include_usage: true } } : {}),
        ...(temperature ? { temperature: Number(temperature) } : {}),
        ...(maxTokens ? { max_tokens: Number(maxTokens) } : {}),
      };
      const res = await fetch('/admin/api/playground', { method: 'POST', headers: { 'content-type': 'application/json', 'x-og-admin': '1' }, body: JSON.stringify(body), signal: ac.signal });
      const meta = { provider: res.headers.get('x-og-provider') || undefined, model: res.headers.get('x-og-model') || undefined, emulated: res.headers.get('x-og-emulated-tools') === '1' };
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      if (!stream) {
        const data = await res.json();
        const msg = data.choices?.[0]?.message || {};
        update(pi, () => ({ role: 'assistant', content: msg.content || '', reasoning: msg.reasoning_content, meta: { ...meta, ms: performance.now() - t0, input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens } }));
        return;
      }
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let content = '';
      let reasoning = '';
      let usage: any;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const blocks = buf.split('\n\n');
        buf = blocks.pop() || '';
        for (const b of blocks) {
          const line = b.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const d = line.slice(5).trim();
          if (d === '[DONE]') continue;
          try {
            const j = JSON.parse(d);
            if (j.error) throw new Error(j.error.message || 'stream error');
            const delta = j.choices?.[0]?.delta || {};
            if (delta.content) content += delta.content;
            if (delta.reasoning_content) reasoning += delta.reasoning_content;
            if ((delta.content || delta.reasoning_content) && ttft === undefined) ttft = performance.now() - t0;
            if (j.usage) usage = j.usage;
          } catch (e: any) {
            if (e?.message && !/JSON/.test(e.message)) throw e;
          }
        }
        update(pi, (m) => ({ ...m, content, reasoning: reasoning || undefined }));
      }
      update(pi, (m) => ({ ...m, streaming: false, meta: { ...meta, ms: performance.now() - t0, ttft, input: usage?.prompt_tokens, output: usage?.completion_tokens } }));
    } catch (e: any) {
      update(pi, (m) => ({ ...m, streaming: false, meta: { error: e?.name === 'AbortError' ? 'Stopped.' : e?.message || String(e) } }));
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || panes.some((p) => !p.model)) return;
    setInput('');
    setBusy(true);
    aborts.current = [];
    await Promise.all(panes.map((p, i) => runPane(i, p, text)));
    setBusy(false);
  };

  const compare = panes.length > 1;
  return (
    <>
      <PageHeader
        title="Playground"
        sub="Talk to any model, combo or alias through the router — with fallback, emulated tools and token saver exactly as your tools get them."
        actions={
          <>
            <Button variant={compare ? 'soft' : 'secondary'} icon={<Columns2 className="size-4" />} onClick={() => setPanes(compare ? [panes[0]] : [...panes, { model: state.models.find((m) => m.id !== panes[0].model)?.id || '', messages: [] }])}>
              {compare ? 'Single' : 'Compare'}
            </Button>
            <Button variant={showSettings ? 'soft' : 'secondary'} icon={<Settings2 className="size-4" />} onClick={() => setShowSettings((v) => !v)}>Settings</Button>
            <Button variant="ghost" icon={<Eraser className="size-4" />} onClick={() => setPanes(panes.map((p) => ({ ...p, messages: [] })))}>Clear</Button>
          </>
        }
      />
      {showSettings && (
        <Card className="animate-in mb-4 grid gap-4 p-5 md:grid-cols-[2fr_1fr_1fr_auto]">
          <Field label="System prompt"><Textarea rows={2} value={system} onChange={(e) => setSystem(e.target.value)} placeholder="You are a helpful assistant." /></Field>
          <Field label="Temperature"><Input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="default" /></Field>
          <Field label="Max tokens"><Input type="number" min="1" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="default" /></Field>
          <div className="pt-7"><Switch checked={stream} onChange={setStream} label="Stream" /></div>
        </Card>
      )}
      <div className={cn('grid gap-4', compare && 'lg:grid-cols-2')}>
        {panes.map((pane, pi) => (
          <Card key={pi} className="flex min-h-[52vh] flex-col">
            <div className="border-b border-line p-3">
              <ModelPicker value={pane.model} onChange={(v) => setPanes(panes.map((p, i) => (i === pi ? { ...p, model: v } : p)))} />
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {!pane.messages.length && (
                <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-center text-fg-3">
                  <AppLogo size={44} className="opacity-90" />
                  <p className="text-sm">Ask anything. The reply shows which provider served it, how fast, and how many tokens it used.</p>
                </div>
              )}
              {pane.messages.map((m, i) => <Message key={i} m={m} />)}
              <div ref={pi === panes.length - 1 ? bottom : undefined} />
            </div>
          </Card>
        ))}
      </div>
      <div className="sticky bottom-4 mt-4">
        <Card className="flex items-end gap-2 p-2.5 shadow-xl">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={Math.min(8, Math.max(1, input.split('\n').length))}
            placeholder={compare ? 'Message both models… (Enter to send, Shift+Enter for a new line)' : 'Message… (Enter to send, Shift+Enter for a new line)'}
            className="max-h-60 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[14px] outline-none placeholder:text-fg-3"
          />
          {busy ? (
            <Button size="lg" onClick={() => aborts.current.forEach((a) => a.abort())} icon={<Square className="size-4" />}>Stop</Button>
          ) : (
            <Button size="lg" variant="primary" disabled={!input.trim() || panes.some((p) => !p.model)} onClick={send} icon={<Send className="size-4" />}>Send</Button>
          )}
        </Card>
      </div>
    </>
  );
}
