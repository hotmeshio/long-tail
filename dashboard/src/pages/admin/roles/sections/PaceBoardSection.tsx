import { useState, useMemo } from 'react';
import { LayoutDashboard, Gauge, Fingerprint, GitBranch } from 'lucide-react';
import { useUpdateRole, type RoleDetail } from '../../../../api/roles';
import {
  SectionGroup,
  LiveBadge,
  Toggle,
  PillWell,
  type SectionProps,
} from '../role-detail-shared';

/**
 * Pace Board — everything the board consumes about this role, in one column:
 * station visibility, the capacity triangle, the priority dials, the entity
 * declaration, and the sequence placement. The dials stay editable even while
 * the station is hidden (they also drive jeopardy in the queues); only the
 * sequence placement collapses with visibility, since it is board geometry.
 */
export function PaceBoardSection({
  role,
  allRoles,
  draft,
  update,
  errors,
}: SectionProps & { allRoles: RoleDetail[] }) {
  // Any two capacity settings derive the third — hint the missing one.
  const sla = parseFloat(draft.sla_minutes);
  const tph = parseFloat(draft.target_per_hour);
  const wc = parseFloat(draft.worker_count);
  const slaOk = !isNaN(sla) && sla > 0;
  const tphOk = !isNaN(tph) && tph > 0;
  const wcOk = !isNaN(wc) && wc > 0;
  const derivedCapacityHint =
    slaOk && wcOk && !tphOk ? `→ target ≈ ${(wc / (sla / 60)).toFixed(1)}/h` :
    slaOk && tphOk && !wcOk ? `→ workers ≈ ${(tph * (sla / 60)).toFixed(1)}` :
    tphOk && wcOk && !slaOk ? `→ SLA ≈ ${(wc / tph * 60).toFixed(0)}m` : null;

  const availableParents = useMemo(
    () => allRoles.filter((r) => {
      if (r.role === role.role) return false;
      let cur: RoleDetail | undefined = r;
      const seen = new Set<string>();
      while (cur?.parent_role) {
        if (cur.parent_role === role.role) return false;
        if (seen.has(cur.parent_role)) break;
        seen.add(cur.parent_role);
        cur = allRoles.find((x) => x.role === cur!.parent_role);
      }
      return true;
    }),
    [allRoles, role],
  );

  return (
    <div className="space-y-14">
      {/* Station visibility leads — the section's headline decision */}
      <SectionGroup icon={LayoutDashboard} label="Station" annotation="this role on the Pace Board" accent>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-text-secondary">Show as a station on the Pace Board</p>
            <p className="text-2xs text-text-tertiary leading-relaxed mt-1">
              Stations appear on the Operations chart and table with live counts,
              pace, and the time-in-state mix.
            </p>
          </div>
          <Toggle
            checked={draft.ops_visible}
            onChange={() => update({ ops_visible: !draft.ops_visible })}
            title="Show as a station on the Pace Board"
          />
        </div>
      </SectionGroup>

      {/* Capacity triangle — any two derive the third */}
      <SectionGroup
        icon={Gauge}
        label="Capacity"
        annotation="throughput = workers / (sla / 60)"
      >
        <div className="flex items-end gap-6">
          {[
            { key: 'sla_minutes' as const,     label: 'SLA',     unit: 'min', placeholder: '30' },
            { key: 'target_per_hour' as const, label: 'Target',  unit: '/h',  placeholder: '20' },
            { key: 'worker_count' as const,    label: 'Workers', unit: '',    placeholder: '4' },
          ].map(({ key, label, unit, placeholder }) => (
            <div key={key}>
              <label className="block text-2xs font-semibold uppercase tracking-widest text-text-quaternary mb-1">
                {label}
                {unit && <span className="normal-case font-normal ml-1">{unit}</span>}
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={draft[key]}
                onChange={(e) => update({ [key]: e.target.value })}
                placeholder={placeholder}
                className="input text-xs w-20 font-mono"
              />
            </div>
          ))}
          {derivedCapacityHint && (
            <span className="text-2xs text-accent font-mono whitespace-nowrap pb-2">
              {derivedCapacityHint}
            </span>
          )}
        </div>
      </SectionGroup>

      {/* Priority dials — feed the board's priority count and the jeopardy filter */}
      <SectionGroup icon={Gauge} label="Priority" annotation="when a pending item counts as overdue">
        <div className="flex items-end gap-6">
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-widest text-text-quaternary mb-1">
              Threshold
              <span className="normal-case font-normal ml-1">min</span>
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={draft.priority_threshold_minutes}
              onChange={(e) => update({ priority_threshold_minutes: e.target.value })}
              placeholder={draft.sla_minutes || '60'}
              className="input text-xs w-20 font-mono"
            />
          </div>
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-widest text-text-quaternary mb-1">
              Age Facet
            </label>
            <input
              type="text"
              value={draft.priority_facet}
              onChange={(e) => update({ priority_facet: e.target.value })}
              placeholder="created_at"
              className="input text-xs w-36 font-mono"
            />
            {errors.priority_facet && (
              <p className="text-2xs text-status-error mt-0.5">{errors.priority_facet}</p>
            )}
          </div>
        </div>
        <p className="text-2xs text-text-tertiary leading-relaxed mt-3">
          Pending unclaimed items older than the threshold count as priority.
          Age is measured from the metadata facet (an ISO 8601 UTC timestamp,
          e.g. <code className="font-mono">authorized_at</code>) or from{' '}
          <code className="font-mono">created_at</code> when blank; the
          threshold falls back to SLA when blank.
        </p>
      </SectionGroup>

      {/* Entity — the analytics unlock, given the room it earns */}
      <SectionGroup icon={Fingerprint} label="Entity" annotation="what moves through this station" accent>
        <input
          type="text"
          value={draft.entity_facet}
          onChange={(e) => update({ entity_facet: e.target.value })}
          placeholder="serialNumber"
          className="input text-xs w-44 font-mono"
        />
        {errors.entity_facet && (
          <p className="text-2xs text-status-error mt-0.5">{errors.entity_facet}</p>
        )}
        <p className="text-2xs text-text-tertiary leading-relaxed mt-3">
          The metadata key naming the entity that moves through this station —{' '}
          <code className="font-mono">serialNumber</code>,{' '}
          <code className="font-mono">orderId</code>. Roles sharing a key form
          that entity's system: its state mix, per-entity dwell, and timelines
          all derive from it. Blank = the role has no entity notion.
        </p>

        {draft.entity_facet.trim() !== '' && (
          <div className="mt-5">
            <label className="block text-2xs font-semibold uppercase tracking-widest text-text-quaternary mb-1.5">
              States from
            </label>
            <div className="flex items-center gap-1">
              {([
                { value: 'role' as const, label: 'Station' },
                { value: 'subtype' as const, label: 'Subtypes' },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => update({ entity_state_source: value })}
                  className={`px-2.5 py-1 text-2xs rounded transition-colors ${
                    draft.entity_state_source === value
                      ? 'bg-accent/10 text-accent font-semibold'
                      : 'icon-link'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-2xs text-text-tertiary leading-relaxed mt-1.5">
              How this station names the entity's state. <strong>Station</strong>:
              being here is one state (a servicing or harvesting queue).{' '}
              <strong>Subtypes</strong>: this one role holds several states,
              named by each escalation's subtype (a fleet role parking{' '}
              <code className="font-mono">ready</code> /{' '}
              <code className="font-mono">printing</code>).
            </p>
          </div>
        )}
      </SectionGroup>

      {/* Sequence placement — board geometry, so it eases with visibility. */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          draft.ops_visible ? 'opacity-100 max-h-[900px]' : 'opacity-0 max-h-0 pointer-events-none'
        }`}
        aria-hidden={!draft.ops_visible}
      >
        <SectionGroup icon={GitBranch} label="Sequence" annotation="where this station sits on the floor">
          <div className="space-y-8">
            <div>
              <label className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
                Prior Step
              </label>
              <select
                value={draft.parent_role}
                onChange={(e) => update({ parent_role: e.target.value })}
                className="select text-sm w-full font-mono"
              >
                <option value="">None — root process</option>
                {availableParents.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.title ? `${r.role} — ${r.title}` : r.role}
                  </option>
                ))}
              </select>
              <p className="text-2xs text-text-tertiary leading-relaxed mt-1.5">
                Places this role in one Pace Board sequence. A role with no prior
                step starts its own sequence.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
                  Upstream Inputs
                </label>
                <LiveBadge />
              </div>
              <UpstreamSection role={role} allRoles={allRoles} />
            </div>

            <div>
              <div className="flex items-center justify-between gap-4">
                <label className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
                  Home Segment
                </label>
                <Toggle
                  checked={draft.ops_home_default}
                  onChange={() => update({ ops_home_default: !draft.ops_home_default })}
                  title="Lead the home Pace Board with this role's sequence"
                />
              </div>
              <p className="text-2xs text-text-tertiary leading-relaxed mt-1.5">
                Lead the home page's Pace Board with this role's sequence.
                One role holds this — saving it here releases the previous
                holder. Unset everywhere, the board opens on its first
                sequence.
              </p>
            </div>
          </div>
        </SectionGroup>
      </div>
    </div>
  );
}

/**
 * The graph edges that don't fit the line. Prior Step (parent_role) places
 * this role in ONE sequence on the Operations page; upstream inputs declare
 * the roles it also draws from in OTHER sequences — mixin-like, many allowed.
 * The chart shows them as a merge glyph on the station, never as a bend in
 * the sequence. Live-save.
 */
function UpstreamSection({ role, allRoles }: { role: RoleDetail; allRoles: RoleDetail[] }) {
  const updateRole = useUpdateRole();
  const [newUpstream, setNewUpstream] = useState('');

  const upstreams = role.upstream_roles ?? [];
  const available = useMemo(
    () => allRoles
      .map((r) => r.role)
      .filter((r) => r !== role.role && r !== 'superadmin' && !upstreams.includes(r)),
    [allRoles, role.role, upstreams],
  );

  const save = (next: string[]) =>
    updateRole.mutate({ role: role.role, upstream_roles: next }, { onSuccess: () => setNewUpstream('') });

  return (
    <div className="space-y-2">
      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={newUpstream}
            onChange={(e) => setNewUpstream(e.target.value)}
            className="select text-xs font-mono flex-1"
          >
            <option value="">Add upstream input…</option>
            {available.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={() => { if (newUpstream) save([...upstreams, newUpstream]); }}
            disabled={!newUpstream || updateRole.isPending}
            className="px-2.5 py-1 text-xs rounded bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {updateRole.isPending ? '…' : 'Add'}
          </button>
        </div>
      )}
      <PillWell
        items={upstreams}
        empty="Roles from other sequences this station draws input from. Add one above and it lands here."
        onRemove={(u) => save(upstreams.filter((x) => x !== u))}
      />
      {updateRole.error && (
        <p className="text-2xs text-status-error">{(updateRole.error as Error).message}</p>
      )}
    </div>
  );
}
