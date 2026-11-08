// Label text tokens: {target}, {item.<facet>}, {user.<key>}, {scheme.name}.
// A missing value renders empty; template validation names unknown tokens.

export interface LabelTokenContext {
  target: string;
  /** The row's metadata (action schemes) or a pasted list's columns. */
  item?: Record<string, unknown>;
  /** The identity scheme's user: name, display_name, email, roles, and metadata keys. */
  user?: Record<string, unknown>;
  scheme?: { name: string };
}

const TOKEN = /\{(target|scheme\.name|(?:item|user)\.[a-zA-Z0-9_]+)\}/g;
const ANY_TOKEN = /\{([^{}]*)\}/g;

function display(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(display).filter(Boolean).join(', ');
  if (typeof value === 'object') return '';
  return String(value);
}

function resolve(token: string, ctx: LabelTokenContext): unknown {
  if (token === 'target') return ctx.target;
  if (token === 'scheme.name') return ctx.scheme?.name;
  const [bag, key] = token.split('.', 2);
  return (bag === 'item' ? ctx.item : ctx.user)?.[key];
}

/** Render one line of label text. */
export function renderLabelText(template: string, ctx: LabelTokenContext): string {
  return template.replace(TOKEN, (_m, token: string) => display(resolve(token, ctx))).trim();
}

/** Every token a line uses, valid or not, without braces. */
export function listLabelTokens(template: string): string[] {
  return [...template.matchAll(ANY_TOKEN)].map((m) => m[1]);
}

/** Tokens in a line that renderLabelText does not know. */
export function unknownLabelTokens(template: string): string[] {
  return listLabelTokens(template).filter((t) => !new RegExp(`^${TOKEN.source}$`).test(`{${t}}`));
}

/** `user.<key>` tokens a line uses, as keys. */
export function userTokenKeys(template: string): string[] {
  return listLabelTokens(template).filter((t) => t.startsWith('user.')).map((t) => t.slice(5));
}
