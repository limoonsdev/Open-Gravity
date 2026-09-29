'use client';
import { Copy, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, CardHeader, Code, CopyButton, Empty, Field, IconButton, Input, Modal, PageHeader, Switch, useConfirm, useRun, useToast } from '@/components/ui';
import { del, enc, post, put } from '@/lib/api';
import { ago } from '@/lib/format';
import { useApp, useAppState } from '@/lib/state';

export default function KeysPage() {
  const state = useAppState();
  const { refresh } = useApp();
  const run = useRun();
  const toast = useToast();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);

  const create = async () => {
    const r = await run(() => post<{ name: string; key: string }>('/keys', { name: name.trim() || 'key' }));
    if (r) {
      setCreated(r);
      setCreating(false);
      setName('');
      refresh();
    }
  };
  const copyKey = async (id: string) => {
    const r = await run(() => post<{ key: string }>(`/keys/${enc(id)}/reveal`));
    if (r) {
      await navigator.clipboard.writeText(r.key).catch(() => undefined);
      toast('Key copied to the clipboard');
    }
  };

  return (
    <>
      <PageHeader
        title="API keys"
        sub="Keys for the router itself: give one to each person, machine or app. Usage per key shows in Analytics, and Quotas can budget each key."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Create key</Button>}
      />
      <Card className="mb-4">
        <CardHeader title="Access" icon={<ShieldCheck className="size-4" />} />
        <div className="space-y-3 p-5">
          <Switch
            checked={state.settings.requireApiKey}
            onChange={async (v) => {
              if (v && !state.apiKeys.some((k) => k.enabled)) {
                toast('Create a key first, then require it.', 'bad');
                return;
              }
              await run(() => put('/settings', { requireApiKey: v }), v ? 'API keys are now required' : 'Local requests no longer need a key');
              refresh();
            }}
            label="Require an API key for every request, even from this computer"
            sub="Remote machines and browser pages from other sites always need a key. The dashboard itself never needs one."
          />
          <p className="text-[12.5px] text-fg-3">Send it as <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>, <span className="font-mono">x-api-key</span>, <span className="font-mono">api-key</span>, <span className="font-mono">x-goog-api-key</span> or <span className="font-mono">?key=</span> — every client style works.</p>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {state.apiKeys.length ? (
          <ul className="divide-y divide-line">
            {state.apiKeys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent"><KeyRound className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="text-[14px] font-medium">{k.name}</span>{!k.enabled && <Badge>disabled</Badge>}</div>
                  <div className="font-mono text-[12px] text-fg-3">{k.masked} · created {ago(k.createdAt)} · id {k.id}</div>
                </div>
                <Button size="sm" onClick={() => copyKey(k.id)} icon={<Copy className="size-3.5" />}>Copy key</Button>
                <Switch checked={k.enabled} onChange={async (v) => { await run(() => put(`/keys/${enc(k.id)}`, { enabled: v })); refresh(); }} />
                <IconButton label="Delete key" onClick={async () => {
                  if (await confirm({ title: `Delete “${k.name}”?`, body: 'Clients using it will get 401 errors.', confirm: 'Delete', danger: true })) {
                    await run(() => del(`/keys/${enc(k.id)}`), 'Key deleted');
                    refresh();
                  }
                }}><Trash2 className="size-4" /></IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={<KeyRound className="size-5" />} title="No router key" sub="Not needed on this computer. Create one to use the router from another machine, a Docker container, a tunnel (Cursor), or to track usage per person." />
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Create a router key" size="sm"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" onClick={create}>Create</Button></>}>
        <Field label="Name" hint="Who or what uses it, e.g. laptop, ci, alice."><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="laptop" onKeyDown={(e) => e.key === 'Enter' && create()} /></Field>
      </Modal>
      <Modal open={!!created} onClose={() => setCreated(null)} title={`Key “${created?.name}” created`} sub="Copy it now: it can be copied again later from this page." size="md"
        footer={<Button variant="primary" onClick={() => setCreated(null)}>Done</Button>}>
        {created && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-mono text-[13px]"><span className="min-w-0 flex-1 break-all">{created.key}</span><CopyButton text={created.key} /></div>
            <Code lang="bash">{`curl ${state.baseUrl}/v1/chat/completions \\\n  -H "Authorization: Bearer ${created.key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${state.effectiveDefault || 'your-model'}", "messages": [{"role": "user", "content": "Hello"}]}'`}</Code>
          </div>
        )}
      </Modal>
    </>
  );
}
