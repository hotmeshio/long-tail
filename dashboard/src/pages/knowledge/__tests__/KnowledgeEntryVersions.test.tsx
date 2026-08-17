import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';

// Versioning on the entry view: the edition selector surfaces the lineage,
// the viewed edition is deep-linked (?version=N), and a past edition renders
// its immutable snapshot read-only.

const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });

vi.mock('../../../api/knowledge', () => ({
  useGetKnowledge: vi.fn(),
  useKnowledgeVersions: vi.fn(),
  useGetKnowledgeVersion: vi.fn(),
  useDeleteKnowledge: () => mutation(),
  useStoreKnowledge: () => mutation(),
  useSetKnowledgeField: () => mutation(),
  useRemoveKnowledgeField: () => mutation(),
}));

import { KnowledgeEntryView } from '../KnowledgeEntryView';
import { useGetKnowledge, useKnowledgeVersions, useGetKnowledgeVersion } from '../../../api/knowledge';

const mockGet = vi.mocked(useGetKnowledge);
const mockVersions = vi.mocked(useKnowledgeVersions);
const mockSnapshot = vi.mocked(useGetKnowledgeVersion);

function arrange() {
  mockGet.mockReturnValue({
    data: {
      id: 'k1', domain: 'catalog', key: 'materials',
      data: { items: ['aluminum', 'steel', 'copper', 'titanium', 'composite'] },
      tags: ['lookup'], current_version: 2,
      created_at: '2026-08-17T00:00:00Z', updated_at: '2026-08-17T00:00:00Z',
    },
    isLoading: false, refetch: vi.fn(),
  } as any);
  mockVersions.mockReturnValue({
    data: {
      domain: 'catalog', key: 'materials',
      versions: [
        { version: 2, change_summary: null, created_at: '2026-08-17T00:00:00Z', is_current: true },
        { version: 1, change_summary: null, created_at: '2026-08-16T00:00:00Z', is_current: false },
      ],
    },
  } as any);
  mockSnapshot.mockReturnValue({
    data: {
      domain: 'catalog', key: 'materials', version: 1,
      data: { items: ['aluminum', 'steel', 'copper'] },
      tags: ['lookup'], created_at: '2026-08-16T00:00:00Z',
    },
  } as any);
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="url">{location.search}</div>;
}

function renderView(initialSearch = '') {
  return render(
    <MemoryRouter initialEntries={[`/knowledge${initialSearch}`]}>
      <KnowledgeEntryView domain="catalog" entryKey="materials" onDeleted={vi.fn()} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('KnowledgeEntryView versioning', () => {
  it('offers the edition lineage as a select, current selected by default', () => {
    arrange();
    renderView();
    const select = screen.getByLabelText('Version history') as HTMLSelectElement;
    expect(select.value).toBe('2');
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['v2 · current', 'v1']);
    // The live five-item list renders.
    expect(screen.getByText(/titanium/)).toBeInTheDocument();
  });

  it('selecting a past edition deep-links it and renders the snapshot read-only', () => {
    arrange();
    renderView();
    fireEvent.change(screen.getByLabelText('Version history'), { target: { value: '1' } });

    expect(screen.getByTestId('url')).toHaveTextContent('?version=1');
    // v1's three-item list renders instead of the live five-item list.
    expect(screen.getByText(/"copper"/)).toBeInTheDocument();
    expect(screen.queryByText(/titanium/)).not.toBeInTheDocument();
    // Read-only: the add/filter ghost row is gone; the banner offers the way back.
    expect(screen.queryByPlaceholderText(/add or filter/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Back to current'));
    expect(screen.getByTestId('url')).not.toHaveTextContent('version=');
    expect(screen.getByText(/titanium/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/add or filter/)).toBeInTheDocument();
  });

  it('a shared ?version=N link opens directly on that edition, select aligned', () => {
    arrange();
    renderView('?version=1');
    const select = screen.getByLabelText('Version history') as HTMLSelectElement;
    expect(select.value).toBe('1');
    expect(screen.getByText(/an immutable edition/)).toBeInTheDocument();
    expect(screen.queryByText(/titanium/)).not.toBeInTheDocument();
  });

  it('?version= equal to the current edition normalizes to the live view', () => {
    arrange();
    renderView('?version=2');
    expect(screen.getByText(/titanium/)).toBeInTheDocument();
    expect(screen.queryByText(/an immutable edition/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/add or filter/)).toBeInTheDocument();
  });
});
