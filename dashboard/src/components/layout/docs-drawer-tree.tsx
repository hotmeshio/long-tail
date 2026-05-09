import { Folder } from 'lucide-react';
import { MarkdownRenderer } from '../common/display/MarkdownRenderer';
import { resolveDocLink } from './docs-drawer-history';

// ── Markdown content with link interception ─────────────────────────────────

export function MarkdownContent({
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

  return <MarkdownRenderer content={content} className="docs-content" onClick={handleClick} />;
}

// ── Doc tree sidebar ────────────────────────────────────────────────────────

export interface DocNode {
  path: string;
  title: string;
}

interface DocDir {
  label: string;
  children: DocNode[];
  subdirs: Map<string, DocDir>;
}

function buildTree(docs: DocNode[]): { topLevel: DocNode[]; dirs: Map<string, DocDir> } {
  const topLevel: DocNode[] = [];
  const dirs = new Map<string, DocDir>();

  for (const doc of docs) {
    const parts = doc.path.split('/');
    if (parts.length === 1) {
      topLevel.push(doc);
      continue;
    }

    // Walk/create nested directory structure
    let current = dirs;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!current.has(seg)) {
        current.set(seg, { label: seg, children: [], subdirs: new Map() });
      }
      const node = current.get(seg)!;
      if (i === parts.length - 2) {
        node.children.push(doc);
      } else {
        current = node.subdirs;
      }
    }
  }
  return { topLevel, dirs };
}

export function DocTree({
  docs,
  selected,
  onSelect,
}: {
  docs: DocNode[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const { topLevel, dirs } = buildTree(docs);

  const itemClass = (path: string) =>
    `block w-full text-left px-3 py-1 text-xs rounded truncate transition-colors ${
      selected === path
        ? 'bg-accent/10 text-accent'
        : 'text-text-secondary hover:bg-surface-hover'
    }`;

  function renderDir(dir: DocDir, depth: number) {
    return (
      <details key={dir.label} open>
        <summary className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary cursor-pointer">
          <Folder className="w-3 h-3" strokeWidth={1.5} />
          {dir.label}
        </summary>
        <div className="pl-2 space-y-0.5">
          {[...dir.subdirs.values()].map((sub) => renderDir(sub, depth + 1))}
          {dir.children.map((d) => (
            <button key={d.path} className={itemClass(d.path)} onClick={() => onSelect(d.path)}>
              {d.title}
            </button>
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className="space-y-0.5">
      {topLevel.map((d) => (
        <button key={d.path} className={itemClass(d.path)} onClick={() => onSelect(d.path)}>
          {d.title}
        </button>
      ))}
      {[...dirs.values()].map((dir) => renderDir(dir, 0))}
    </div>
  );
}
