import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, Brain, Database, Table2 } from 'lucide-react';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterInput } from '../../components/common/data/FilterBar';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { EmptyState } from '../../components/common/display/EmptyState';
import { TimeAgo } from '../../components/common/display/TimeAgo';
import { useListDomains, useListKnowledge } from '../../api/knowledge';
import { KnowledgeEntryView } from './KnowledgeEntryView';

const PAGE_SIZE = 50;

export function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const domain = searchParams.get('domain') || '';
  const entryKey = searchParams.get('key') || '';
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  // Debounce search to avoid hammering the API on every keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const offset = (page - 1) * pageSize;

  const domainsQuery = useListDomains();
  const entriesQuery = useListKnowledge(domain, {
    search: debouncedSearch || undefined,
    limit: pageSize,
    offset,
  });

  const domains = domainsQuery.data?.domains ?? [];
  const entries = entriesQuery.data?.entries ?? [];
  const entriesTotal = entriesQuery.data?.total ?? 0;

  // Domains are a small list — client-side filter is fine
  const filteredDomains = useMemo(() => {
    if (!search) return domains;
    const q = search.toLowerCase();
    return domains.filter((d) => d.domain.toLowerCase().includes(q));
  }, [domains, search]);

  function navigate(d: string, k?: string) {
    setSearch('');
    setDebouncedSearch('');
    setPage(1);
    const params: Record<string, string> = {};
    if (d) params.domain = d;
    if (k) params.key = k;
    setSearchParams(params);
  }

  const level = entryKey ? 'entry' : domain ? 'entries' : 'domains';
  const isLoading = level === 'entries' ? entriesQuery.isLoading : level === 'domains' ? domainsQuery.isLoading : false;
  const totalPages = Math.ceil((level === 'entries' ? entriesTotal : filteredDomains.length) / pageSize);

  const entriesApiPath = domain
    ? `/knowledge/entries?domain=${encodeURIComponent(domain)}&limit=${pageSize}&offset=${offset}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`
    : undefined;
  const domainsApiPath = '/knowledge/domains';

  return (
    <div>
      <PageHeader title="Knowledge" docsHash="#docs:dashboard.md:knowledge" />

      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1 text-sm mb-6 min-h-[28px]">
        <button
          onClick={() => navigate('')}
          className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors ${
            level === 'domains'
              ? 'text-text-primary font-medium'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
          }`}
        >
          <Brain className="w-4 h-4 text-accent/75" strokeWidth={1.5} />
          <span>Knowledge</span>
        </button>
        {domain && (
          <>
            <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
            <button
              onClick={() => navigate(domain)}
              className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors ${
                level === 'entries'
                  ? 'text-text-primary font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              <Database className="w-3.5 h-3.5 text-accent/60" strokeWidth={1.5} />
              {domain}
            </button>
          </>
        )}
        {entryKey && (
          <>
            <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="flex items-center gap-1.5 px-1.5 py-0.5 text-text-primary font-medium">
              <Table2 className="w-3.5 h-3.5 text-accent/60" strokeWidth={1.5} />
              {entryKey}
            </span>
          </>
        )}
      </nav>

      {/* Level: entry detail */}
      {level === 'entry' ? (
        <KnowledgeEntryView
          domain={domain}
          entryKey={entryKey}
          onDeleted={() => navigate(domain)}
        />
      ) : (
        <>
          <FilterBar actions={
            <ListToolbar
              onRefresh={() => level === 'entries' ? entriesQuery.refetch() : domainsQuery.refetch()}
              isFetching={level === 'entries' ? entriesQuery.isFetching : domainsQuery.isFetching}
              apiPath={level === 'entries' ? entriesApiPath : domainsApiPath}
            />
          }>
            <FilterInput
              label="Search"
              value={search}
              onChange={setSearch}
              placeholder={domain ? 'Filter by key or tag...' : 'Filter by domain...'}
            />
          </FilterBar>

          {isLoading ? (
            <div className="animate-pulse space-y-2 mt-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 bg-surface-sunken rounded" />
              ))}
            </div>
          ) : level === 'domains' ? (
            filteredDomains.length === 0 ? (
              <EmptyState title={search ? 'No matching domains' : 'No knowledge domains yet'} />
            ) : (
              <table className="w-full mt-2">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-text-tertiary">
                    <th className="pb-2 pl-2 font-medium">Domain</th>
                    <th className="pb-2 font-medium w-24 text-right">Entries</th>
                    <th className="pb-2 pr-2 font-medium w-40 text-right">Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDomains.map((d) => (
                    <tr
                      key={d.domain}
                      onClick={() => navigate(d.domain)}
                      className="row-hover cursor-pointer group"
                    >
                      <td className="py-2 pl-2">
                        <span className="flex items-center gap-2.5">
                          <Database className="w-4 h-4 text-accent/75 shrink-0" strokeWidth={1.5} />
                          <span className="text-sm text-text-primary group-hover:text-accent transition-colors">
                            {d.domain}
                          </span>
                        </span>
                      </td>
                      <td className="py-2 text-right text-xs text-text-secondary tabular-nums">
                        {d.count}
                      </td>
                      <td className="py-2 pr-2 text-right text-xs text-text-secondary">
                        <TimeAgo date={d.latest} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            entries.length === 0 ? (
              <EmptyState title={search ? 'No matching entries' : 'No entries in this domain'} />
            ) : (
              <>
                <table className="w-full mt-2">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-text-tertiary">
                      <th className="pb-2 pl-2 font-medium w-[200px]">Key</th>
                      <th className="pb-2 font-medium">Tags</th>
                      <th className="pb-2 font-medium w-16 text-right">Fields</th>
                      <th className="pb-2 pr-2 font-medium w-32 text-right">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr
                        key={entry.key}
                        onClick={() => navigate(domain, entry.key)}
                        className="row-hover cursor-pointer group"
                      >
                        <td className="py-2 pl-2 w-[200px]">
                          <span className="flex items-center gap-2.5">
                            <Table2 className="w-4 h-4 text-accent/75 shrink-0" strokeWidth={1.5} />
                            <span className="text-sm text-text-primary group-hover:text-accent transition-colors truncate max-w-[160px]" title={entry.key}>
                              {entry.key}
                            </span>
                          </span>
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1">
                            {entry.tags?.slice(0, 5).map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-medium bg-accent/10 text-accent"
                              >
                                {tag}
                              </span>
                            ))}
                            {entry.tags && entry.tags.length > 5 && (
                              <span className="text-[10px] text-text-tertiary">
                                +{entry.tags.length - 5}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 text-right text-xs text-text-secondary tabular-nums">
                          {entry.data ? Object.keys(entry.data).length : 0}
                        </td>
                        <td className="py-2 pr-2 text-right text-xs text-text-secondary">
                          <TimeAgo date={entry.updated_at} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <StickyPagination
                  page={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  total={entriesTotal}
                  pageSize={pageSize}
                  onPageSizeChange={setPageSize}
                />
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
