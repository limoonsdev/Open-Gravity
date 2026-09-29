'use client';
// Get started: a short guided setup shown on first run (and from the command
// palette). Add providers (detected local engines, free tiers, paid APIs),
// choose what the default model routes to, connect tools, done.
import { ArrowLeft, ArrowRight, Blocks, Check, CheckCircle2, Gift, Globe, Laptop, Layers, Plus, Radar, Route, Sparkles, Wand2, Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AddProviderDialog, FreeBadge } from '@/components/add-provider';
import { AppLogo, ProviderLogo } from '@/components/logos';
import { ModelPicker } from '@/components/model-picker';
import { Badge, Button, CopyButton, Spinner, useRun } from '@/components/ui';
import { post, put } from '@/lib/api';
import { cn, plural } from '@/lib/format';
import { LOGOS } from '@/lib/logos';
import { useApp, useAppState, useResource } from '@/lib/state';
import type { CatalogEntry, Combo, LocalEngine, ToolInfo } from '@/lib/types';

const STEPS = ['Welcome', 'Providers', 'Route', 'Tools', 'Done'] as const;
const FREE_PICKS = ['gemini', 'groq', 'openrouter', 'cerebras', 'github', 'mistral', 'nvidia', 'pollinations'];
const PAID_PICKS = ['openai', 'anthropic', 'deepseek', 'xai', 'zai'];

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center justify-center gap-1.5 sm:gap-2" aria-label="Setup progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5 sm:gap-2">
          <span
            aria-current={i === step ? 'step' : undefined}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors',
              i === step ? 'bg-accent text-white shadow-[0_4px_16px_-4px_var(--og-accent)]' : i < step ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-fg-3',
            )}
          >
            {i < step ? <Check className="size-3.5" /> : <span className="tabular-nums">{i + 1}</span>}
            <span className={cn(i === step ? 'inline' : 'hidden sm:inline')}>{s}</span>
          </span>
          {i < STEPS.length - 1 && <span className={cn('h-px w-3 sm:w-6', i < step ? 'bg-accent/50' : 'bg-line-strong')} />}
        </li>
      ))}
    </ol>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('animate-in rounded-[28px] border border-line bg-surface/85 p-6 shadow-[0_24px_80px_-32px_rgb(0_0_0/0.45)] backdrop-blur-xl sm:p-9', className)}>{children}</div>;
}

function Heading({ icon, title, sub }: { icon: ReactNode; title: ReactNode; sub: ReactNode }) {
  return (
    <div className="mb-7 flex items-start gap-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">{icon}</span>
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-fg-3">{sub}</p>
      </div>
    </div>
  );
}

