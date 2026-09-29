'use client';
import { Calculator, Check, FlaskConical, Info, PiggyBank, Scissors, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ModelPicker } from '@/components/model-picker';
import { Badge, Button, Card, CardHeader, Field, Input, Meter, PageHeader, Select, Stat, Switch, Textarea, useRun } from '@/components/ui';
import { get, post, put } from '@/lib/api';
import { cn, num, pct, usd } from '@/lib/format';
import { useAnalytics } from '@/lib/hooks';
import { useApp, useAppState } from '@/lib/state';
import type { SimulateResult, TokenSaverSettings, UsageRecord } from '@/lib/types';

type Mode = TokenSaverSettings['mode'];

const MODES: Array<{ mode: Mode; title: string; body: string; tag?: string }> = [
  { mode: 'off', title: 'Off', body: 'Requests are sent exactly as the client wrote them.' },
  { mode: 'safe', title: 'Safe', body: 'Only huge old tool outputs are shortened, duplicates removed, and the conversation is compacted right before it overflows the model.', tag: 'Recommended' },
  { mode: 'balanced', title: 'Balanced', body: 'Also minifies JSON outputs, drops old images and old reasoning, trims outputs over 4k tokens, compacts at 85% of the context.' },
  { mode: 'aggressive', title: 'Aggressive', body: 'Keeps only the last 2 turns intact, trims old outputs to 1.5k tokens and compacts at 70% of the context. Maximum savings.' },
  { mode: 'custom', title: 'Custom', body: 'Choose every option yourself.' },
];

const ACTION_LABELS: Record<string, string> = {
  'trim-tool-output': 'Long tool outputs shortened',
  'dedupe-tool-output': 'Repeated outputs removed',
  'minify-json': 'JSON minified',
  whitespace: 'Whitespace collapsed',
  'drop-old-image': 'Old images dropped',
  'drop-old-reasoning': 'Old reasoning dropped',
  'compact-trim': 'Compaction: outputs trimmed',
  'compact-digest': 'Compaction: old turns summarised (built-in)',
  'compact-summary': 'Compaction: old turns summarised (LLM)',
  'compact-recent': 'Compaction: recent outputs trimmed',
};

