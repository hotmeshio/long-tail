import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { BookOpen, X, ChevronRight, ChevronLeft, Folder } from 'lucide-react';
import { useDocList, useDocContent } from '../../api/docs';

// ── Markdown rendering ───────────────────────────────────────────────────────

function renderTable(block: string): string {
  const rows = block.trim().split('\n');
  if (rows.length < 2) return block;

  const parseRow = (row: string) =>
    row.split('|').map(c => c.trim()).filter(Boolean);

  const headers = parseRow(rows[0]);
  const dataRows = rows.slice(2);

  const ths = headers.map(h => `<th class="px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">${h}</th>`).join('');
  const trs = dataRows.map(row => {
    const cells = parseRow(row);
    const tds = cells.map(c => `<td class="px-3 py-1.5 text-xs text-text-secondary">${c}</td>`).join('');
    return `<tr class="border-t border-surface-border">${tds}</tr>`;
  }).join('');

  return `<table class="w-full my-3 text-xs"><thead><tr class="border-b border-surface-border">${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').trim();
}

function renderMarkdownToHtml(md: string): string {
  // 1. Extract fenced code blocks into placeholders (protects # comments, **, etc.)
  const codeBlocks: string[] = [];
  let processed = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="bg-surface-sunken rounded p-3 my-2 overflow-x-auto text-[11px] leading-relaxed"><code>${code}</code></pre>`);
    return `\x00CODE${idx}\x00`;
  });

  // 2. Extract and render tables
  const tablePattern = /^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm;
  processed = processed.replace(tablePattern, (_match, header, sep, body) => {
    return renderTable(`${header}\n${sep}\n${body.trimEnd()}`);
  });

  // 3. Inline code (before headings so `#` inside backticks is safe)
  processed = processed
    .replace(/`([^`]+)`/g, '<code class="bg-surface-sunken px-1 py-0.5 rounded text-[11px]">$1</code>');

  // 4. Headings — generate id for anchor scrolling
  processed = processed
    .replace(/^#### (.+)$/gm, (_m, t) => `<h4 id="${slugify(t)}" class="text-xs font-semibold text-text-primary mt-4 mb-1">${t}</h4>`)
    .replace(/^### (.+)$/gm, (_m, t) => `<h3 id="${slugify(t)}" class="text-sm font-semibold text-text-primary mt-5 mb-1.5">${t}</h3>`)
    .replace(/^## (.+)$/gm, (_m, t) => `<h2 id="${slugify(t)}" class="text-base font-semibold text-text-primary mt-6 mb-2 pb-1 border-b border-surface-border">${t}</h2>`)
    .replace(/^# (.+)$/gm, (_m, t) => `<h1 id="${slugify(t)}" class="text-lg font-bold text-text-primary mb-3">${t}</h1>`);

  // 5. Everything else
  processed = processed
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Anchor links → data attribute for scroll-into-view
    .replace(/\[([^\]]+)\]\(#([^)]+)\)/g, '<a data-anchor="$2" class="text-accent hover:underline cursor-pointer">$1</a>')
    // Doc links (relative .md paths) → data attribute for in-viewer navigation
    .replace(/\[([^\]]+)\]\(([^)]*\.md(?:#[^)]*)?)\)/g, '<a data-doc-link="$2" class="text-accent hover:underline cursor-pointer">$1</a>')
    // External links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-accent hover:underline">$1</a>')
    // Unordered lists (indented items get extra margin for nesting)
    .replace(/^    - (.+)$/gm, '<li class="ml-8 list-disc text-xs -my-1" style="line-height:1.1">$1</li>')
    .replace(/^  - (.+)$/gm, '<li class="ml-8 list-disc text-xs -my-1" style="line-height:1.1">$1</li>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-xs -my-1" style="line-height:1.1">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-xs -my-1" style="line-height:1.1">$1</li>')
    // Horizontal rules
    .replace(/^---+$/gm, '<hr class="border-surface-border my-4" />')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '\x00PARA\x00')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br/>');

  // 6. Wrap consecutive list items in <ul>/<ol> for proper spacing and numbering
  const UL_ITEM = '<li class="ml-4 list-disc';
  const UL_NESTED = '<li class="ml-8 list-disc';
  const OL_ITEM = '<li class="ml-4 list-decimal';
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const liRun = (prefix: string) => new RegExp(`(${esc(prefix)}[\\s\\S]*?<\\/li>(?:<br\\/>)?)+`, 'g');

  processed = processed.replace(liRun(UL_NESTED), (run) => `<ul class="mb-3">${run}</ul>`);
  processed = processed.replace(liRun(UL_ITEM), (run) => `<ul class="mb-3">${run}</ul>`);
  processed = processed.replace(liRun(OL_ITEM), (run) => `<ol class="list-decimal mb-3">${run}</ol>`);

  // 7. Restore code blocks
  processed = processed.replace(/\x00CODE(\d+)\x00/g, (_m, idx) => codeBlocks[parseInt(idx, 10)]);

  // 8. Wrap bare text in <p> tags — split block elements from trailing text
  const pCls = 'text-xs leading-relaxed text-text-secondary mb-2';
  const blockTag = /<\/(h[1-4]|pre|table|ul|ol|hr|div)>/;
  processed = processed.split('\x00PARA\x00').map((seg) => {
    const trimmed = seg.trim();
    if (!trimmed) return '';

    // Split segment at the end of block elements to isolate trailing text
    const parts: string[] = [];
    let remaining = trimmed;
    let match: RegExpExecArray | null;
    while ((match = blockTag.exec(remaining)) !== null) {
      const end = match.index + match[0].length;
      parts.push(remaining.slice(0, end));
      remaining = remaining.slice(end).replace(/^<br\/>/, '').trim();
      blockTag.lastIndex = 0;
    }
    if (remaining) parts.push(remaining);

    return parts.map((part) => {
      const p = part.trim();
      if (!p) return '';
      if (/^\s*<(h[1-4]|pre|table|ul|ol|hr|div)/.test(p)) return p;
      return `<p class="${pCls}">${p}</p>`;
    }).join('');
  }).join('');

  return processed;
}

// ── History hook ──────────────────────────────────────────────────────────────

interface HistoryEntry {
  path: string;
  scrollTop: number;
}

function useDocHistory() {
  const [backStack, setBackStack] = useState<HistoryEntry[]>([]);
  const [forwardStack, setForwardStack] = useState<HistoryEntry[]>([]);
  const [current, setCurrent] = useState<HistoryEntry | null>(null);

  // Refs track latest values so callbacks never read stale state
  const currentRef = useRef(current);
  const backRef = useRef(backStack);
  const forwardRef = useRef(forwardStack);
  currentRef.current = current;
  backRef.current = backStack;
  forwardRef.current = forwardStack;

  const navigate = useCallback((path: string, scrollRef?: React.RefObject<HTMLDivElement | null>) => {
    const prev = currentRef.current;
    if (prev) {
      const scrollTop = scrollRef?.current?.scrollTop ?? 0;
      setBackStack([...backRef.current, { ...prev, scrollTop }]);
    }
    setForwardStack([]);
    setCurrent({ path, scrollTop: 0 });
  }, []);

  const goBack = useCallback((scrollRef?: React.RefObject<HTMLDivElement | null>) => {
    const back = backRef.current;
    if (back.length === 0) return;
    const prev = back[back.length - 1];
    const cur = currentRef.current;
    if (cur) {
      const scrollTop = scrollRef?.current?.scrollTop ?? 0;
      setForwardStack([...forwardRef.current, { ...cur, scrollTop }]);
    }
    setBackStack(back.slice(0, -1));
    setCurrent(prev);
    requestAnimationFrame(() => {
      if (scrollRef?.current) scrollRef.current.scrollTop = prev.scrollTop;
    });
  }, []);

  const goForward = useCallback((scrollRef?: React.RefObject<HTMLDivElement | null>) => {
    const fwd = forwardRef.current;
    if (fwd.length === 0) return;
    const next = fwd[fwd.length - 1];
    const cur = currentRef.current;
    if (cur) {
      const scrollTop = scrollRef?.current?.scrollTop ?? 0;
      setBackStack([...backRef.current, { ...cur, scrollTop }]);
    }
    setForwardStack(fwd.slice(0, -1));
    setCurrent(next);
    requestAnimationFrame(() => {
      if (scrollRef?.current) scrollRef.current.scrollTop = next.scrollTop;
    });
  }, []);

  const pushScrollPosition = useCallback((scrollRef?: React.RefObject<HTMLDivElement | null>) => {
    const cur = currentRef.current;
    if (!cur) return;
    const scrollTop = scrollRef?.current?.scrollTop ?? 0;
    setBackStack([...backRef.current, { ...cur, scrollTop }]);
    setForwardStack([]);
    setCurrent({ ...cur, scrollTop: scrollRef?.current?.scrollTop ?? 0 });
  }, []);

  const reset = useCallback(() => {
    setBackStack([]);
    setForwardStack([]);
    setCurrent(null);
  }, []);

  return { current, backStack, forwardStack, navigate, goBack, goForward, pushScrollPosition, reset };
}

// ── Resolve relative doc links ───────────────────────────────────────────────

function resolveDocLink(link: string, currentPath: string | null): { path: string; anchor?: string } {
  const [rawPath, anchor] = link.split('#');
  let resolved = rawPath;

  // Relative paths like ../architecture.md or ./data.md
  if (resolved.startsWith('./') || resolved.startsWith('../')) {
    const currentDir = currentPath ? currentPath.replace(/[^/]+$/, '') : '';
    const parts = (currentDir + resolved).split('/');
    const normalized: string[] = [];
    for (const p of parts) {
      if (p === '..') normalized.pop();
      else if (p && p !== '.') normalized.push(p);
    }
    resolved = normalized.join('/');
  }

  return { path: resolved, anchor };
}

// ── Components ───────────────────────────────────────────────────────────────

function MarkdownContent({
  content,
  currentPath,
  onNavigate,
  onAnchorClick,
}: {
  content: string;
  currentPath: string | null;
  onNavigate: (path: string, anchor?: string) => void;
  onAnchorClick: () => void;
}) {
  const html = useMemo(() => renderMarkdownToHtml(content), [content]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Anchor links — push scroll position to history, then scroll
    const anchor = target.closest<HTMLElement>('[data-anchor]');
    if (anchor) {
      e.preventDefault();
      onAnchorClick();
      const id = anchor.dataset.anchor!;
      const el = anchor.closest('.docs-content')?.querySelector(`#${CSS.escape(id)}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // Doc links — navigate within viewer
    const docLink = target.closest<HTMLElement>('[data-doc-link]');
    if (docLink) {
      e.preventDefault();
      const { path, anchor: docAnchor } = resolveDocLink(docLink.dataset.docLink!, currentPath);
      onNavigate(path, docAnchor);
      return;
    }
  };

  return <div className="docs-content" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

