'use client';
import { AlertTriangle, Bell, Gauge, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ProviderLogo } from '@/components/logos';
import { RateLimitList } from '@/components/provider-editor';
import { Badge, Button, Card, CardHeader, Empty, Field, IconButton, Input, Meter, Modal, PageHeader, Select, Spinner, Switch, Tabs, useRun } from '@/components/ui';
import { enc, post, put } from '@/lib/api';
import { ago, money, num, until, usd } from '@/lib/format';
import { useAppState, useResource } from '@/lib/state';
import type { Analytics, Balance, LimitPeriod, LimitRule, LimitScope, LimitStatus, QuotaView } from '@/lib/types';

type Tab = 'limits' | 'provider' | 'balances' | 'alerts';

const SCOPES: Record<LimitScope, string> = {
  global: 'Everything',
  provider: 'A provider',
  key: 'A provider key',
  model: 'A model (wildcards allowed)',
  apikey: 'A router API key (a person or app)',
  client: 'A client app (Claude Code, Cursor…)',
};
const PERIODS: LimitPeriod[] = ['minute', 'hour', 'day', 'week', 'month'];

function newRule(): LimitRule {
  return { id: Math.random().toString(36).slice(2, 10), scope: 'provider', target: '', period: 'day', action: 'block', enabled: true };
}

