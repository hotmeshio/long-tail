import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, Brain, Database, Table2, Plus } from 'lucide-react';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterInput } from '../../components/common/data/FilterBar';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { EmptyState } from '../../components/common/display/EmptyState';
import { DropZone } from '../../components/common/DropZone';
import { TimeAgo } from '../../components/common/display/TimeAgo';
import { useListDomains, useListKnowledge } from '../../api/knowledge';
import { KnowledgeEntryView } from './KnowledgeEntryView';
import { CreateEntryModal } from './CreateEntryModal';

const PAGE_SIZE = 50;

export function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const domain = searchParams.get('domain') || '';
  const entryKey = searchParams.get('key') || '';
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [showCreate, setShowCreate] = useState(false);
  const [prefillData, setPrefillData] = useState<Record<string, unknown> | undefined>();

  const handleJsonDrop = useCallback((files: File[]) => {
    console.debug('[Knowledge] drop received:', files.map(f => ({ name: f.name, type: f.type, size: f.size })));
    const jsonFile = files.find(f => f.name.endsWith('.json') || f.type === 'application/json');
    if (!jsonFile) {
      console.warn('[Knowledge] no JSON file found in dropped files');
      return;
    }
    console.debug('[Knowledge] reading:', jsonFile.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          console.debug('[Knowledge] parsed object with keys:', Object.keys(parsed));
          setPrefillData(parsed);
          setShowCreate(true);
        } else {
          console.warn('[Knowledge] JSON is not a plain object, got:', Array.isArray(parsed) ? 'array' : typeof parsed);
        }
      } catch (err) {
        console.warn('[Knowledge] JSON parse failed:', err);
      }
    };
    reader.readAsText(jsonFile);
  }, []);

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
    <DropZone onDrop={handleJsonDrop} label="Drop a JSON file to create an entry" accept=".json,application/json">
    <div>
      <PageHeader
        title="Knowledge"
        docsHash="#docs:dashboard.md:knowledge"
        actions={
          <button
            onClick={() => { setPrefillData(undefined); setShowCreate(true); }}
            className="btn-primary text-xs inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            New Entry
          </button>
        }
      />

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
          <span>All Domains</span>
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
              <div className="cursor-pointer" onClick={() => { setPrefillData(undefined); setShowCreate(true); }}>
                <EmptyState icon={Brain} title={search ? 'No matching domains' : 'No knowledge yet'} description={search ? undefined : 'Create your first entry or drop a JSON file'} />
              </div>
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
              <div className="cursor-pointer" onClick={() => { setPrefillData(undefined); setShowCreate(true); }}>
                <EmptyState icon={Plus} title={search ? 'No matching entries' : 'No entries in this domain'} description={search ? undefined : 'Add an entry or drop a JSON file'} />
              </div>
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

    <CreateEntryModal
      open={showCreate}
      onClose={() => { setShowCreate(false); setPrefillData(undefined); }}
      onCreated={(d, k) => {
        setSearchParams({ domain: d, key: k });
        domainsQuery.refetch();
      }}
      prefillData={prefillData}
      prefillDomain={domain || undefined}
    />
    </DropZone>
  );
}
