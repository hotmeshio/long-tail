import { CornerDownLeft } from 'lucide-react';
import { SectionGroup, safeParseJson, type Draft } from '../role-detail-shared';

interface ScanDone {
  return?: string;
  after_seconds?: number;
}

/** The role's `scan_done` from the draft's properties JSON, or null when it declares none. */
export function readScanDoneDraft(properties: string): ScanDone | null {
  const parsed = safeParseJson(properties);
  const done = parsed.ok ? parsed.value?.scan_done : undefined;
  return done && typeof done === 'object' && !Array.isArray(done) ? (done as ScanDone) : null;
}

/** Write one scan_done field into the properties JSON; null when the bag is unparseable. */
export function patchScanDoneDraft(properties: string, patch: ScanDone): string | null {
  const parsed = safeParseJson(properties);
  if (!parsed.ok) return null;
  const bag: Record<string, unknown> = { ...(parsed.value ?? {}) };
  const next: Record<string, unknown> = { ...(readScanDoneDraft(properties) ?? {}), ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === '') delete next[key];
  if (Object.keys(next).length) bag.scan_done = next;
  else delete bag.scan_done;
  return JSON.stringify(bag, null, 2);
}

/**
 * Where a station locked to this role goes once a scan act completes its
 * row: the kiosk home or a route, after a pause on the done copy. Empty
 * keeps the station on the done copy until the next scan.
 */
export function ScanDoneSection({ draft, update }: { draft: Draft; update: (patch: Partial<Draft>) => void }) {
  const done = readScanDoneDraft(draft.properties) ?? {};
  const set = (patch: ScanDone) => {
    const next = patchScanDoneDraft(draft.properties, patch);
    if (next !== null) update({ properties: next });
  };
  const mode = done.return === undefined ? 'stay' : done.return === 'home' ? 'home' : 'route';

  return (
    <SectionGroup icon={CornerDownLeft} label="After a scan completes" annotation="where the station returns">
      <p className="text-2xs text-text-tertiary leading-relaxed mb-3">
        When the last expected scan lands, or a choice completes the row, the station shows the done
        copy and then returns. Staying keeps the done copy up until the next scan.
      </p>
      <div className="flex flex-wrap gap-4">
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Return to</span>
          <select
            value={mode}
            onChange={(e) => {
              const value = e.target.value;
              set({ return: value === 'stay' ? undefined : value === 'home' ? 'home' : done.return?.startsWith('/') ? done.return : '/' });
            }}
            className="input w-[12rem]"
            aria-label="Return to"
          >
            <option value="stay">Stay on the done copy</option>
            <option value="home">This role's home</option>
            <option value="route">A route</option>
          </select>
        </label>
        {mode === 'route' && (
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">Route</span>
            <span className="block text-2xs text-text-tertiary mb-1">Dashboard-relative, starting with /.</span>
            <input
              type="text"
              value={done.return ?? ''}
              onChange={(e) => set({ return: e.target.value })}
              className="input w-[20rem]"
              aria-label="Return route"
            />
          </label>
        )}
        {mode !== 'stay' && (
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">After (seconds)</span>
            <span className="block text-2xs text-text-tertiary mb-1">0–60; empty is 2.</span>
            <input
              type="number" min={0} max={60}
              value={done.after_seconds ?? ''}
              onChange={(e) => set({ after_seconds: e.target.value === '' ? undefined : Number(e.target.value) })}
              className="input w-[12rem]"
              aria-label="Return after (seconds)"
            />
          </label>
        )}
      </div>
    </SectionGroup>
  );
}
