// Regenerates src/data/models.json from LiteLLM's model catalog.
// Usage: npx tsx scripts/update-models.ts [path-to-local-json]
import fs from 'fs';
import path from 'path';
import { compileLiteLLM, MODELDB_SOURCE_URL } from '../src/core/modeldb';

async function main() {
  const local = process.argv[2];
  const raw = local ? JSON.parse(fs.readFileSync(local, 'utf8')) : await (await fetch(MODELDB_SOURCE_URL)).json();
  const db = compileLiteLLM(raw);
  const out = path.join(__dirname, '..', 'src', 'data', 'models.json');
  // One model per line keeps diffs readable.
  const lines = db.models.map((m) => JSON.stringify(m));
  fs.writeFileSync(out, `{"source":${JSON.stringify(db.source)},"updated":${JSON.stringify(db.updated)},"providers":${JSON.stringify(db.providers)},"models":[\n${lines.join(',\n')}\n]}\n`);
  console.log(`${db.models.length} models from ${db.providers.length} providers -> ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
