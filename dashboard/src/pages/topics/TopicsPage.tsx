import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Radio,
  CheckSquare, GitBranch, AlertTriangle, Zap,
  BookOpen, Bot, AppWindow, Flag,
} from 'lucide-react';
import { useTopics, type TopicCatalogEntry } from '../../api/topics';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterSelect, FilterInput } from '../../components/common/data/FilterBar';
import type { LucideIcon } from 'lucide-react';

// ── Category meta ──────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  task: CheckSquare,
  workflow: GitBranch,
  escalation: AlertTriangle,
  activity: Zap,
  knowledge: BookOpen,
  agent: Bot,
  app: AppWindow,
  milestone: Flag,
};

// ── Page ──────────────────────────────────────────────────────────────────────

export function TopicsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const { data, isLoading } = useTopics({ limit: 500 });
  const allTopics: TopicCatalogEntry[] = data?.topics ?? [];

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const t of allTopics) seen.add(t.category);
    return Array.from(seen).sort();
  }, [allTopics]);

  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const cats = activeCategory ? [activeCategory] : categories;
    return cats
      .map((cat) => ({
        name: cat,
        topics: allTopics.filter(
          (t) =>
            t.category === cat &&
            (!q || t.topic.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.topics.length > 0);
  }, [allTopics, categories, search, activeCategory]);

  return (
    <div>
      <PageHeader title="Event Topics" docsHash="#docs:topics.md" />

      {/* Sticky filter bar: category select + search */}
      {!isLoading && categories.length > 0 && (
        <FilterBar>
          <FilterSelect
            label="Category"
            value={activeCategory ?? ''}
            onChange={(v) => setActiveCategory(v || null)}
            options={categories.map((c) => ({ value: c, label: c }))}
          />
          <FilterInput
            label="Search"
            value={search}
            onChange={setSearch}
            placeholder={`${allTopics.length} topics…`}
          />
        </FilterBar>
      )}

      {/* Topic list */}
      {isLoading ? (
        <div className="animate-pulse space-y-8 mt-4">
          {[1, 2, 3].map((i) => (
            <div key={i}>
              <div className="h-4 bg-surface-sunken rounded w-28 mb-4" />
              <div className="space-y-3">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="space-y-1.5">
                    <div className="h-3 bg-surface-sunken rounded w-64" />
                    <div className="h-3 bg-surface-sunken rounded w-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-text-tertiary mt-8">
          {search || activeCategory ? 'No topics match your filter.' : 'No topics registered yet.'}
        </p>
      ) : (
        <div className="space-y-10">
          {grouped.map(({ name, topics }) => {
            const Icon = CATEGORY_ICONS[name] ?? Radio;
            return (
              <div key={name}>
                <div className="sticky top-[60px] z-10 bg-surface flex items-center gap-2 py-2 mb-2 border-b border-surface-border">
                  <Icon className="w-3 h-3 text-accent" strokeWidth={1.5} />
                  <h2 className="section-h2 capitalize">{name}</h2>
                  <span className="text-xs text-text-quaternary">{topics.length}</span>
                </div>
                <div className="divide-y divide-surface-border/30">
                  {topics.map((topic) => (
                    <TopicRow
                      key={topic.topic}
                      topic={topic}
                      onClick={() => navigate(`/topics/${encodeURIComponent(topic.topic)}`)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Topic row ──────────────────────────────────────────────────────────────────

function TopicRow({ topic, onClick }: { topic: TopicCatalogEntry; onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className="group py-2 px-3 -mx-3 rounded-md cursor-pointer transition-colors text-left"
    >
      <div className="flex items-center gap-3">
        <Radio className="w-3 h-3 shrink-0 text-text-quaternary group-hover:text-text-tertiary transition-colors" strokeWidth={1.5} />
        <span className="text-xs font-mono text-text-primary truncate shrink-0 max-w-[24rem]">{topic.topic}</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium shrink-0 bg-accent/10 text-accent">
          {topic.category}
        </span>
        {(topic.subscriber_count ?? 0) > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] px-1 py-0.5 rounded-full text-2xs font-medium bg-accent/15 text-accent shrink-0">
            {topic.subscriber_count}
          </span>
        )}
        {topic.description && (
          <p className="flex-1 min-w-0 truncate text-2xs text-text-tertiary group-hover:text-text-secondary transition-colors">
            {topic.description}
          </p>
        )}
        <span className="ml-auto text-2xs font-mono text-text-quaternary shrink-0">{topic.source}</span>
      </div>
    </div>
  );
}
