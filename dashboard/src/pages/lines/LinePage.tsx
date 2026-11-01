import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  machineLineQueryKey,
  machineWirePattern,
  useLine,
  type LineSummaryMachine,
  type WireEvent,
} from '../../api/machines';
import { useSettings } from '../../api/settings';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { useAccess } from '../../hooks/useAccess';
import { useEventSubscriptions } from '../../hooks/useEventContext';
import { useThrottledInvalidation } from '../../hooks/useEventHooks';
import { useEventFeedPatterns } from '../../hooks/useEventFeedPatterns';
import { useShellPanel } from '../../hooks/useShellPanel';
import { useWireTape } from '../../hooks/useWireTape';
import { escalationPattern } from '../../lib/events/subjects';
import { formatDateTime } from '../../lib/format';
import {
  MACHINE_VIEWS,
  autoMachineView,
  machineViewStorageKey,
  readStored,
  writeStored,
  type MachineViewMode,
} from './line-view-prefs';
import { MachinePanel, MACHINE_PANEL_KEY, MACHINE_PANEL_WIDTH } from './MachinePanel';
import type { StripMachine } from './MachineStrip';
import { MachineViews } from './MachineViews';
import { TapeSection } from './TapeSection';
import { WireDetailPanel, WIRE_PANEL_KEY } from './WireDetailPanel';

const WIRE_PANEL_WIDTH = 420;
/** The machines take three quarters of the page below the header, the wire the last quarter. */
const MACHINES_REGION_CLASS = 'flex-[3] min-h-0 flex flex-col mb-4';
const TAPE_REGION_CLASS = 'flex-[1] min-h-[14rem] flex flex-col';

/** The tape's size, remembered per device. */
/** The machines view: the count picks it, an override remembered per line wins. */
function useMachineView(siteId: string, lineId: string, count: number): [MachineViewMode, (view: MachineViewMode) => void] {
  const key = machineViewStorageKey(siteId, lineId);
  const [override, setOverride] = useState<MachineViewMode | null>(() => readStored(key, MACHINE_VIEWS));
  useEffect(() => {
    setOverride(readStored(key, MACHINE_VIEWS));
  }, [key]);
  const choose = useCallback((view: MachineViewMode) => {
    setOverride(view);
    writeStored(key, view);
  }, [key]);
  return [override ?? autoMachineView(count), choose];
}

/**
 * Line state refreshes through the LIST tier on the line's own wire events
 * and on escalation events in the roles its machines own.
 */
function useLineRefresh(siteId: string, lineId: string, roles: string[]) {
  const invalidate = useThrottledInvalidation('LIST');
  const patterns = useMemo(
    () => [machineWirePattern(siteId, lineId), ...roles.map((role) => escalationPattern({ role }))],
    [siteId, lineId, roles],
  );
  useEventSubscriptions(patterns, () => {
    invalidate([machineLineQueryKey(siteId, lineId)]);
  });
}

