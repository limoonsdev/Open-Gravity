// Tolerant JSON parsing and JSON-Schema-driven coercion for tool arguments
// produced by models (trailing commas, single quotes, Python literals,
// unquoted keys, truncated output, "123" for numbers...).

function stripFences(s: string): string {
  return s.trim().replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '').replace(/\n?\s*```\s*$/, '').trim();
}

/** Best-effort repair of almost-JSON text. Returns a JSON string or undefined. */
export function repairJsonText(input: string): string | undefined {
  const s = stripFences(input);
  const start = s.search(/[{[]/);
  if (start < 0) return undefined;
  let out = '';
  const stack: string[] = [];
  let inStr = false;
  let quote = '"';
  let esc = false;
  let i = start;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        out += ch;
        esc = false;
      } else if (ch === '\\') {
        out += ch;
        esc = true;
      } else if (ch === quote) {
        out += '"';
        inStr = false;
      } else if (ch === '"') {
        out += '\\"';
      } else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      out += '"';
    } else if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
      out += ch;
    } else if (ch === '}' || ch === ']') {
      out = out.replace(/,\s*$/, '');
      if (stack.length && stack[stack.length - 1] === ch) stack.pop();
      out += ch;
      if (!stack.length) break;
    } else if (/[A-Za-z_$]/.test(ch)) {
      // Bare word: Python literal, JS literal, or unquoted key.
      let j = i;
      while (j < s.length && /[A-Za-z0-9_$]/.test(s[j])) j++;
      const word = s.slice(i, j);
      const rest = s.slice(j).match(/^\s*:/);
      if (rest) out += JSON.stringify(word);
      else if (word === 'True' || word === 'true') out += 'true';
      else if (word === 'False' || word === 'false') out += 'false';
      else if (word === 'None' || word === 'null' || word === 'undefined') out += 'null';
      else out += JSON.stringify(word);
      i = j - 1;
    } else out += ch;
  }
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
  while (stack.length) out += stack.pop();
  try {
    JSON.parse(out);
    return out;
  } catch {
    return undefined;
  }
}

/** Parse JSON leniently; returns undefined when nothing sensible can be recovered. */
export function parseLooseJson(input: string): any {
  if (typeof input !== 'string') return input;
  const t = input.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch { /* try harder */ }
  const fixed = repairJsonText(t);
  return fixed === undefined ? undefined : JSON.parse(fixed);
}

function typesOf(schema: any): string[] {
  if (!schema || typeof schema !== 'object') return [];
  if (Array.isArray(schema.type)) return schema.type.map(String);
  if (typeof schema.type === 'string') return [schema.type];
  if (schema.properties) return ['object'];
  if (schema.items) return ['array'];
  return [];
}

function jsType(v: any): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matches(v: any, types: string[]): boolean {
  const t = jsType(v);
  return types.includes(t) || (t === 'integer' && types.includes('number'));
}

/** Coerce a value towards a JSON schema (numbers from strings, arrays from scalars...). */
export function coerceToSchema(value: any, schema: any, depth = 0): any {
  if (!schema || typeof schema !== 'object' || depth > 24) return value;
  const variants = schema.anyOf || schema.oneOf;
  if (Array.isArray(variants) && variants.length) {
    const hit = variants.find((v: any) => matches(value, typesOf(v)));
    return coerceToSchema(value, hit || variants.find((v: any) => typesOf(v).some((t) => t !== 'null')) || variants[0], depth + 1);
  }
  const types = typesOf(schema);
  if (!types.length) return value;

  if (!matches(value, types)) {
    if (typeof value === 'string') {
      const t = value.trim();
      if ((types.includes('number') || types.includes('integer')) && t !== '' && !isNaN(Number(t))) value = Number(t);
      else if (types.includes('boolean') && /^(true|false)$/i.test(t)) value = t.toLowerCase() === 'true';
      else if (types.includes('null') && /^(null|none)$/i.test(t)) value = null;
      else if (types.includes('array') || types.includes('object')) {
        const parsed = parseLooseJson(t);
        if (parsed !== undefined && matches(parsed, types)) value = parsed;
        else if (types.includes('array')) value = [value];
      }
    } else if (types.includes('string') && (typeof value === 'number' || typeof value === 'boolean')) {
      value = String(value);
    } else if (types.includes('string') && value && typeof value === 'object') {
      value = JSON.stringify(value);
    } else if (types.includes('array') && value !== null && value !== undefined) {
      value = [value];
    } else if (types.includes('integer') && typeof value === 'number') {
      value = Math.round(value);
    }
  }

  if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    return value.map((v) => coerceToSchema(v, schema.items, depth + 1));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties || {};
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      const propSchema = props[k] ?? (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined);
      out[k] = propSchema ? coerceToSchema(v, propSchema, depth + 1) : v;
    }
    return out;
  }
  return value;
}

/** Normalise a tool-call argument string: valid JSON object, coerced to the schema. */
export function normalizeToolArgs(args: string, schema: any): string {
  let parsed = parseLooseJson(args || '{}');
  if (parsed === undefined || parsed === null) parsed = {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) parsed = schema?.properties ? { [Object.keys(schema.properties)[0]]: parsed } : { value: parsed };
  return JSON.stringify(schema ? coerceToSchema(parsed, schema) : parsed);
}