function Footer({ onBack, onNext, next = 'Continue', nextDisabled, extra }: { onBack?: () => void; onNext: () => void; next?: ReactNode; nextDisabled?: boolean; extra?: ReactNode }) {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-6">
      {onBack && <Button variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-4" />}>Back</Button>}
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {extra}
        <Button variant="primary" size="lg" className="!rounded-full !px-6" disabled={nextDisabled} onClick={onNext}>
          {next} <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- steps

function Hero({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const state = useAppState();
  const features = [
    { icon: <Layers className="size-4" />, title: `${state.catalog.length}+ providers`, text: 'OpenAI, Anthropic, Gemini, DeepSeek, local engines, gateways, and any compatible API.' },
    { icon: <Gift className="size-4" />, title: 'Free to start', text: 'Chain official free tiers and free models into one model that never stops.' },
    { icon: <Blocks className="size-4" />, title: 'Every tool', text: 'Claude Code, Codex, Cursor, Cline, Continue, Open WebUI… in one click, or any OpenAI / Anthropic / Gemini / Ollama client.' },
  ];
  return (
    <div className="animate-in flex flex-col items-center text-center">
      <div className="relative mb-8">
        <div className="absolute inset-[-28px] rounded-full bg-[radial-gradient(circle,rgb(139_92_246/0.35),transparent_65%)] blur-xl" />
        <div className="absolute inset-[-14px] rounded-full border border-dashed border-accent/25 [animation:og-orbit_28s_linear_infinite]" />
        <AppLogo size={112} className="relative drop-shadow-[0_18px_40px_rgb(76_29_149/0.55)]" />
      </div>
      <p className="mb-3 text-[12px] font-semibold tracking-[0.18em] text-fg-3 uppercase">Open Gravity {state.version}</p>
      <h1 className="max-w-2xl text-[34px] leading-[1.1] font-semibold tracking-tight sm:text-[44px]">
        Every AI model, <span className="brand-text">one endpoint</span>.
      </h1>
      <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-fg-3">
        A local router for all your AI providers and tools: automatic fallback, key rotation, tool calling everywhere, token saving and full usage analytics.
      </p>
      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" size="lg" className="!h-12 !rounded-full !px-8 !text-[15px] shadow-[0_12px_32px_-12px_var(--og-accent)]" onClick={onStart}>
          Get started <ArrowRight className="size-4" />
        </Button>
        <Button variant="ghost" size="lg" className="!rounded-full" onClick={onSkip}>I’ll set it up myself</Button>
      </div>
      <div className="mt-12 grid w-full max-w-4xl gap-3 text-left sm:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-[22px] border border-line bg-surface/70 p-5 backdrop-blur">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">{f.icon}</span>
            <h3 className="mt-3 text-[14.5px] font-semibold">{f.title}</h3>
            <p className="mt-1 text-[13px] leading-snug text-fg-3">{f.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PickCard({ t, added, onAdd, busy }: { t: CatalogEntry; added: boolean; onAdd: () => void; busy?: boolean }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-[18px] border p-3 transition-colors', added ? 'border-good/30 bg-good-soft/60' : 'border-line bg-surface-2/40 hover:border-line-strong')}>
      <ProviderLogo type={t.type} name={t.name} color={t.color} size={38} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold">{t.name}</div>
        {t.free ? <div className="mt-0.5"><FreeBadge kind={t.free.kind} /></div> : <div className="truncate text-[12px] text-fg-3">{t.models[0] || t.description}</div>}
      </div>
      {added ? (
        <Badge tone="good" icon={<Check className="size-3" />}>added</Badge>
      ) : (
        <Button size="sm" loading={busy} onClick={onAdd} icon={<Plus className="size-3.5" />}>Add</Button>
      )}
    </div>
  );
}

function ProvidersStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const state = useAppState();
  const { refresh } = useApp();
  const run = useRun();
  const [dialog, setDialog] = useState<{ open: boolean; type?: string }>({ open: false });
  const [busy, setBusy] = useState<string | null>(null);
  const { data: engines, loading: scanning, reload: rescan } = useResource<LocalEngine[]>('/local/detect');
  const byType = useMemo(() => new Map(state.catalog.map((c) => [c.type, c])), [state.catalog]);
  const added = (type: string) => state.providers.some((p) => p.type === type);
  const picks = (ids: string[]) => ids.map((id) => byType.get(id)).filter((x): x is CatalogEntry => !!x);

  const quickAdd = async (t: CatalogEntry) => {
    // No key and no URL variables: add directly. Otherwise ask for the key.
    if (t.keyOptional && !t.vars?.length) {
      setBusy(t.type);
      await run(() => post('/providers', { type: t.type }), `${t.name} added`);
      setBusy(null);
      refresh();
    } else setDialog({ open: true, type: t.type });
  };
  const addEngine = async (e: LocalEngine) => {
    setBusy(e.baseUrl);
    await run(() => post('/providers', { type: e.type, baseUrl: e.baseUrl, models: e.models }), `${e.name} added`);
    setBusy(null);
    await refresh();
    rescan();
  };

  return (
    <Panel>
      <Heading icon={<Layers className="size-5" />} title="Add your AI providers" sub="Add as many as you like: Open Gravity rotates keys, pauses the ones that hit limits and falls back to the next provider automatically." />

      <section className="mb-7">
        <div className="mb-3 flex items-center gap-2">
          <Radar className="size-4 text-fg-3" />
          <h2 className="text-[13px] font-semibold">Running on this computer</h2>
          <button className="ml-auto text-[12.5px] text-accent hover:underline" onClick={() => rescan()}>Scan again</button>
        </div>
        {scanning && !engines ? (
          <div className="flex items-center gap-2.5 rounded-[18px] border border-dashed border-line px-4 py-3.5 text-[13px] text-fg-3"><Spinner className="size-4" /> Looking for Ollama, LM Studio, llama.cpp, vLLM, Jan…</div>
        ) : engines?.length ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {engines.map((e) => {
              const t = byType.get(e.type);
              return (
                <div key={e.baseUrl} className={cn('flex items-center gap-3 rounded-[18px] border p-3', e.configured ? 'border-good/30 bg-good-soft/60' : 'border-line bg-surface-2/40')}>
                  <ProviderLogo type={e.type} name={e.name} color={t?.color} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold">{e.name}</div>
                    <div className="truncate text-[12px] text-fg-3">{plural(e.models.length, 'model')} · {e.baseUrl.replace(/^https?:\/\//, '')}</div>
                  </div>
                  {e.configured ? <Badge tone="good" icon={<Check className="size-3" />}>added</Badge> : <Button size="sm" loading={busy === e.baseUrl} onClick={() => addEngine(e)} icon={<Plus className="size-3.5" />}>Add</Button>}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-[18px] border border-dashed border-line px-4 py-3.5 text-[13px] text-fg-3">
            <Laptop className="mr-1.5 inline size-4 align-[-3px]" /> No local engine found. Start Ollama or LM Studio to use models on your own machine, for free and offline.
          </p>
        )}
      </section>

      <section className="mb-7">
        <div className="mb-3 flex items-center gap-2"><Gift className="size-4 text-good" /><h2 className="text-[13px] font-semibold">Free to start</h2><span className="text-[12.5px] text-fg-3">official free tiers and free models</span></div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {picks(FREE_PICKS).map((t) => <PickCard key={t.type} t={t} added={added(t.type)} busy={busy === t.type} onAdd={() => quickAdd(t)} />)}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2"><Sparkles className="size-4 text-fg-3" /><h2 className="text-[13px] font-semibold">Popular APIs</h2></div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {picks(PAID_PICKS).map((t) => <PickCard key={t.type} t={t} added={added(t.type)} onAdd={() => quickAdd(t)} />)}
          <button onClick={() => setDialog({ open: true })} className="flex items-center justify-center gap-2 rounded-[18px] border border-dashed border-line-strong p-3 text-[13.5px] font-medium text-fg-2 transition-colors hover:border-accent hover:text-accent">
            <Plus className="size-4" /> Browse all {state.catalog.length} providers
          </button>
        </div>
      </section>

      <AddProviderDialog open={dialog.open} initialType={dialog.type} onClose={() => setDialog({ open: false })} />
      <Footer
        onBack={onBack}
        onNext={onNext}
        next={state.providers.length ? 'Continue' : 'Skip for now'}
        extra={state.providers.length > 0 && <span className="text-[13px] text-fg-3">{plural(state.providers.length, 'provider')} ready</span>}
      />
    </Panel>
  );
}

type RouteChoice = 'free' | 'all' | 'model';

function RouteStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const state = useAppState();
  const { refresh } = useApp();
  const run = useRun();
  const hasFree = state.providers.some((p) => state.catalog.find((c) => c.type === p.type)?.free);
  const [choice, setChoice] = useState<RouteChoice>(hasFree ? 'free' : state.providers.length > 1 ? 'all' : 'model');
  const [model, setModel] = useState(state.settings.defaultModel || state.effectiveDefault || '');
  const [saving, setSaving] = useState(false);

  // One target per provider: its first known model.
  const allTargets = useMemo(() => state.providers.filter((p) => p.enabled && p.models.length).map((p) => `${p.id}/${p.models[0]}`), [state.providers]);

  const apply = async () => {
    setSaving(true);
    let ok: unknown = true;
    if (choice === 'free') ok = await run(() => post<Combo>('/free/combo', { makeDefault: true }), 'The free combo is now your default model');
    else if (choice === 'all') {
      ok = await run(async () => {
        const id = 'main';
        if (state.combos.some((c) => c.id === id)) await put(`/combos/${id}`, { targets: allTargets, strategy: 'fallback', enabled: true });
        else await post('/combos', { id, targets: allTargets, strategy: 'fallback', description: 'Created by Get started' });
        await put('/settings', { defaultModel: id });
      }, 'Combo “main” is now your default model');
    } else if (model) ok = await run(() => put('/settings', { defaultModel: model }), 'Default model saved');
    setSaving(false);
    if (ok !== undefined) {
      await refresh();
      onNext();
    }
  };

  const options: Array<{ id: RouteChoice; icon: ReactNode; title: string; text: string; disabled?: boolean }> = [
    { id: 'free', icon: <Gift className="size-5" />, title: 'Free combo', text: 'Chains every free tier, free model and local engine you added; moves on when a quota runs out.', disabled: !hasFree },
    { id: 'all', icon: <Route className="size-5" />, title: 'All my providers', text: `A fallback chain over ${plural(allTargets.length, 'provider')}: if one fails or is rate limited, the next answers.`, disabled: allTargets.length < 2 },
    { id: 'model', icon: <Zap className="size-5" />, title: 'One model', text: 'Send everything to a single model. You can build combos later.', disabled: !state.providers.length },
  ];

  return (
    <Panel>
      <Heading icon={<Route className="size-5" />} title="Choose your default model" sub="Tools that ask for an unknown model, or no model, get this one. Every provider model stays usable by name (provider/model)." />
      <div className="grid gap-3 sm:grid-cols-3">
        {options.map((o) => (
          <button
            key={o.id}
            disabled={o.disabled}
            onClick={() => setChoice(o.id)}
            className={cn(
              'relative flex flex-col items-start gap-3 rounded-[22px] border p-5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-45',
              choice === o.id && !o.disabled ? 'border-accent bg-accent-soft/60 shadow-[0_0_0_3px_var(--og-accent-soft)]' : 'border-line bg-surface-2/40 hover:border-line-strong',
            )}
          >
            <span className={cn('flex size-10 items-center justify-center rounded-2xl', choice === o.id ? 'bg-accent text-white' : 'bg-surface-3 text-fg-2')}>{o.icon}</span>
            <span className="text-[15px] font-semibold">{o.title}</span>
            <span className="text-[12.5px] leading-snug text-fg-3">{o.text}</span>
            {choice === o.id && !o.disabled && <CheckCircle2 className="absolute top-4 right-4 size-5 text-accent" />}
          </button>
        ))}
      </div>
      {choice === 'model' && state.providers.length > 0 && (
        <div className="mt-5 max-w-md"><ModelPicker value={model} onChange={setModel} /></div>
      )}
      {!state.providers.length && <p className="mt-5 text-[13px] text-fg-3">Add a provider first to choose a default model, or continue and do it later.</p>}
      <Footer
        onBack={onBack}
        onNext={state.providers.length ? apply : onNext}
        next={saving ? 'Saving…' : state.providers.length ? 'Save and continue' : 'Continue'}
        nextDisabled={saving || (choice === 'model' && !model && state.providers.length > 0)}
      />
    </Panel>
  );
}

function ToolsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const state = useAppState();
  const run = useRun();
  const m = state.effectiveDefault || '';
  const { data, reload } = useResource<ToolInfo[]>(`/integrations${m ? `?model=${encodeURIComponent(m)}` : ''}`, [m]);
  const [busy, setBusy] = useState<string | null>(null);
  const tools = (data || []).filter((t) => t.category !== 'universal' && t.canApply);
  const shown = [...tools.filter((t) => t.detected), ...tools.filter((t) => !t.detected)].slice(0, 8);
  const endpoints = [
    ['OpenAI-compatible', `${state.baseUrl}/v1`],
    ['Anthropic', state.baseUrl],
    ['Gemini', `${state.baseUrl}/v1beta`],
    ['Ollama', state.baseUrl],
  ];

  const apply = async (t: ToolInfo) => {
    setBusy(t.id);
    await run(() => post(`/integrations/${encodeURIComponent(t.id)}/apply`, { model: m, smallModel: m }), `${t.name} now uses Open Gravity`);
    setBusy(null);
    reload();
  };

  return (
    <Panel>
      <Heading icon={<Blocks className="size-5" />} title="Connect your tools" sub="One click writes the tool’s configuration (a backup is kept). Anything else works with the endpoints below — no API key needed on this computer." />
      <div className="grid gap-2.5 sm:grid-cols-2">
        {!data ? (
          <div className="col-span-full flex justify-center py-8"><Spinner /></div>
        ) : (
          shown.map((t) => (
            <div key={t.id} className={cn('flex items-center gap-3 rounded-[18px] border p-3', t.applied ? 'border-good/30 bg-good-soft/60' : 'border-line bg-surface-2/40')}>
              <ProviderLogo type={LOGOS[`tool-${t.id}`] ? `tool-${t.id}` : ''} name={t.name} color="#6366f1" size={38} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold">{t.name}{t.detected && !t.applied && <Badge tone="info">detected</Badge>}</div>
                <div className="truncate text-[12px] text-fg-3">{t.description}</div>
              </div>
              {t.applied ? <Badge tone="good" icon={<Check className="size-3" />}>connected</Badge> : <Button size="sm" loading={busy === t.id} disabled={!m} onClick={() => apply(t)} icon={<Wand2 className="size-3.5" />}>Connect</Button>}
            </div>
          ))
        )}
      </div>
      <div className="mt-6 rounded-[22px] border border-line bg-surface-2/50 p-5">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold"><Globe className="size-4 text-fg-3" /> Universal endpoints — for any IDE, app or SDK</div>
        <div className="space-y-2">
          {endpoints.map(([label, url]) => (
            <div key={label} className="flex items-center gap-3 text-[13px]">
              <span className="w-36 shrink-0 text-fg-3">{label}</span>
              <span className="min-w-0 flex-1 truncate rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[12.5px]">{url}</span>
              <CopyButton text={url} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-fg-3">API key: any value (e.g. <span className="font-mono">open-gravity</span>) unless you require keys. Model: <span className="font-mono">{m || 'any provider/model'}</span>.</p>
      </div>
      <Footer onBack={onBack} onNext={onNext} next="Finish" extra={<Link href="/integrations/" className="text-[13px] text-accent hover:underline">All {(data || []).length} integrations</Link>} />
    </Panel>
  );
}

function DoneStep({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) {
  const state = useAppState();
  const [reply, setReply] = useState<{ ok: boolean; text: string; ms: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const test = async () => {
    setTesting(true);
    const t0 = performance.now();
    try {
      const r = await post<any>('/playground', { model: state.effectiveDefault, messages: [{ role: 'user', content: 'Say hello in five words.' }], max_tokens: 60 });
      setReply({ ok: true, text: String(r?.choices?.[0]?.message?.content || '').trim() || '(empty reply)', ms: Math.round(performance.now() - t0) });
    } catch (e: any) {
      setReply({ ok: false, text: e?.message || 'Request failed', ms: Math.round(performance.now() - t0) });
    }
    setTesting(false);
  };
  const facts = [
    { label: 'Providers', value: String(state.providers.length) },
    { label: 'Default model', value: state.effectiveDefault || '—' },
    { label: 'Endpoint', value: `${state.baseUrl}/v1` },
  ];
  return (
    <Panel className="text-center">
      <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-[22px] bg-good-soft text-good"><CheckCircle2 className="size-8" /></div>
      <h1 className="text-[26px] font-semibold tracking-tight">You’re all set</h1>
      <p className="mx-auto mt-2 max-w-md text-[14px] text-fg-3">Open Gravity keeps running in the background. Everything can be changed later from the dashboard.</p>
      <div className="mx-auto mt-7 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label} className="rounded-[18px] border border-line bg-surface-2/50 px-4 py-3">
            <div className="text-[11.5px] font-medium tracking-wide text-fg-3 uppercase">{f.label}</div>
            <div className="mt-1 truncate font-mono text-[13px]" title={f.value}>{f.value}</div>
          </div>
        ))}
      </div>
      {state.effectiveDefault && (
        <div className="mx-auto mt-5 max-w-2xl text-left">
          <Button onClick={test} loading={testing} icon={<Sparkles className="size-4" />}>Send a test message</Button>
          {reply && (
            <div className={cn('animate-in mt-3 rounded-[18px] border px-4 py-3 text-[13.5px]', reply.ok ? 'border-good/30 bg-good-soft/50' : 'border-bad/30 bg-bad-soft/50')}>
              <span className="mr-2 text-[12px] text-fg-3 tabular-nums">{reply.ms} ms</span>{reply.text}
            </div>
          )}
        </div>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3 border-t border-line pt-6">
        <Button variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-4" />}>Back</Button>
        <Button variant="primary" size="lg" className="!h-12 !rounded-full !px-8" onClick={onFinish}>Open the dashboard <ArrowRight className="size-4" /></Button>
      </div>
    </Panel>
  );
}

export default function WelcomePage() {
  const router = useRouter();
  const { refresh } = useApp();
  const [step, setStep] = useState(0);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const finish = async () => {
    await put('/settings', { onboarded: true }).catch(() => undefined);
    await refresh();
    router.push('/');
  };
  return (
    <div className="og-hero relative min-h-dvh overflow-x-hidden">
      <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-4 pt-14 pb-10 sm:px-6">
        {step > 0 && (
          <div className="mb-8 flex items-center gap-3">
            <AppLogo size={30} />
            <div className="flex-1"><Stepper step={step} /></div>
            <button className="text-[12.5px] text-fg-3 hover:text-fg" onClick={finish}>Skip setup</button>
          </div>
        )}
        <div className={cn('flex-1', step === 0 && 'flex items-center')}>
          {step === 0 && <Hero onStart={() => setStep(1)} onSkip={finish} />}
          {step === 1 && <ProvidersStep onBack={() => setStep(0)} onNext={() => setStep(2)} />}
          {step === 2 && <RouteStep onBack={() => setStep(1)} onNext={() => setStep(3)} />}
          {step === 3 && <ToolsStep onBack={() => setStep(2)} onNext={() => setStep(4)} />}
          {step === 4 && <DoneStep onBack={() => setStep(3)} onFinish={finish} />}
        </div>
      </div>
    </div>
  );
}