export default function TokensPage() {
  const state = useAppState();
  const { refresh } = useApp();
  const run = useRun();
  const saved = state.settings.tokenSaver;
  const [s, setS] = useState<TokenSaverSettings>(saved);
  const [presets, setPresets] = useState<Record<string, TokenSaverSettings> | null>(null);
  const { data } = useAnalytics('30d');
  useEffect(() => setS(saved), [saved]);
  useEffect(() => {
    get<Record<string, TokenSaverSettings>>('/tokensaver/presets').then(setPresets).catch(() => undefined);
  }, []);

  const pick = (mode: Mode) => {
    if (mode === 'custom') setS({ ...s, mode });
    else if (presets?.[mode]) setS({ ...presets[mode] });
    else setS({ ...s, mode });
  };
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const save = async () => {
    await run(() => put('/settings', { tokenSaver: s }), 'Token saver updated');
    refresh();
  };
  const set = <K extends keyof TokenSaverSettings>(k: K, v: TokenSaverSettings[K]) => setS({ ...s, mode: 'custom', [k]: v });

  return (
    <>
      <PageHeader
        title="Token saver"
        sub="Agents resend the whole conversation on every turn. Open Gravity shrinks what doesn't matter anymore before it leaves your machine — and compacts long sessions before they overflow the model."
        actions={<Button variant="primary" disabled={!dirty} onClick={save} icon={<Check className="size-4" />}>Save</Button>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tokens saved (30 days)" icon={<PiggyBank className="size-3.5" />} tone="good" value={num(data?.totals.saved)} sub={`${num(data?.savings.requests)} requests shortened`} />
        <Stat label="Money saved (30 days)" icon={<Sparkles className="size-3.5" />} tone="good" value={usd(data?.totals.savedCost)} sub="at each model's input price" />
        <Stat label="Share of prompt tokens" icon={<Scissors className="size-3.5" />} value={data?.totals.input ? pct(data.totals.saved / (data.totals.input + data.totals.saved)) : '—'} sub="removed before sending" />
        <Stat label="Mode" icon={<Info className="size-3.5" />} value={<span className="capitalize">{saved.mode}</span>} sub={saved.summarizer ? `LLM summaries with ${saved.summarizer}` : 'built-in compaction'} />
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {MODES.map((m) => (
          <button key={m.mode} onClick={() => pick(m.mode)} className={cn('card card-hover p-4 text-left', s.mode === m.mode && 'ring-2 ring-accent')}>
            <div className="flex items-center gap-2">
              <span className={cn('flex size-4 items-center justify-center rounded-full border', s.mode === m.mode ? 'border-accent bg-accent' : 'border-line-strong')}>
                {s.mode === m.mode && <span className="size-1.5 rounded-full bg-white" />}
              </span>
              <span className="text-[15px] font-semibold">{m.title}</span>
              {m.tag && <Badge tone="good" className="ml-auto">{m.tag}</Badge>}
            </div>
            <p className="mt-2 text-[12.5px] leading-snug text-fg-3">{m.body}</p>
          </button>
        ))}
      </div>

      {s.mode !== 'off' && (
        <Card className="mt-4">
          <CardHeader title="Options" sub="Changing any option switches to Custom." />
          <div className="grid gap-5 p-5 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Keep the last turns untouched" hint="Never modified, whatever the options (1 turn = assistant + user message).">
              <Input type="number" min={0} max={100} value={s.keepRecentTurns} onChange={(e) => set('keepRecentTurns', Number(e.target.value))} />
            </Field>
            <Field label="Shorten old tool outputs above (tokens)" hint="Keeps the head and the tail. 0 = never.">
              <Input type="number" min={0} step={500} value={s.toolResultMaxTokens} onChange={(e) => set('toolResultMaxTokens', Number(e.target.value))} />
            </Field>
            <Field label={`Compact at ${Math.round(s.compactAt * 100)}% of the context window`} hint="0% = never compact.">
              <input type="range" min={0} max={1} step={0.01} value={s.compactAt} onChange={(e) => set('compactAt', Number(e.target.value))} className="w-full accent-[var(--og-accent)]" />
            </Field>
            <Field label={`Shrink to ${Math.round(s.compactTarget * 100)}% when compacting`} hint="Lower = fewer compactions, more summarised.">
              <input type="range" min={0.1} max={0.95} step={0.01} value={s.compactTarget} onChange={(e) => set('compactTarget', Number(e.target.value))} className="w-full accent-[var(--og-accent)]" />
            </Field>
            <Field label="Summarise compacted turns with" hint="Empty = instant built-in digest (tool calls, files, requests). A model gives richer summaries, cached so agent loops reuse them.">
              <div className="flex gap-2">
                <ModelPicker value={s.summarizer} onChange={(v) => set('summarizer', v)} placeholder="Built-in (instant, free)" className="flex-1" />
                {s.summarizer && <Button variant="ghost" onClick={() => set('summarizer', '')}>Clear</Button>}
              </div>
            </Field>
            <div className="space-y-3">
              <Switch checked={s.dedupeToolResults} onChange={(v) => set('dedupeToolResults', v)} label="Remove repeated tool outputs" />
              <Switch checked={s.minifyJson} onChange={(v) => set('minifyJson', v)} label="Minify JSON in old outputs" />
              <Switch checked={s.compactWhitespace} onChange={(v) => set('compactWhitespace', v)} label="Collapse whitespace" />
              <Switch checked={s.dropOldImages} onChange={(v) => set('dropOldImages', v)} label="Drop old images (keeps the first message's)" />
              <Switch checked={s.dropOldThinking} onChange={(v) => set('dropOldThinking', v)} label="Drop old reasoning blocks" />
            </div>
          </div>
          <div className="flex items-start gap-2 border-t border-line px-5 py-3 text-[12.5px] text-fg-3">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Older messages change in steps of 8 so providers&apos; prompt caches (Anthropic, OpenAI) keep hitting between steps. Recent turns, the system prompt and the task are never touched.
          </div>
        </Card>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Simulator />
        <MonthlyCalculator measured={data && data.totals.input ? data.totals.saved / (data.totals.input + data.totals.saved) : undefined} />
      </div>

      {data?.savings.byAction.length ? (
        <Card className="mt-4">
          <CardHeader title="What the saver did (30 days)" />
          <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {data.savings.byAction.map((a) => (
              <div key={a.action} className="flex items-center justify-between rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-[13px]">
                <span>{ACTION_LABELS[a.action] || a.action}</span>
                <span className="font-medium tabular-nums">{num(a.count)}×</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}

function Simulator() {
  const run = useRun();
  const [source, setSource] = useState<'captured' | 'paste'>('captured');
  const [captured, setCaptured] = useState<UsageRecord[]>([]);
  const [requestId, setRequestId] = useState('');
  const [body, setBody] = useState('');
  const [format, setFormat] = useState('openai');
  const [contextWindow, setContextWindow] = useState('128000');
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<UsageRecord[]>('/usage/recent?limit=50').then((r) => {
      setCaptured(r);
      if (r[0]) setRequestId(r[0].id);
    }).catch(() => undefined);
  }, []);
  const simulate = async () => {
    setBusy(true);
    let payload: any = { contextWindow: Number(contextWindow) || undefined };
    if (source === 'captured') payload.requestId = requestId;
    else {
      try {
        payload = { ...payload, body: JSON.parse(body), format };
      } catch {
        setBusy(false);
        run(async () => { throw new Error('The request body is not valid JSON'); });
        return;
      }
    }
    const r = await run(() => post<SimulateResult>('/tokensaver/simulate', payload));
    setBusy(false);
    if (r) setResult(r);
  };
  const max = Math.max(1, ...(result?.results.map((r) => r.before) || [1]));
  return (
    <Card>
      <CardHeader title="Simulator" sub="Run every preset on a real request and compare." icon={<FlaskConical className="size-4" />} />
      <div className="space-y-4 p-5">
        <div className="flex gap-2">
          <Button size="sm" variant={source === 'captured' ? 'soft' : 'ghost'} onClick={() => setSource('captured')}>Recent request</Button>
          <Button size="sm" variant={source === 'paste' ? 'soft' : 'ghost'} onClick={() => setSource('paste')}>Paste a request body</Button>
        </div>
        {source === 'captured' ? (
          <Field label="Request" hint='Needs "Capture request bodies" (Settings) when the request was made.'>
            <Select value={requestId} onChange={(e) => setRequestId(e.target.value)}>
              {captured.map((r) => <option key={r.id} value={r.id}>{new Date(r.ts).toLocaleTimeString()} · {r.requestedModel || '(default)'} · {num(r.input)} tokens</option>)}
              {!captured.length && <option value="">No recent request</option>}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Format">
              <Select value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="openai">OpenAI Chat Completions</option>
                <option value="anthropic">Anthropic Messages</option>
                <option value="responses">OpenAI Responses</option>
                <option value="gemini">Gemini</option>
              </Select>
            </Field>
            <Textarea className="font-mono" rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder='{"model": "...", "messages": [...]}' />
          </>
        )}
        <Field label="Target context window (tokens)" hint="Compaction happens relative to this size.">
          <Input type="number" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} />
        </Field>
        <Button variant="primary" loading={busy} onClick={simulate} icon={<FlaskConical className="size-4" />}>Simulate</Button>
        {result && (
          <div className="space-y-3 border-t border-line pt-4">
            <p className="text-[12.5px] text-fg-3">{result.messages} messages · {num(result.tokens)} tokens originally</p>
            {result.results.map((r) => (
              <div key={r.mode}>
                <div className="mb-1 flex items-baseline text-[13px]">
                  <span className="capitalize font-medium">{r.mode}</span>
                  <span className="ml-auto tabular-nums">{num(r.after)} tokens <span className="text-good">−{pct(r.saved / Math.max(1, r.before))}</span></span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full" style={{ width: `${(r.after / max) * 100}%`, background: 'var(--series-1)' }} />
                </div>
                {r.actions.length ? <p className="mt-1 text-[11.5px] text-fg-3">{r.actions.map((a) => ACTION_LABELS[a] || a).join(' · ')}</p> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function MonthlyCalculator({ measured }: { measured?: number }) {
  const [requests, setRequests] = useState('20000');
  const [promptTokens, setPromptTokens] = useState('45000');
  const [price, setPrice] = useState('3');
  const [ratio, setRatio] = useState<number>(0.25);
  useEffect(() => {
    if (measured && measured > 0) setRatio(Math.round(measured * 100) / 100);
  }, [measured]);
  const calc = useMemo(() => {
    const tokens = (Number(requests) || 0) * (Number(promptTokens) || 0);
    const cost = (tokens * (Number(price) || 0)) / 1e6;
    return { tokens, cost, savedTokens: tokens * ratio, savedCost: cost * ratio };
  }, [requests, promptTokens, price, ratio]);
  return (
    <Card>
      <CardHeader title="Monthly savings calculator" sub="Estimate what the saver is worth on your workload." icon={<Calculator className="size-4" />} />
      <div className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Requests / month"><Input type="number" value={requests} onChange={(e) => setRequests(e.target.value)} /></Field>
          <Field label="Avg prompt tokens"><Input type="number" value={promptTokens} onChange={(e) => setPromptTokens(e.target.value)} /></Field>
          <Field label="Input price ($ / 1M)"><Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        </div>
        <Field label={`Reduction: ${Math.round(ratio * 100)}%`} hint={measured ? `Your measured reduction over 30 days: ${pct(measured)}.` : 'Typical agent sessions: 10–30% (safe), 25–45% (balanced), 40–60% (aggressive). Use the simulator for your own traffic.'}>
          <input type="range" min={0} max={0.8} step={0.01} value={ratio} onChange={(e) => setRatio(Number(e.target.value))} className="w-full accent-[var(--og-accent)]" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-line bg-surface-2/60 p-4">
            <div className="text-[12.5px] text-fg-3">Prompt cost without saver</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{usd(calc.cost)}</div>
            <div className="text-[12px] text-fg-3">{num(calc.tokens)} tokens</div>
          </div>
          <div className="rounded-2xl border border-good/25 bg-good-soft p-4">
            <div className="text-[12.5px] text-fg-3">Saved per month</div>
            <div className="mt-1 text-2xl font-semibold text-good tabular-nums">{usd(calc.savedCost)}</div>
            <div className="text-[12px] text-fg-3">{num(calc.savedTokens)} tokens · {usd(calc.savedCost * 12)} per year</div>
          </div>
        </div>
        <Meter ratio={ratio} tone="good" />
      </div>
    </Card>
  );
}
