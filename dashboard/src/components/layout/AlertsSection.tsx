import { useState } from 'react';
import { X } from 'lucide-react';
import { useAnnouncements, useCreateAnnouncement, useDeleteAnnouncement, type Announcement } from '../../api/announcements';
import { useRoles } from '../../api/roles';
import { DateValue } from '../common/display/DateValue';
import { PillMultiSelect } from '../common/form/PillMultiSelect';

/** Visible-for choices; expiry is computed at publish so no schema is needed. */
const DURATIONS = [
  { minutes: 1, label: '1 minute' },
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 240, label: '4 hours' },
  { minutes: 1440, label: '24 hours' },
  { minutes: 4320, label: '3 days' },
  { minutes: 10080, label: '7 days' },
];

/**
 * The Alerts panel of the about modal — publish a dashboard notice and manage
 * the live ones. Notices broadcast on system.surfaces.dashboard and render as
 * stacked banner rows; each active notice stays until it expires, is deleted
 * here, or the viewer dismisses it locally.
 */
export function AlertsSection() {
  const { data } = useAnnouncements();
  const { data: rolesData } = useRoles();
  const create = useCreateAnnouncement();
  const remove = useDeleteAnnouncement();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [minutes, setMinutes] = useState(1440);
  const [roles, setRoles] = useState<string[]>([]);

  const active = data?.announcements ?? [];

  const publish = () => {
    if (!body.trim()) return;
    create.mutate(
      {
        body: body.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(roles.length ? { roles } : {}),
        expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
      },
      {
        onSuccess: () => {
          setTitle('');
          setBody('');
          setRoles([]);
        },
      },
    );
  };

  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-widest text-text-tertiary mb-4">Alerts</p>

      <div className="space-y-3">
        <label className="block">
          <span className="block text-2xs text-text-tertiary mb-1">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional headline"
            className="input text-xs w-full"
          />
        </label>
        <label className="block">
          <span className="block text-2xs text-text-tertiary mb-1">Summary</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What everyone should know (markdown supported)"
            rows={3}
            className="input text-xs w-full resize-y"
          />
        </label>
        <label className="block">
          <span className="block text-2xs text-text-tertiary mb-1">Visible for</span>
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="select text-xs w-full"
          >
            {DURATIONS.map((d) => (
              <option key={d.minutes} value={d.minutes}>{d.label}</option>
            ))}
          </select>
        </label>
        <div className="block">
          <span className="block text-2xs text-text-tertiary mb-1">Visible to</span>
          <PillMultiSelect
            values={roles}
            options={rolesData?.roles ?? []}
            onChange={setRoles}
            addLabel="Add a role…"
            emptyText="Everyone"
            ariaLabel="Add a role"
          />
        </div>
        {create.error && <p className="text-xs text-status-error">{(create.error as Error).message}</p>}
        <button
          onClick={publish}
          disabled={!body.trim() || create.isPending}
          className="btn-primary text-xs w-full disabled:opacity-50"
        >
          {create.isPending ? 'Publishing…' : 'Publish alert'}
        </button>
      </div>

      {active.length > 0 && (
        <div className="mt-6">
          <p className="text-2xs text-text-tertiary mb-2">Active now — stacked as banner rows, newest first</p>
          <div className="space-y-1">
            {active.map((a: Announcement) => (
              <div key={a.id} className="flex items-start gap-2 py-1.5 border-b border-surface-border/40 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-text-primary truncate">{a.title ?? a.body.split('\n')[0]}</span>
                  <span className="block text-2xs text-text-tertiary">
                    expires <DateValue date={a.expires_at} format="relative" />
                  </span>
                </span>
                <button
                  onClick={() => remove.mutate(a.id)}
                  disabled={remove.isPending}
                  className="icon-link shrink-0 mt-0.5"
                  title="Remove for everyone"
                  aria-label={`Remove ${a.title ?? 'announcement'}`}
                >
                  <X className="w-3.5 h-3.5" strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
