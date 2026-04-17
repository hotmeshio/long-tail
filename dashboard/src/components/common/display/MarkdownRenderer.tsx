import { useMemo } from 'react';

// ── Markdown to HTML ─────────────────────────────────────────────────────────

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

export function renderMarkdownToHtml(md: string): string {
  // 1. Extract fenced code blocks into placeholders
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

  // 3. Inline code
  processed = processed
    .replace(/`([^`]+)`/g, '<code class="bg-surface-sunken px-1 py-0.5 rounded text-[11px]">$1</code>');

  // 4. Headings
  processed = processed
    .replace(/^#### (.+)$/gm, (_m, t) => `<h4 id="${slugify(t)}" class="text-xs font-semibold text-text-primary mt-4 mb-1">${t}</h4>`)
    .replace(/^### (.+)$/gm, (_m, t) => `<h3 id="${slugify(t)}" class="text-sm font-semibold text-text-primary mt-5 mb-1.5">${t}</h3>`)
    .replace(/^## (.+)$/gm, (_m, t) => `<h2 id="${slugify(t)}" class="text-base font-semibold text-text-primary mt-6 mb-2 pb-1 border-b border-surface-border">${t}</h2>`)
    .replace(/^# (.+)$/gm, (_m, t) => `<h1 id="${slugify(t)}" class="text-lg font-bold text-text-primary mb-3">${t}</h1>`);

  // 5. Inline formatting, links, lists
  processed = processed
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(#([^)]+)\)/g, '<a data-anchor="$2" class="text-accent hover:underline cursor-pointer">$1</a>')
    .replace(/\[([^\]]+)\]\(([^)]*\.md(?:#[^)]*)?)\)/g, '<a data-doc-link="$2" class="text-accent hover:underline cursor-pointer">$1</a>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-accent hover:underline">$1</a>')
    .replace(/^    - (.+)$/gm, '<li class="ml-8 list-disc text-xs -my-1" style="line-height:1.1">$1</li>')
    .replace(/^  - (.+)$/gm, '<li class="ml-8 list-disc text-xs -my-1" style="line-height:1.1">$1</li>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-xs -my-1" style="line-height:1.1">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-xs -my-1" style="line-height:1.1">$1</li>')
    .replace(/^---+$/gm, '<hr class="border-surface-border my-4" />')
    // Blockquotes — collect consecutive > lines into a callout
    .replace(/(?:^> (.+)$\n?)+/gm, (block) => {
      const inner = block.replace(/^> /gm, '').trim();
      const isWarning = /⚠️|warning|caution/i.test(inner);
      const isNote = /note:|ℹ️|info/i.test(inner);
      const borderColor = isWarning ? 'border-status-warning' : isNote ? 'border-accent' : 'border-text-tertiary';
      const bgColor = isWarning ? 'bg-status-warning/5' : isNote ? 'bg-accent/5' : 'bg-surface-sunken/50';
      return `<div class="${bgColor} ${borderColor} border-l-2 rounded-r-md px-3 py-2 my-3 text-xs text-text-secondary leading-relaxed">${inner}</div>`;
    })
    .replace(/\n\n/g, '\x00PARA\x00')
    .replace(/\n/g, '<br/>');

  // 6. Wrap consecutive list items
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const liRun = (prefix: string) => new RegExp(`(${esc(prefix)}[\\s\\S]*?<\\/li>(?:<br\\/>)?)+`, 'g');
  processed = processed.replace(liRun('<li class="ml-8 list-disc'), (run) => `<ul class="mb-3">${run}</ul>`);
  processed = processed.replace(liRun('<li class="ml-4 list-disc'), (run) => `<ul class="mb-3">${run}</ul>`);
  processed = processed.replace(liRun('<li class="ml-4 list-decimal'), (run) => `<ol class="list-decimal mb-3">${run}</ol>`);

  // 7. Restore code blocks
  processed = processed.replace(/\x00CODE(\d+)\x00/g, (_m, idx) => codeBlocks[parseInt(idx, 10)]);

  // 8. Wrap bare text in <p> tags
  const pCls = 'text-xs leading-relaxed text-text-secondary mb-2';
  const blockTag = /<\/(h[1-4]|pre|table|ul|ol|hr|div)>/;
  processed = processed.split('\x00PARA\x00').map((seg) => {
    const trimmed = seg.trim();
    if (!trimmed) return '';
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

// ── Detection ────────────────────────────────────────────────────────────────

const MD_SIGNALS = /(\*\*|^#{1,4}\s|^- |^\d+\.\s|```|^\|.*\|$|\[.+\]\(.+\))/m;

export function looksLikeMarkdown(text: string): boolean {
  return MD_SIGNALS.test(text);
}

// ── Component ────────────────────────────────────────────────────────────────

export function MarkdownRenderer({
  content,
  className,
  onClick,
}: {
  content: string;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const html = useMemo(() => renderMarkdownToHtml(content), [content]);
  return <div className={className} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