/** One line: the machines region, the tape section, the machine and wire panels. */
export function LinePage() {
  const { siteId = '', lineId = '' } = useParams<{ siteId: string; lineId: string }>();
  const { data: settings } = useSettings();
  const { isOps, isBuilder } = useAccess();
  const canAct = isOps || isBuilder;
  const { data: line, isLoading, error } = useLine(siteId, lineId);
  const { setPanel, closePanel, ownerKey } = useShellPanel();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const { userPatterns, addPattern } = useEventFeedPatterns();

  const summary = useMemo(
    () => settings?.machines?.lines.find((l) => l.siteId === siteId && l.lineId === lineId) ?? null,
    [settings, siteId, lineId],
  );
  // The summary is line order; the view, when leading, enriches each tile.
  const machines = useMemo<StripMachine[]>(() => {
    const views = new Map((line?.machines ?? []).map((m) => [m.machineId, m]));
    const declared: LineSummaryMachine[] = summary?.machines
      ?? (line?.machines ?? []).map((m) => ({
        machineId: m.machineId, process: m.process, role: m.role, address: m.address, addressing: 'declared' as const,
      }));
    return declared.map((s) => ({ summary: s, view: views.get(s.machineId) }));
  }, [summary, line]);
  const roles = useMemo(() => [...new Set(machines.map((m) => m.summary.role))].sort(), [machines]);

  useLineRefresh(siteId, lineId, roles);
  const tape = useWireTape(siteId, lineId);
  const [machineView, setMachineView] = useMachineView(siteId, lineId, machines.length);
  const wirePattern = machineWirePattern(siteId, lineId);
  const watching = userPatterns.includes(wirePattern);

  const selected = machines.find((m) => m.summary.machineId === selectedId) ?? null;
  // One focus: the chosen machine opens its panel and the tape follows it.
  const selectMachine = useCallback((machineId: string) => {
    setSelectedId(machineId);
    tape.setFilter({ machine: machineId });
  }, [tape.setFilter]);
  const closeMachine = useCallback(() => {
    setSelectedId(null);
    closePanel(MACHINE_PANEL_KEY);
  }, [closePanel]);

  // The panel re-renders with every refresh of the line while it stays selected.
  useEffect(() => {
    if (!selected) return;
    setPanel(
      <MachinePanel
        siteId={siteId}
        lineId={lineId}
        summary={selected.summary}
        view={selected.view}
        canAct={canAct}
        onClose={closeMachine}
      />,
      { key: MACHINE_PANEL_KEY, width: MACHINE_PANEL_WIDTH },
    );
  }, [selected, siteId, lineId, canAct, closeMachine, setPanel]);

  // Another claimant taking the slot (a wire row, a timeline) clears the
  // selection. Ownership is tracked, since the slot changes hands one render
  // after the selection is made.
  const ownedRef = useRef(false);
  useEffect(() => {
    if (ownerKey === MACHINE_PANEL_KEY) {
      ownedRef.current = true;
      return;
    }
    if (ownedRef.current) {
      ownedRef.current = false;
      setSelectedId(null);
    }
  }, [ownerKey]);

  const openWire = useCallback((event: WireEvent) => {
    setPanel(
      <WireDetailPanel event={event} onClose={() => closePanel(WIRE_PANEL_KEY)} />,
      { key: WIRE_PANEL_KEY, width: WIRE_PANEL_WIDTH },
    );
  }, [setPanel, closePanel]);

  const standingBy = !!line && !line.leading;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={<span className="font-mono">{siteId} · {lineId}</span>}
        actions={
          line?.leading && line.takenAt ? (
            <span className="text-2xs text-text-quaternary">leading since {formatDateTime(line.takenAt)}</span>
          ) : null
        }
      />

      {isLoading && <p className="text-2xs text-text-tertiary italic mb-4">Loading the line…</p>}
      {error && <p className="text-2xs text-status-error mb-4">{(error as Error).message}</p>}
      {standingBy && (
        <p className="text-xs text-text-secondary mb-4" data-testid="standing-by">
          Standing by. Another replica leads this line; the tape stays live from the leader.
        </p>
      )}
      {line && line.contested.length > 0 && (
        <p className="text-2xs text-status-warning mb-4">
          Contested: {line.contested.map((c) => `${c.address} at ${c.station}`).join(', ')}
        </p>
      )}

      <div className={MACHINES_REGION_CLASS}>
        <MachineViews
          machines={machines}
          selectedId={selectedId}
          onSelect={selectMachine}
          view={machineView}
          onView={setMachineView}
          attentionOnly={attentionOnly}
          onAttentionOnly={setAttentionOnly}
        />
      </div>

      <div className={TAPE_REGION_CLASS}>
      <TapeSection
        events={tape.events}
        total={tape.total}
        paused={tape.paused}
        heldCount={tape.heldCount}
        filters={tape.filters}
        machines={tape.machines}
        channels={tape.channels}
        setFilter={tape.setFilter}
        togglePause={tape.togglePause}
        clear={tape.clear}
        onOpen={openWire}
        fullscreen={fullscreen}
        onFullscreen={setFullscreen}
        watching={watching}
        onWatch={() => addPattern(wirePattern)}
      />
      </div>
    </div>
  );
}