function RuleEditor({ rule, onSave, onClose }: { rule: LimitRule | null; onSave: (r: LimitRule) => void; onClose: () => void }) {
  const state = useAppState();
  const { data: analytics } = useResource<Analytics>(rule ? '/analytics?range=30d' : null);
  const [r, setR] = useState<LimitRule>(rule || newRule());
  useEffect(() => setR(rule || newRule()), [rule]);
  const set = <K extends keyof LimitRule>(k: K, v: LimitRule[K]) => setR({ ...r, [k]: v });
  const num = (v: string) => (v.trim() ? Number(v) : undefined);
  const targetInput = () => {
    switch (r.scope) {
      case 'global':
        return <p className="text-[13px] text-fg-3">Counts every request.</p>;
      case 'provider':
        return (
          <Select value={r.target} onChange={(e) => set('target', e.target.value)}>
            <option value="">Choose a provider…</option>
            {state.providers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
          </Select>
        );
      case 'key':
        return (
          <Select value={r.target} onChange={(e) => set('target', e.target.value)}>
            <option value="">Choose a key…</option>
            {state.providers.flatMap((p) => p.keys.map((k, i) => <option key={`${p.id}:${k.id}`} value={`${p.id}:${k.id}`}>{p.name} · {k.label || `key ${i + 1}`} ({k.masked})</option>))}
          </Select>
        );
      case 'model':
        return <Input className="font-mono" value={r.target} onChange={(e) => set('target', e.target.value)} placeholder="anthropic/claude-opus-* or gpt-5*" />;
      case 'apikey':
        return (
          <Select value={r.target} onChange={(e) => set('target', e.target.value)}>
            <option value="">Choose a router key…</option>
            {state.apiKeys.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.masked})</option>)}
          </Select>
        );
      case 'client': {
        const known = analytics?.byClient || [];
        return (
          <>
            <Input className="font-mono" list="og-clients" value={r.target} onChange={(e) => set('target', e.target.value)} placeholder="claude-code, cursor, codex…" />
            <datalist id="og-clients">{known.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</datalist>
          </>
        );
      }
    }
  };
  const valid = (r.scope === 'global' || r.target.trim()) && (r.maxRequests || r.maxTokens || r.maxCost);
  return (
    <Modal
      open={!!rule}
      onClose={onClose}
      title={rule?.target || rule?.name ? 'Edit limit' : 'New limit'}
      sub="Budgets are counted per calendar period (local time) and reset automatically."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} onClick={() => onSave(r)}>Save limit</Button></>}
    >
      <div className="space-y-4">
        <Field label="Name (optional)"><Input value={r.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Daily budget for Opus" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Applies to">
            <Select value={r.scope} onChange={(e) => setR({ ...r, scope: e.target.value as LimitScope, target: '' })}>
              {Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Target">{targetInput()}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Per">
            <Select value={r.period} onChange={(e) => set('period', e.target.value as LimitPeriod)}>{PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}</Select>
          </Field>
          <Field label="Max requests"><Input type="number" min={1} value={r.maxRequests ?? ''} onChange={(e) => set('maxRequests', num(e.target.value))} placeholder="—" /></Field>
          <Field label="Max tokens"><Input type="number" min={1} value={r.maxTokens ?? ''} onChange={(e) => set('maxTokens', num(e.target.value))} placeholder="—" /></Field>
          <Field label="Max cost ($)"><Input type="number" min={0} step="0.01" value={r.maxCost ?? ''} onChange={(e) => set('maxCost', num(e.target.value))} placeholder="—" /></Field>
        </div>
        <Field label="When the limit is reached">
          <Select value={r.action} onChange={(e) => set('action', e.target.value as 'block' | 'warn')}>
            <option value="block">Stop routing there (combos fall back to other targets; clients get 429 for client/key budgets)</option>
            <option value="warn">Only warn (alert at 80% and 100%)</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function LimitCard({ s, onEdit, onToggle, onDelete }: { s: LimitStatus; onEdit: () => void; onToggle: (v: boolean) => void; onDelete: () => void }) {
  const state = useAppState();
  const r = s.rule;
  const p = r.scope === 'provider' || r.scope === 'key' ? state.providers.find((x) => x.id === r.target.split(':')[0]) : undefined;
  const parts = [
    r.maxRequests && { label: 'Requests', used: s.requests, max: r.maxRequests, fmt: num },
    r.maxTokens && { label: 'Tokens', used: s.tokens, max: r.maxTokens, fmt: num },
    r.maxCost && { label: 'Cost', used: s.cost, max: r.maxCost, fmt: (v: number) => usd(v) },
  ].filter(Boolean) as Array<{ label: string; used: number; max: number; fmt: (v: number) => string }>;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        {p ? <ProviderLogo type={p.type} name={p.name} color={p.color} size={32} /> : <span className="flex size-8 items-center justify-center rounded-[10px] bg-surface-2 text-fg-3 ring-1 ring-line"><ShieldCheck className="size-4" /></span>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-semibold">{r.name || `${SCOPES[r.scope].replace(/ \(.*/, '')}${r.target ? `: ${r.target}` : ''}`}</div>
          <div className="text-[12px] text-fg-3">per {r.period}{s.windowEnd ? ` · resets ${until(s.windowEnd)}` : ' · paused'} · {r.action === 'block' ? 'blocks when reached' : 'warns only'}</div>
        </div>
        {s.exceeded && <Badge tone="bad" icon={<AlertTriangle className="size-3" />}>limit reached</Badge>}
        <Switch checked={r.enabled} onChange={onToggle} />
        <IconButton label="Edit" onClick={onEdit}><Pencil className="size-4" /></IconButton>
        <IconButton label="Delete" onClick={onDelete}><Trash2 className="size-4" /></IconButton>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {parts.map((x) => (
          <div key={x.label}>
            <div className="mb-1 flex text-[12.5px]"><span className="text-fg-2">{x.label}</span><span className="ml-auto font-medium tabular-nums">{x.fmt(x.used)} / {x.fmt(x.max)}</span></div>
            <Meter ratio={x.used / x.max} />
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function QuotasPage() {
  const state = useAppState();
  const run = useRun();
  const [tab, setTab] = useState<Tab>('limits');
  const { data, reload } = useResource<QuotaView>('/quota');
  const [editing, setEditing] = useState<LimitRule | null>(null);
  const [balances, setBalances] = useState<Record<string, Balance[] | 'loading'>>({});

  const rules = useMemo(() => data?.rules || [], [data]);
  // Status (usage in the current window) exists for enabled rules; disabled ones show zero.
  const statusOf = (r: LimitRule): LimitStatus => data?.limits.find((s) => s.rule.id === r.id) || { rule: r, windowStart: 0, windowEnd: 0, requests: 0, tokens: 0, cost: 0, ratio: 0, exceeded: false };
  const saveRules = async (next: LimitRule[]) => {
    await run(() => put('/limits', { limits: next }), 'Limits saved');
    await reload();
  };
  const loadBalance = async (id: string, refresh = false) => {
    setBalances((b) => ({ ...b, [id]: 'loading' }));
    const r = await run(() => post<Balance[]>(`/providers/${enc(id)}/balance`, { refresh }));
    setBalances((b) => ({ ...b, [id]: r || [] }));
  };
  useEffect(() => {
    if (tab === 'balances') for (const id of data?.balanceProviders || []) if (!balances[id]) loadBalance(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, data]);

  return (
    <>
      <PageHeader
        title="Quotas & limits"
        sub="What providers report (rate limits, credits) and what you allow (budgets per provider, key, model, person or app). Exhausted keys are skipped before a call fails."
        actions={<Button icon={<RefreshCw className="size-4" />} onClick={reload}>Refresh</Button>}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'limits', label: 'Budgets & limits', count: rules.length || undefined },
          { value: 'provider', label: 'Provider rate limits', count: data?.snapshots.length || undefined },
          { value: 'balances', label: 'Balances', count: data?.balanceProviders.length || undefined },
          { value: 'alerts', label: 'Alerts', count: data?.alerts.length || undefined },
        ]}
      />
      <div className="mt-5">
        {!data ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : tab === 'limits' ? (
          <div className="space-y-3">
            <div className="flex"><Button variant="primary" className="ml-auto" icon={<Plus className="size-4" />} onClick={() => setEditing(newRule())}>New limit</Button></div>
            {rules.map((rule) => (
              <LimitCard
                key={rule.id}
                s={statusOf(rule)}
                onEdit={() => setEditing(rule)}
                onToggle={(v) => saveRules(rules.map((r) => (r.id === rule.id ? { ...r, enabled: v } : r)))}
                onDelete={() => saveRules(rules.filter((r) => r.id !== rule.id))}
              />
            ))}
            {!rules.length && (
              <Card>
                <Empty icon={<Gauge className="size-5" />} title="No limit yet"
                  sub="Examples: $5 per day on Anthropic, 1,000 requests per day on a free tier, 2M tokens per month for a teammate's router key, or pausing Claude Code after $20 this week." />
              </Card>
            )}
          </div>
        ) : tab === 'provider' ? (
          data.snapshots.length ? <RateLimitList snaps={data.snapshots} /> : (
            <Card><Empty icon={<Gauge className="size-5" />} title="No rate-limit headers seen yet" sub="Providers such as OpenAI, Anthropic, Groq, Cerebras and OpenRouter report remaining requests and tokens with each response; they appear here after the first calls." /></Card>
          )
        ) : tab === 'balances' ? (
          data.balanceProviders.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {data.balanceProviders.map((id) => {
                const p = state.providers.find((x) => x.id === id)!;
                const b = balances[id];
                return (
                  <Card key={id}>
                    <CardHeader title={p?.name || id} icon={p ? <ProviderLogo type={p.type} name={p.name} color={p.color} size={24} rounded="rounded-md" /> : undefined}
                      actions={<Button size="sm" variant="ghost" loading={b === 'loading'} icon={<RefreshCw className="size-3.5" />} onClick={() => loadBalance(id, true)}>Refresh</Button>} />
                    <div className="space-y-3 p-5">
                      {b === 'loading' || !b ? <Spinner /> : b.map((x) => (
                        <div key={x.keyId}>
                          <div className="flex items-center gap-2 text-[12.5px] text-fg-3"><Wallet className="size-3.5" />{x.keyLabel}<span className="ml-auto">{ago(x.at)}</span></div>
                          {x.ok ? (
                            <>
                              <div className="mt-1 text-2xl font-semibold tabular-nums">{x.remaining !== undefined ? money(x.remaining, x.currency) : '—'}</div>
                              <div className="text-[12px] text-fg-3">{x.limit !== undefined ? `of ${money(x.limit, x.currency)}` : ''}{x.used !== undefined ? ` · ${money(x.used, x.currency)} used` : ''}{x.note ? ` · ${x.note}` : ''}</div>
                              {x.limit ? <Meter className="mt-2" ratio={(x.used || 0) / x.limit} /> : null}
                            </>
                          ) : <p className="mt-1 text-[12.5px] text-bad">{x.error}</p>}
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card><Empty icon={<Wallet className="size-5" />} title="No provider with a balance API" sub="OpenRouter, DeepSeek, Moonshot, SiliconFlow and one-api / new-api relays report their remaining credit. Add one of them to see it here." /></Card>
          )
        ) : (
          <div className="space-y-2">
            {data.alerts.map((a, i) => (
              <Card key={i} className="flex items-center gap-3 px-5 py-3">
                <Bell className={a.level === 'exceeded' ? 'size-4 text-bad' : 'size-4 text-warn'} />
                <span className="flex-1 text-[13.5px]">{a.message}</span>
                <span className="text-[12px] text-fg-3">{ago(a.at)}</span>
              </Card>
            ))}
            {!data.alerts.length && <Card><Empty icon={<Bell className="size-5" />} title="No alert" sub="You are alerted when a limit reaches 80% and 100%." /></Card>}
          </div>
        )}
      </div>
      <RuleEditor
        rule={editing}
        onClose={() => setEditing(null)}
        onSave={async (r) => {
          const exists = rules.some((x) => x.id === r.id);
          await saveRules(exists ? rules.map((x) => (x.id === r.id ? r : x)) : [...rules, r]);
          setEditing(null);
        }}
      />
    </>
  );
}

