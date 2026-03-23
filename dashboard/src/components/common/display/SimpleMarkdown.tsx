/**
 * Lightweight markdown-to-HTML renderer for simple patterns.
 * No external dependency — handles bold, italic, code, links, headers, lists.
 */

function renderInline(text: string): string {
  return text
    // Code spans
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-surface-sunken rounded text-xs font-mono">$1</code>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-accent-primary hover:underline" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const htmlParts: string[] = [];
  let inList = false;
  let inTable = false;
  let tableRows: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Table rows
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
      // Skip separator rows (|---|---|)
      if (cells.every((c) => /^[-:]+$/.test(c))) continue;
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      tableRows.push(cells);
      continue;
    }
    if (inTable) {
      inTable = false;
      const [header, ...body] = tableRows;
      htmlParts.push('<div class="overflow-x-auto my-2"><table class="text-xs w-full"><thead><tr>');
      for (const h of header) {
        htmlParts.push(`<th class="text-left py-1 px-2 border-b border-border text-text-secondary font-medium">${renderInline(h)}</th>`);
      }
      htmlParts.push('</tr></thead><tbody>');
      for (const row of body) {
        htmlParts.push('<tr>');
        for (const cell of row) {
          htmlParts.push(`<td class="py-1 px-2 border-b border-border/50">${renderInline(cell)}</td>`);
        }
        htmlParts.push('</tr>');
      }
      htmlParts.push('</tbody></table></div>');
      tableRows = [];
    }

    // Empty line
    if (!trimmed) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      continue;
    }

    // Headers
    if (trimmed.startsWith('### ')) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<h4 class="text-sm font-semibold text-text-primary mt-3 mb-1">${renderInline(trimmed.slice(4))}</h4>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<h3 class="text-sm font-semibold text-text-primary mt-3 mb-1">${renderInline(trimmed.slice(3))}</h3>`);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push('<hr class="border-border my-3" />');
      continue;
    }

    // List items
    if (/^[-*] /.test(trimmed)) {
      if (!inList) { htmlParts.push('<ul class="space-y-1 my-1">'); inList = true; }
      htmlParts.push(`<li class="text-sm text-text-secondary flex gap-2"><span class="text-text-tertiary shrink-0">-</span><span>${renderInline(trimmed.slice(2))}</span></li>`);
      continue;
    }

    // Paragraph
    if (inList) { htmlParts.push('</ul>'); inList = false; }
    htmlParts.push(`<p class="text-sm text-text-secondary my-1">${renderInline(trimmed)}</p>`);
  }

  // Flush any remaining table
  if (inTable && tableRows.length) {
    const [header, ...body] = tableRows;
    htmlParts.push('<div class="overflow-x-auto my-2"><table class="text-xs w-full"><thead><tr>');
    for (const h of header) {
      htmlParts.push(`<th class="text-left py-1 px-2 border-b border-border text-text-secondary font-medium">${renderInline(h)}</th>`);
    }
    htmlParts.push('</tr></thead><tbody>');
    for (const row of body) {
      htmlParts.push('<tr>');
      for (const cell of row) {
        htmlParts.push(`<td class="py-1 px-2 border-b border-border/50">${renderInline(cell)}</td>`);
      }
      htmlParts.push('</tr>');
    }
    htmlParts.push('</tbody></table></div>');
  }

  if (inList) htmlParts.push('</ul>');

  return (
    <div
      className="prose-sm"
      dangerouslySetInnerHTML={{ __html: htmlParts.join('\n') }}
    />
  );
}
