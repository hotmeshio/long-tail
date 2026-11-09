import { hasInterpolation, interpolatePath, resolveCtxPath } from '../../../../lib/ctx-path';
import { LT_BASE } from '../../../../lib/base-path';

export const DOCUMENT_KINDS = {
  PDF: 'pdf',
  IMAGE: 'image',
  FILE: 'file',
} as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[keyof typeof DOCUMENT_KINDS];

/** What a document field shows: a link, what it holds, and when the link lapses. */
export interface DocumentSource {
  url: string;
  name: string;
  contentType: string;
  kind: DocumentKind;
  /** The storage key; a stable identity across re-signed links. */
  path?: string;
  expiresAt?: string;
}

/** Why there is nothing to show, when a file ref answered without a link. */
export interface DocumentSourceError {
  name: string;
  error: string;
}

const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

function typeFromUrl(url: string): string {
  const ext = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase();
  return (ext && EXTENSION_TYPES[ext]) || 'application/octet-stream';
}

export function documentKind(contentType: string): DocumentKind {
  const type = contentType.toLowerCase();
  if (type === 'application/pdf') return DOCUMENT_KINDS.PDF;
  if (type.startsWith('image/')) return DOCUMENT_KINDS.IMAGE;
  return DOCUMENT_KINDS.FILE;
}

/** Only links a browser fetches over http(s), or same-origin paths, ever load. */
function isLoadableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//'));
}

/** Same-origin paths (the local storage backend's links) ride the app's base path. */
function withBase(url: string): string {
  return url.startsWith('/') && LT_BASE && !url.startsWith(`${LT_BASE}/`) ? `${LT_BASE}${url}` : url;
}

function fromValue(value: unknown): DocumentSource | DocumentSourceError | null {
  if (typeof value === 'string') {
    const url = value.trim();
    if (!url || !isLoadableUrl(url)) return null;
    const contentType = typeFromUrl(url);
    const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'document');
    return { url: withBase(url), name, contentType, kind: documentKind(contentType) };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const file = value as Record<string, unknown>;
  const name = typeof file.name === 'string' && file.name ? file.name : 'document';
  if (typeof file.error === 'string' && file.error) return { name, error: file.error };
  if (typeof file.url !== 'string' || !isLoadableUrl(file.url)) return null;
  const contentType = typeof file.contentType === 'string' && file.contentType
    ? file.contentType
    : typeFromUrl(file.url);
  return {
    url: withBase(file.url),
    name,
    contentType,
    kind: documentKind(contentType),
    ...(typeof file.path === 'string' ? { path: file.path } : {}),
    ...(typeof file.expiresAt === 'string' ? { expiresAt: file.expiresAt } : {}),
  };
}

/**
 * The document a field shows. `x-lt-source` names a context path (or an
 * ordered list; the first that resolves wins), usually `file.<as>`; a field
 * without a source shows its own value when that is a link.
 */
export function resolveDocumentSource(
  source: unknown,
  value: unknown,
  ctx: Record<string, unknown> | undefined,
): DocumentSource | DocumentSourceError | null {
  const paths = (typeof source === 'string' ? [source] : Array.isArray(source) ? source : [])
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  for (const path of paths) {
    const concrete = hasInterpolation(path) ? interpolatePath(path, ctx) : path;
    if (concrete === null) continue;
    const found = fromValue(resolveCtxPath(concrete, ctx));
    if (found) return found;
  }
  return fromValue(value);
}

export function isSourceError(found: DocumentSource | DocumentSourceError | null): found is DocumentSourceError {
  return !!found && 'error' in found;
}

/** Whether a signed link has lapsed (with a margin, so a load never starts on a dying link). */
export function isLinkExpired(expiresAt: string | undefined, now = Date.now(), marginMs = 5_000): boolean {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at - marginMs <= now;
}
