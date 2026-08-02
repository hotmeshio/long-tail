import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

// ── Mocks — a mutable shell so tests can simulate open/close transitions ─────

const mockSetPanel = vi.fn();
const mockClosePanel = vi.fn();
let shellState: { open: boolean; ownerKey: string | null } = { open: false, ownerKey: null };
vi.mock('../../../hooks/useShellPanel', () => ({
  useShellPanelOptional: () => ({ ...shellState, setPanel: mockSetPanel, closePanel: mockClosePanel }),
}));

vi.mock('../../../api/escalation-analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/escalation-analytics')>();
  return {
    ...actual,
    useAggregateByFacets: () => ({ data: { groups: [], overflow: false }, error: null, isLoading: false }),
    useAnalyticsWindow: () => ({ from: '2026-08-01T09:00:00.000Z', to: '2026-08-01T10:00:00.000Z' }),
    isForbidden: () => false,
  };
});
vi.mock('../../../api/escalations', () => ({
  useFacetKeys: () => ({ data: { keys: [] } }),
}));
vi.mock('../../../components/escalation/EntityTimelinePanel', () => ({
  EntityTimelinePanel: () => null,
}));

import { EntityLensView } from '../EntityLensView';

const onEntityChange = vi.fn();

function lens(entityValue: string | null) {
  return (
    <EntityLensView
      entityKey="serialNumber"
      periodHours={1}
      roles={[]}
      find={null}
      onFindChange={vi.fn()}
      entityValue={entityValue}
      onEntityChange={onEntityChange}
    />
  );
}

describe('EntityLensView ?entity= ↔ timeline panel sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shellState = { open: false, ownerKey: null };
  });

  it('opens the timeline panel for the deep-linked entity on mount', () => {
    render(lens('SN-1'));
    expect(mockSetPanel).toHaveBeenCalledTimes(1);
    const [node, opts] = mockSetPanel.mock.calls[0];
    expect(opts).toEqual({ key: 'entity-timeline', width: 420 });
    expect((node as ReactElement).props).toMatchObject({
      facetKey: 'serialNumber',
      value: 'SN-1',
      entity: 'serialNumber',
    });
  });

  it('follows a param change to a new entity', () => {
    const { rerender } = render(lens('SN-1'));
    rerender(lens('SN-2'));
    expect(mockSetPanel).toHaveBeenCalledTimes(2);
    expect((mockSetPanel.mock.calls[1][0] as ReactElement).props).toMatchObject({ value: 'SN-2' });
  });

  it('closes the panel when the param clears', () => {
    const { rerender } = render(lens('SN-1'));
    rerender(lens(null));
    expect(mockClosePanel).toHaveBeenCalledWith('entity-timeline');
  });

  it('clears the param when the panel is closed externally', () => {
    const { rerender } = render(lens('SN-1'));
    // The shell reports our panel open…
    shellState = { open: true, ownerKey: 'entity-timeline' };
    rerender(lens('SN-1'));
    expect(onEntityChange).not.toHaveBeenCalled();
    // …then closed (the panel's X): the param follows.
    shellState = { open: false, ownerKey: 'entity-timeline' };
    rerender(lens('SN-1'));
    expect(onEntityChange).toHaveBeenCalledWith(null);
  });

  it('releases the panel slot on unmount', () => {
    shellState = { open: true, ownerKey: 'entity-timeline' };
    const { unmount } = render(lens('SN-1'));
    unmount();
    expect(mockClosePanel).toHaveBeenCalledWith('entity-timeline');
  });
});
