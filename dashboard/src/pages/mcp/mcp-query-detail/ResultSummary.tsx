import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { SimpleMarkdown } from '../../../components/common/display/SimpleMarkdown';

/**
 * Renders an LLM result string that may contain interleaved prose and JSON blocks.
 * JSON blocks are rendered as interactive tree viewers; prose as markdown.
 */
export function ResultSummary({ text }: { text: string }) {
  const parts: Array<{ type: 'text' | 'json'; content: string }> = [];
  const jsonBlockRe = /\n?\{[\s\S]*?\n\}/g;
  let lastIndex = 0;
  for (const match of text.matchAll(jsonBlockRe)) {
    try {
      JSON.parse(match[0].trim());
      if (match.index! > lastIndex) parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      parts.push({ type: 'json', content: match[0].trim() });
      lastIndex = match.index! + match[0].length;
    } catch { /* not JSON */ }
  }
  if (lastIndex < text.length) parts.push({ type: 'text', content: text.slice(lastIndex) });
  if (!parts.length) parts.push({ type: 'text', content: text });
  return (
    <div className="space-y-3">
      {parts.map((p, i) => p.type === 'json'
        ? <JsonViewer key={i} data={JSON.parse(p.content)} defaultMode="tree" />
        : p.content.trim() ? <SimpleMarkdown key={i} content={p.content.trim()} /> : null)}
    </div>
  );
}
