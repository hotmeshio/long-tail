import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RoleDetail } from '../../../../api/roles';

const update = vi.fn();
vi.mock('../../../../api/preferences', () => ({
  usePreferences: () => ({ data: { preferences: { pinnedViews: [{ id: 'p1', label: 'My jeopardy', url: '/escalations/available?role=fleet&jeopardy=1&view=table', badge: true }] } } }),
}));
vi.mock('../../../../hooks/useLinkVariables', () => ({
  useLinkVariables: () => ({ values: { facility: 'north' }, defaults: {} }),
}));

import { useState } from 'react';
import { PortalSection } from '../sections/PortalSection';
import { draftFrom, type Draft } from '../role-detail-shared';

// The section edits the page draft; the harness holds it as the page does and
// records every update so the tests read the portals the page would save.
function Harness({ role: r }: { role: RoleDetail }) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(r));
  return (
    <PortalSection
      role={r}
      draft={draft}
      update={(changes) => { update(changes); setDraft((d) => ({ ...d, ...changes })); }}
    />
  );
}

const BOARD = { label: 'Fleet board', url: '/escalations/available?role=fleet&view=rich', badge: false };
const NORTH = { label: 'North', url: '/escalations/available?role=fleet&facets=%7B%22facility%22%3A%22%7Blt%3Afacility%7D%22%7D&view=table', badge: true };
const HARVEST = { label: 'Harvest', url: '/escalations/available?role=harvest', badge: true };

function role(over: Partial<RoleDetail> = {}): RoleDetail {
  return {
    role: 'fleet', title: 'Fleet', description: null, form_schema: null, metadata_schema: null, properties: {},
    ops_visible: true, ops_home_default: false, enforce_schema: false, parent_role: null, sla_minutes: null,
    target_per_hour: null, worker_count: null, priority_threshold_minutes: null, priority_facet: null,
    entity_facet: null, entity_state_source: 'role', current_schema_version: null, list_schema: null,
    current_list_schema_version: null, default_pins: [BOARD, NORTH, HARVEST], portals: null,
    upstream_roles: [], user_count: 0, chain_count: 0, workflow_count: 0, ...over,
  };
}

const renderSection = (r: RoleDetail) => render(<MemoryRouter><Harness role={r} /></MemoryRouter>);

beforeEach(() => update.mockClear());

const FLOOR = (rows: RolePin[][]) => ({ key: 'floor', label: 'Floor screen', rows });
type RolePin = typeof BOARD;