function DocTree({
  docs,
  selected,
  onSelect,
}: {
  docs: { path: string; title: string }[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const topLevel: { path: string; title: string }[] = [];
  const byDir = new Map<string, { path: string; title: string }[]>();

  for (const doc of docs) {
    const slash = doc.path.indexOf('/');
    if (slash === -1) {
      topLevel.push(doc);
    } else {
      const dir = doc.path.slice(0, slash);
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir)!.push(doc);
    }
  }

  const itemClass = (path: string) =>
    `block w-full text-left px-3 py-1 text-xs rounded truncate transition-colors ${
      selected === path
        ? 'bg-accent/10 text-accent'
        : 'text-text-secondary hover:bg-surface-hover'
    }`;

  return (
    <div className="space-y-0.5">
      {topLevel.map((d) => (
        <button key={d.path} className={itemClass(d.path)} onClick={() => onSelect(d.path)}>
          {d.title}
        </button>
      ))}
      {[...byDir.entries()].map(([dir, items]) => (
        <details key={dir} open>
          <summary className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary cursor-pointer">
            <Folder className="w-3 h-3" strokeWidth={1.5} />
            {dir}
          </summary>
          <div className="pl-2 space-y-0.5">
            {items.map((d) => (
              <button key={d.path} className={itemClass(d.path)} onClick={() => onSelect(d.path)}>
                {d.title}
              </button>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────────────

// ── Hash helpers ──────────────────────────────────────────────────────────────

function parseDocsHash(hash: string): { path: string; anchor?: string } | null {
  if (!hash.startsWith('#docs')) return null;
  const parts = hash.slice(1).split(':'); // ['docs', 'mcp.md', 'anchor']
  const path = parts[1] || 'README.md';
  const anchor = parts[2] || undefined;
  return { path, anchor };
}

function buildDocsHash(path: string | null): string {
  if (!path || path === 'README.md') return '#docs';
  return `#docs:${path}`;
}

// ── Drawer ────────────────────────────────────────────────────────────────────

export function DocsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  const { data: docList } = useDocList();
  const history = useDocHistory();
  const { data: docContent, isLoading } = useDocContent(history.current?.path ?? null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Scroll to anchor after content loads
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  useEffect(() => {
    if (pendingAnchor && docContent?.content && scrollRef.current) {
      requestAnimationFrame(() => {
        const el = scrollRef.current?.querySelector(`#${CSS.escape(pendingAnchor)}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setPendingAnchor(null);
      });
    }
  }, [pendingAnchor, docContent]);

  // Read hash and navigate — on mount and on hashchange
  const navigateFromHash = useCallback(() => {
    const parsed = parseDocsHash(window.location.hash);
    const targetPath = parsed?.path ?? 'README.md';
    if (history.current?.path !== targetPath) {
      history.navigate(targetPath, scrollRef);
    }
    if (parsed?.anchor) setPendingAnchor(parsed.anchor);
  }, [history]);

  // Sync URL hash outward when current doc changes (skip during initial load)
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (!open || !history.current) return;
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    const newHash = buildDocsHash(history.current.path);
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search + newHash);
    }
  }, [open, history.current?.path]);

  // Listen for external hash changes (user edits URL bar)
  useEffect(() => {
    if (!open) return;
    const onHashChange = () => {
      if (window.location.hash.startsWith('#docs')) {
        navigateFromHash();
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [open, navigateFromHash]);

  const handleNavigate = useCallback((path: string, anchor?: string) => {
    if (anchor) setPendingAnchor(anchor);
    history.navigate(path, scrollRef);
  }, [history]);

  const handleSidebarSelect = useCallback((path: string) => {
    history.navigate(path, scrollRef);
  }, [history]);

  const handleBack = useCallback(() => {
    history.goBack(scrollRef);
  }, [history]);

  const handleForward = useCallback(() => {
    history.goForward(scrollRef);
  }, [history]);

  const handleAnchorClick = useCallback(() => {
    history.pushScrollPosition(scrollRef);
  }, [history]);

  // Mount → animate in, load from hash or default to README
  useEffect(() => {
    if (open) {
      initialLoadRef.current = true;
      navigateFromHash();
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  const mounted = open || visible;
  if (!mounted) return null;

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => {
      onClose();
      history.reset();
    }, 200);
  };

  const selectedPath = history.current?.path ?? null;
  const canGoBack = history.backStack.length > 0;
  const canGoForward = history.forwardStack.length > 0;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex">
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/20 transition-opacity duration-200 ${visible && open ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />

      {/* Drawer */}
      <div className={`relative ml-auto w-[40vw] min-w-[800px] max-w-[90vw] h-full bg-surface-raised border-l border-surface-border flex flex-col shadow-xl transition-transform duration-200 ease-out ${visible && open ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={handleBack}
              disabled={!canGoBack}
              className={`p-0.5 transition-colors ${canGoBack ? 'text-text-tertiary hover:text-text-primary' : 'text-surface-border cursor-default'}`}
              title="Back"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleForward}
              disabled={!canGoForward}
              className={`p-0.5 transition-colors ${canGoForward ? 'text-text-tertiary hover:text-text-primary' : 'text-surface-border cursor-default'}`}
              title="Forward"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <BookOpen className="w-4 h-4 text-accent ml-1" strokeWidth={1.5} />
            <span className="text-sm font-medium text-text-primary">Documentation</span>
          </div>
          <button onClick={handleClose} className="p-1 text-text-tertiary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 shrink-0 border-r border-surface-border overflow-y-auto py-2">
            {docList?.docs ? (
              <DocTree docs={docList.docs} selected={selectedPath} onSelect={handleSidebarSelect} />
            ) : (
              <div className="px-3 py-2 text-xs text-text-tertiary">Loading...</div>
            )}
          </div>

          {/* Content */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
            {!selectedPath ? (
              <div className="flex flex-col items-center justify-center h-full text-text-tertiary">
                <ChevronRight className="w-5 h-5 mb-2" />
                <p className="text-xs">Select a document</p>
              </div>
            ) : isLoading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-6 bg-surface-sunken rounded w-48" />
                <div className="h-4 bg-surface-sunken rounded w-full" />
                <div className="h-4 bg-surface-sunken rounded w-3/4" />
              </div>
            ) : docContent?.content ? (
              <MarkdownContent
                content={docContent.content}
                currentPath={selectedPath}
                onNavigate={handleNavigate}
                onAnchorClick={handleAnchorClick}
              />
            ) : (
              <p className="text-xs text-text-tertiary">Document not found.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
