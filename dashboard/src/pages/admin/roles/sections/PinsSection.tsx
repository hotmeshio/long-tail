import { useState } from 'react';
import { Pin as PinIcon } from 'lucide-react';
import { useUpdateRole, type RoleDetail } from '../../../../api/roles';
import { SectionGroup, LiveBadge } from '../role-detail-shared';

/**
 * Default pins — the pinned-view seeds this role hands its members:
 * [{ label, url, badge? }]. Members see them in their Pinned nav section from
 * first login (marked role-provided) and may promote, hide, or reorder them
 * via preferences. Live-save.
 */
export function PinsSection({ role }: { role: RoleDetail }) {
  return (
    <SectionGroup
      icon={PinIcon}
      label="Default Pins"
      annotation="pinned views every member starts with"
      aside={<LiveBadge />}
      accent
    >
      <DefaultPinsEditor role={role} />
    </SectionGroup>
  );
}

function DefaultPinsEditor({ role }: { role: RoleDetail }) {
  const updateRole = useUpdateRole();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [badge, setBadge] = useState(true);

  const pins = role.default_pins ?? [];
  const save = (next: { label: string; url: string; badge?: boolean }[]) =>
    updateRole.mutate(
      { role: role.role, default_pins: next.length ? next : null },
      { onSuccess: () => { setLabel(''); setUrl(''); setBadge(true); } },
    );
  const canAdd = label.trim() !== '' && url.trim().startsWith('/');

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label — e.g. Needs harvesting"
          className="input text-xs w-40 shrink-0"
        />
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="/escalations/available?role=…"
          className="input text-xs font-mono flex-1"
        />
        <label className="flex items-center gap-1 text-2xs text-text-tertiary shrink-0" title="Show a live count beside the label">
          <input type="checkbox" checked={badge} onChange={(e) => setBadge(e.target.checked)} className="w-3 h-3 accent-accent" />
          count
        </label>
        <button
          onClick={() => { if (canAdd) save([...pins, { label: label.trim(), url: url.trim(), badge }]); }}
          disabled={!canAdd || updateRole.isPending}
          className="px-2.5 py-1 text-xs rounded bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          {updateRole.isPending ? '…' : 'Add'}
        </button>
      </div>
      {pins.length === 0 ? (
        <p className="text-2xs text-text-tertiary leading-relaxed">
          Pinned views every member starts with — the persona's exact queries.
          Add one above and it lands here.
        </p>
      ) : (
        <div className="space-y-1">
          {pins.map((p) => (
            <div key={p.label} className="flex items-baseline gap-2 text-2xs">
              <span className="font-medium text-text-secondary shrink-0">{p.label}</span>
              {p.badge && <span className="text-2xs text-accent shrink-0" title="Shows a live count">count</span>}
              <span className="font-mono text-text-quaternary truncate flex-1" title={p.url}>{p.url}</span>
              <button
                onClick={() => save(pins.filter((x) => x.label !== p.label))}
                className="text-text-quaternary hover:text-status-error transition-colors leading-none shrink-0"
                aria-label={`Remove pin ${p.label}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {updateRole.error && (
        <p className="text-2xs text-status-error">{(updateRole.error as Error).message}</p>
      )}
    </div>
  );
}