describe('PortalSection', () => {
  it('with no portals, explains the shape and starts one from the role and own pins under a chosen name', () => {
    renderSection(role());
    expect(screen.getByText(/A portal lays pins out as one page/)).toBeInTheDocument();
    const picker = screen.getByTestId('add-portal') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Start it with a view…', 'Fleet board', 'North', 'Harvest', 'My jeopardy', 'Label and URL…']);
    fireEvent.change(screen.getByLabelText('New portal name'), { target: { value: 'Focus of the day' } });
    fireEvent.change(picker, { target: { value: 'role:0' } });
    expect(update).toHaveBeenCalledWith({ portals: [{ key: 'focus-of-the-day', label: 'Focus of the day', rows: [[BOARD]] }] });
  });

  it('renders each portal with its matrix, view chips, bindings, sketch, and open link', () => {
    renderSection(role({ portals: [FLOOR([[BOARD], [NORTH, HARVEST]])] }));
    expect(screen.getByTestId('open-portal-floor')).toHaveAttribute('href', '/portal/fleet/floor');
    expect(screen.getByTestId('portal-sketch').children).toHaveLength(2);
    expect(screen.getByTestId('portal-floor-cell-0-0')).toHaveTextContent('rich');
    expect(screen.getByTestId('portal-floor-cell-1-0')).toHaveTextContent('table');
    expect(screen.getByTestId('portal-floor-cell-1-0')).toHaveTextContent("facility = 'north'");
    expect(screen.getByTestId('portal-floor-cell-1-1')).toHaveTextContent('default');
  });

  it('adds a cell to a row, picking from own pins, and starts a new row', () => {
    renderSection(role({ portals: [FLOOR([[BOARD]])] }));
    fireEvent.change(screen.getByTestId('add-cell-floor-0'), { target: { value: 'mine:p1' } });
    expect(update).toHaveBeenLastCalledWith({
      portals: [FLOOR([[BOARD, { label: 'My jeopardy', url: '/escalations/available?role=fleet&jeopardy=1&view=table', badge: true }]])],
    });
    // The draft accumulates: the new row joins the row that just grew.
    fireEvent.change(screen.getByTestId('add-row-floor'), { target: { value: 'role:2' } });
    expect(update).toHaveBeenLastCalledWith({
      portals: [FLOOR([[BOARD, { label: 'My jeopardy', url: '/escalations/available?role=fleet&jeopardy=1&view=table', badge: true }], [HARVEST]])],
    });
  });

  it('renames a panel and the portal itself', () => {
    renderSection(role({ portals: [FLOOR([[BOARD]])] }));
    const cellTitle = screen.getByLabelText('Panel title for row 1 cell 1');
    fireEvent.change(cellTitle, { target: { value: 'Tom' } });
    fireEvent.blur(cellTitle);
    expect(update).toHaveBeenLastCalledWith({ portals: [FLOOR([[{ ...BOARD, label: 'Tom' }]])] });
    const name = screen.getByLabelText('Portal name for floor');
    fireEvent.change(name, { target: { value: 'Morning focus' } });
    fireEvent.blur(name);
    expect(update).toHaveBeenLastCalledWith({ portals: [{ key: 'floor', label: 'Morning focus', rows: [[{ ...BOARD, label: 'Tom' }]] }] });
  });

  it('removing the last cell of a row drops the row; removing the last cell of a portal removes the portal', () => {
    const first = renderSection(role({ portals: [FLOOR([[BOARD], [NORTH]])] }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove North from row 2 of Floor screen' }));
    expect(update).toHaveBeenLastCalledWith({ portals: [FLOOR([[BOARD]])] });
    first.unmount();
    renderSection(role({ portals: [FLOOR([[BOARD]]), { key: 'focus', label: 'Focus', rows: [[NORTH]] }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Fleet board from row 1 of Floor screen' }));
    expect(update).toHaveBeenLastCalledWith({ portals: [{ key: 'focus', label: 'Focus', rows: [[NORTH]] }] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove portal Focus' }));
    expect(update).toHaveBeenLastCalledWith({ portals: [] });
  });

  it('adds, annotates, and removes a count tile above the panels', () => {
    renderSection(role({ portals: [FLOOR([[BOARD]])] }));
    fireEvent.change(screen.getByTestId('add-count-floor'), { target: { value: 'role:2' } });
    expect(update).toHaveBeenLastCalledWith({ portals: [{ ...FLOOR([[BOARD]]), counts: [{ label: 'Harvest', url: HARVEST.url }] }] });
    const blurb = screen.getByLabelText('Count blurb 1 of Floor screen');
    fireEvent.change(blurb, { target: { value: 'Ready to pull' } });
    fireEvent.blur(blurb);
    expect(update).toHaveBeenLastCalledWith({ portals: [{ ...FLOOR([[BOARD]]), counts: [{ label: 'Harvest', url: HARVEST.url, blurb: 'Ready to pull' }] }] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove count Harvest from Floor screen' }));
    expect(update).toHaveBeenLastCalledWith({ portals: [FLOOR([[BOARD]])] });
  });

  it('holds the row and column bounds', () => {
    renderSection(role({ portals: [FLOOR([[BOARD, NORTH, HARVEST, BOARD, NORTH, HARVEST], [NORTH], [HARVEST], [BOARD]])] }));
    expect(screen.queryByTestId('add-cell-floor-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-cell-floor-1')).toBeInTheDocument();
    expect(screen.queryByTestId('add-row-floor')).not.toBeInTheDocument();
  });

  it('a typed label and URL add a badged cell once the URL is dashboard-relative', () => {
    renderSection(role({ portals: [FLOOR([[BOARD]])] }));
    fireEvent.change(screen.getByTestId('add-cell-floor-0'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('View label'), { target: { value: 'South' } });
    fireEvent.change(screen.getByLabelText('View URL'), { target: { value: 'https://elsewhere' } });
    const add = screen.getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText('View URL'), { target: { value: '/escalations/available?role=fleet&facets=%7B%22facility%22%3A%22south%22%7D' } });
    fireEvent.click(add);
    expect(update).toHaveBeenLastCalledWith({
      portals: [FLOOR([[BOARD, { label: 'South', url: '/escalations/available?role=fleet&facets=%7B%22facility%22%3A%22south%22%7D', badge: true }]])],
    });
  });
});
