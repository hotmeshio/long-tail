import { useState, useMemo, useEffect } from 'react';
import { BookOpen, X, ChevronRight, Folder } from 'lucide-react';
import { useDocList, useDocContent } from '../../api/docs';

function renderTable(block: string): string {
  const rows = block.trim().split('\n');
  if (rows.length < 2) return block;

  const parseRow = (row: string) =>
    row.split('|').map(c => c.trim()).filter(Boolean);

  const headers = parseRow(rows[0]);
  const dataRows = rows.slice(2); // skip separator row

  const ths = headers.map(h => `<th class="px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">${h}</th>`).join('');
  const trs = dataRows.map(row => {
    const cells = parseRow(row);
    const tds = cells.map(c => `<td class="px-3 py-1.5 text-xs text-text-secondary">${c}</td>`).join('');
    return `<tr class="border-t border-surface-border">${tds}</tr>`;
  }).join('');

  return `<table class="w-full my-3 text-xs"><thead><tr class="border-b border-surface-border">${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function renderMarkdownToHtml(md: string): string {
  // Extract and render tables first
  const tablePattern = /^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm;
  let processed = md.replace(tablePattern, (_match, header, sep, body) => {
    return renderTable(`${header}\n${sep}\n${body.trimEnd()}`);
  });

  processed = processed
    // Fenced code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-surface-sunken rounded p-3 my-2 overflow-x-auto text-[11px] leading-relaxed"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-surface-sunken px-1 py-0.5 rounded text-[11px]">$1</code>')
    // Headings
    .replace(/^#### (.+)$/gm, '<h4 class="text-xs font-semibold text-text-primary mt-4 mb-1">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-text-primary mt-5 mb-1.5">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold text-text-primary mt-6 mb-2 pb-1 border-b border-surface-border">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold text-text-primary mb-3">$1</h1>')
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-accent hover:underline">$1</a>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-xs leading-relaxed">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-xs leading-relaxed">$1</li>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p class="text-xs leading-relaxed text-text-secondary mb-2">')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br/>');

  return `<p class="text-xs leading-relaxed text-text-secondary mb-2">${processed}</p>`;
}

function MarkdownContent({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdownToHtml(content), [content]);
  return <div className="docs-content" dangerouslySetInnerHTML={{ __html: html }} />;
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
  // Group by directory
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

export function DocsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const { data: docList } = useDocList();
  const { data: docContent, isLoading } = useDocContent(selectedPath);

  // Mount → animate in on next frame
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  const mounted = open || visible;

  if (!mounted) return null;

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

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
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-accent" strokeWidth={1.5} />
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
              <DocTree docs={docList.docs} selected={selectedPath} onSelect={setSelectedPath} />
            ) : (
              <div className="px-3 py-2 text-xs text-text-tertiary">Loading...</div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
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
              <MarkdownContent content={docContent.content} />
            ) : (
              <p className="text-xs text-text-tertiary">Document not found.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
