import { useState } from 'react';
import { Pin as PinIcon, Braces } from 'lucide-react';
import { useUpdateRole, type RoleDetail } from '../../../../api/roles';
import { SectionGroup, LiveBadge, FACET_KEY } from '../role-detail-shared';
import { extractLinkVarNames, makePlaceholder } from '../../../../lib/link-vars';
import { useLinkVariables } from '../../../../hooks/useLinkVariables';

interface LinkVariableRow {
  name: string;
  label?: string;
  default?: string;
}

/**
 * Link variables + default pins. Variables lead: they are the vocabulary the
 * pins below may reference (`{lt:name}` as a facet value), so the reader
 * meets the declaration before the usage. Both live-save.
 */
export function PinsSection({ role }: { role: RoleDetail }) {
  return (
    <>
      <SectionGroup
        icon={Braces}
        label="Link Variables"
        annotation="facet names members bind per device — pins reference them as {lt:name}"
        aside={<LiveBadge />}
      >
        <LinkVariablesEditor role={role} />
      </SectionGroup>
      <SectionGroup
        icon={PinIcon}
        label="Default Pins"
        annotation="pinned views every member starts with"
        aside={<LiveBadge />}
        accent
      >
        <DefaultPinsEditor role={role} />
      </SectionGroup>
    </>
  );
}

function readLinkVariables(role: RoleDetail): LinkVariableRow[] {
  const declared = (role.properties as Record<string, unknown> | undefined)?.link_variables;
  if (!Array.isArray(declared)) return [];
  return declared.filter(
    (d): d is LinkVariableRow => typeof (d as LinkVariableRow)?.name === 'string',
  );
}

function LinkVariablesEditor({ role }: { role: RoleDetail }) {
  const updateRole = useUpdateRole();
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [dflt, setDflt] = useState('');

  const vars = readLinkVariables(role);
  // The bag is shared with other reserved + user keys — merge, never replace.
  const save = (next: LinkVariableRow[]) =>
    updateRole.mutate(
      {
        role: role.role,
        properties: {
          ...(role.properties ?? {}),
          link_variables: next.length ? next : undefined,
        },
      },
      { onSuccess: () => { setName(''); setLabel(''); setDflt(''); } },
    );

  const trimmed = name.trim();
  const canAdd = FACET_KEY.test(trimmed) && !vars.some((v) => v.name === trimmed);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="facet name — e.g. facility"
          className="input text-xs font-mono w-40 shrink-0"
        />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="label (optional)"
          className="input text-xs flex-1"
        />
        <input
          type="text"
          value={dflt}
          onChange={(e) => setDflt(e.target.value)}
          placeholder="default (optional)"
          className="input text-xs font-mono w-36 shrink-0"
        />
        <button
          onClick={() => {
            if (!canAdd) return;
            save([...vars, {
              name: trimmed,
              ...(label.trim() ? { label: label.trim() } : {}),
              ...(dflt.trim() ? { default: dflt.trim() } : {}),
            }]);
          }}
          disabled={!canAdd || updateRole.isPending}
          className="px-2.5 py-1 text-xs rounded bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          {updateRole.isPending ? '…' : 'Add'}
        </button>
      </div>
      {vars.length === 0 ? (
        <p className="text-2xs text-text-tertiary leading-relaxed">
          Facet names members bind per device. A pin below can then carry
          <span className="font-mono"> facets=&#123;"facility":"{'{lt:facility}'}"&#125; </span>
          and each station opens it scoped to its own value.
        </p>
      ) : (
        <div className="space-y-1">
          {vars.map((v) => (
            <div key={v.name} className="flex items-baseline gap-2 text-2xs" data-testid="link-var-decl">
              <span className="font-mono font-medium text-text-secondary shrink-0">{v.name}</span>
              {v.label && <span className="text-text-quaternary truncate">{v.label}</span>}
              <span className="font-mono text-text-quaternary truncate flex-1">
                {v.default ? `default: ${v.default}` : 'no default — unset drops the facet'}
              </span>
              <span className="font-mono text-text-quaternary shrink-0" title="Reference in a pin URL">
                {makePlaceholder(v.name)}
              </span>
              <button
                onClick={() => save(vars.filter((x) => x.name !== v.name))}
                className="text-text-quaternary hover:text-status-error transition-colors leading-none shrink-0"
                aria-label={`Remove variable ${v.name}`}
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

function DefaultPinsEditor({ role }: { role: RoleDetail }) {
  const updateRole = useUpdateRole();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [badge, setBadge] = useState(true);
  // The admin's own device bindings preview what a member at this device
  // would open — the caption under each templated pin shows the live binding.
  const { values, defaults } = useLinkVariables();

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
          placeholder={'/escalations/available?role=… or …facets={"facility":"{lt:facility}"}'}
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
          {pins.map((p) => {
            const varNames = extractLinkVarNames(p.url);
            return (
              <div key={p.label}>
                <div className="flex items-baseline gap-2 text-2xs">
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
                {varNames.length > 0 && (
                  <p className="pl-2 font-mono text-2xs text-text-quaternary" data-testid="pin-binding-caption">
                    {varNames.map((n) => {
                      const bound = values[n] ?? defaults[n];
                      return `${n} = ${bound ? `'${bound}'` : '<empty>'}`;
                    }).join(', ')}
                    <span className="font-sans"> on this device</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {updateRole.error && (
        <p className="text-2xs text-status-error">{(updateRole.error as Error).message}</p>
      )}
    </div>
  );
}
