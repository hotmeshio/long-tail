/**
 * x-lt-bind — maps the escalation FORM (flat field values the user edits) to and
 * from the PAYLOAD (the nested JSON the workflow consumes). A form_schema property
 * may declare `x-lt-bind: "a.b[0].c"`, the path its value occupies in the payload;
 * a property with no bind sits at its own name at the root (1:1). This is a
 * front-end port of the server's resolver-mapping (the dashboard build cannot
 * import backend service code) — keep the two in sync.
 *
 *   mapPayloadToForm  — payload → flat form values, to PREFILL/display the form
 *   mapFormToPayload  — flat form values → payload, the shape submitted/stored
 */

type PathSeg = { key: string } | { index: number };

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Parse a bind path — dot keys with optional `[n]` indices. Rejects pollution keys. */
export function parsePath(path: string): PathSeg[] {
  const segs: PathSeg[] = [];
  for (const raw of path.split('.')) {
    const m = raw.match(/^([^[\]]*)((?:\[\d+\])*)$/);
    if (!m) throw new Error(`invalid x-lt-bind path segment: "${raw}"`);
    const [, name, brackets] = m;
    if (name) {
      if (BLOCKED_KEYS.has(name)) throw new Error(`x-lt-bind path may not target "${name}"`);
      segs.push({ key: name });
    }
    for (const b of brackets.match(/\d+/g) ?? []) segs.push({ index: Number(b) });
  }
  if (segs.length === 0) throw new Error(`empty x-lt-bind path: "${path}"`);
  return segs;
}

/** Set `value` at `path` inside `root`, creating intermediate objects/arrays. */
export function setDeep(root: Record<string, any>, path: string, value: unknown): void {
  const segs = parsePath(path);
  let node: any = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const next = segs[i + 1];
    const childKey = 'key' in seg ? seg.key : seg.index;
    const wantArray = 'index' in next;
    if (node[childKey] == null || typeof node[childKey] !== 'object') {
      node[childKey] = wantArray ? [] : {};
    }
    node = node[childKey];
  }
  const last = segs[segs.length - 1];
  node['key' in last ? last.key : last.index] = value;
}

/** Read the value at `path` inside `root` (undefined if any segment is missing). */
export function getDeep(root: unknown, path: string): unknown {
  let node: any = root;
  for (const seg of parsePath(path)) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node['key' in seg ? seg.key : seg.index];
  }
  return node;
}

/** The bind path for a form property (its `x-lt-bind`, or the property name). */
export function bindPathFor(propName: string, propDef: Record<string, any> | undefined): string {
  const bind = propDef?.['x-lt-bind'];
  return typeof bind === 'string' && bind.length > 0 ? bind : propName;
}

/**
 * Assemble the payload from the form's flat values. A field absent from
 * `formValues` is omitted (so clearing/deleting a field drops it from the
 * payload). Unknown keys not declared in the schema are dropped. With no schema
 * properties, values pass through unchanged.
 */
export function mapFormToPayload(
  formValues: Record<string, any>,
  formSchema: Record<string, any> | null | undefined,
): Record<string, any> {
  const props = formSchema?.properties as Record<string, any> | undefined;
  if (!props) return { ...formValues };
  const payload: Record<string, any> = {};
  for (const [name, def] of Object.entries(props)) {
    if (!(name in formValues)) continue;
    setDeep(payload, bindPathFor(name, def as Record<string, any>), formValues[name]);
  }
  return payload;
}

/**
 * Reverse of {@link mapFormToPayload}: pull each form field's value out of the
 * payload via its bind path, to prefill/display the form. A field whose bound
 * path is missing from the payload is omitted (the caller falls back to the
 * schema default).
 */
export function mapPayloadToForm(
  payload: Record<string, any> | null | undefined,
  formSchema: Record<string, any> | null | undefined,
): Record<string, any> {
  const props = formSchema?.properties as Record<string, any> | undefined;
  if (!props) return payload ? { ...payload } : {};
  const form: Record<string, any> = {};
  for (const [name, def] of Object.entries(props)) {
    const v = getDeep(payload, bindPathFor(name, def as Record<string, any>));
    if (v !== undefined) form[name] = v;
  }
  return form;
}
