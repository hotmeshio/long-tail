import { SCAN_VERBS, type ScanStep } from '../../../api/scan-codes';
import { IntoSubjectItemFields } from './IntoSubjectItemFields';

type Params = NonNullable<ScanStep['params']>;

/** "11, 15" ⇄ [11, 15]; anything that is not a scheme version drops out. */
function parseSchemes(text: string): number[] {
  return text.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 10 && n <= 99);
}

function parseList(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * The editor for a step that holds an item or acts on the held one: the hold
 * itself (how long, what to ask for next), and the container scan that pairs
 * with it (which scans it follows, what it must match, what it says when it
 * refuses).
 */
export function SubjectStepFields({
  step,
  onPatch,
}: {
  step: ScanStep;
  onPatch: (patch: Partial<ScanStep>) => void;
}) {
  const params: Params = step.params ?? {};
  const patchParams = (patch: Partial<Params>) => onPatch({ params: { ...params, ...patch } });
  const accumulate = params.accumulate ?? {};
  const mode = accumulate.from ? 'from' : accumulate.into ? 'into' : '';

  if (step.verb === SCAN_VERBS.HOLD) {
    const hold = params.hold ?? {};
    const patchHold = (patch: Partial<NonNullable<Params['hold']>>) => patchParams({ hold: { ...hold, ...patch } });
    return (
      <div className="flex flex-wrap gap-4">
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Hold for (seconds)</span>
          <span className="block text-2xs text-text-tertiary mb-1">How long the station waits for the next scan (5–600, default 45).</span>
          <input
            type="number" min={5} max={600}
            value={hold.ttlSeconds ?? ''}
            onChange={(e) => patchHold({ ttlSeconds: e.target.value ? Number(e.target.value) : undefined })}
            className="input w-[10rem]"
            placeholder="45"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Next scan schemes</span>
          <span className="block text-2xs text-text-tertiary mb-1">The scheme versions expected next, e.g. 14.</span>
          <input
            value={(hold.expect?.schemes ?? []).join(', ')}
            onChange={(e) => {
              const schemes = parseSchemes(e.target.value);
              patchHold({ expect: schemes.length ? { ...hold.expect, schemes } : undefined });
            }}
            className="input w-[10rem] font-mono"
            placeholder="14"
            aria-label="Next scan schemes"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Headline</span>
          <span className="block text-2xs text-text-tertiary mb-1">Where it goes, shown largest. {'{item.<facet>}'} reads the held row.</span>
          <input
            value={hold.headline ?? ''}
            onChange={(e) => patchHold({ headline: e.target.value || undefined })}
            className="input w-[14rem] font-mono"
            placeholder="{item.containerCode}"
            aria-label="Headline"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Under the headline</span>
          <span className="block text-2xs text-text-tertiary mb-1">A place name, e.g. the facility.</span>
          <input
            value={hold.subline ?? ''}
            onChange={(e) => patchHold({ subline: e.target.value || undefined })}
            className="input w-[14rem] font-mono"
            placeholder="{item.locationName}"
            aria-label="Under the headline"
          />
        </label>
        <label className="block flex-1 min-w-[16rem]">
          <span className="block text-xs text-text-secondary mb-1">Ask for it</span>
          <span className="block text-2xs text-text-tertiary mb-1">
            Markdown the station shows while holding. {'{item.<facet>}'} reads the held row.
          </span>
          <input
            value={hold.expect?.prompt ?? ''}
            onChange={(e) => hold.expect && patchHold({ expect: { ...hold.expect, prompt: e.target.value || undefined } })}
            disabled={!hold.expect}
            className="input w-full"
            placeholder="Walk to **{item.containerCode}** and scan it."
            aria-label="Ask for it"
          />
        </label>
      </div>
    );
  }

  const fillsSubject = step.verb === SCAN_VERBS.FILL;
  if (step.verb !== SCAN_VERBS.ACCUMULATE && !fillsSubject) return null;

  const setMode = (next: '' | 'from' | 'into') => {
    const { from: _f, into: _i, item, ...rest } = accumulate;
    onPatch({
      params: {
        ...params,
        accumulate: {
          ...rest,
          ...(next === 'from' ? { from: 'subject' as const } : {}),
          ...(next === 'into' ? { into: 'subject' as const, ...(item ? { item } : {}) } : {}),
        },
      },
      subject: next ? step.subject ?? { schemes: [] } : undefined,
      match: next ? step.match : undefined,
      refuse: next ? step.refuse : undefined,
    });
  };

  const fill = params.fill ?? { into: 'subject' as const };
  const actsOnSubject = fillsSubject ? fill.into === 'subject' : !!mode;

  return (
    <div className="flex flex-wrap gap-4">
      {fillsSubject ? (
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Check off on</span>
          <span className="block text-2xs text-text-tertiary mb-1">The row whose expected items the scan checks off.</span>
          <select
            value={fill.into}
            onChange={(e) => onPatch({
              params: { ...params, fill: { ...fill, into: e.target.value as 'subject' | 'scanned' } },
              subject: e.target.value === 'subject' ? step.subject ?? { schemes: [] } : undefined,
            })}
            className="select"
          >
            <option value="subject">The held item</option>
            <option value="scanned">The scanned row</option>
          </select>
        </label>
      ) : (
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Held item</span>
          <span className="block text-2xs text-text-tertiary mb-1">Pair this scan with the item the station is holding.</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as '' | 'from' | 'into')} className="select">
            <option value="">Not used</option>
            <option value="from">Goes into the scanned container</option>
            <option value="into">Takes the scanned code</option>
          </select>
        </label>
      )}
      {actsOnSubject && (
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Held from schemes <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">The schemes the held item was scanned under, e.g. 11.</span>
          <input
            value={(step.subject?.schemes ?? []).join(', ')}
            onChange={(e) => onPatch({ subject: { ...step.subject, schemes: parseSchemes(e.target.value) } })}
            className="input w-[10rem] font-mono"
            placeholder="11"
            aria-label="Held from schemes"
          />
        </label>
      )}
      {actsOnSubject && (
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Only when the held item has</span>
          <span className="block text-2xs text-text-tertiary mb-1">facet=value pairs, comma-separated; otherwise the next step runs.</span>
          <input
            value={Object.entries(step.subject?.facets ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')}
            onChange={(e) => {
              const facets = Object.fromEntries(parseList(e.target.value)
                .map((pair) => pair.split('=').map((s) => s.trim()))
                .filter(([k, v]) => k && v !== undefined && v !== ''));
              const { facets: _old, ...gate } = step.subject ?? { schemes: [] };
              onPatch({ subject: Object.keys(facets).length ? { ...gate, facets } : gate });
            }}
            className="input w-[14rem] font-mono"
            placeholder="placement=unassigned"
            aria-label="Only when the held item has"
          />
        </label>
      )}
      {actsOnSubject && !fillsSubject && (
        <label className="block flex-1 min-w-[14rem]">
          <span className="block text-xs text-text-secondary mb-1">Must match</span>
          <span className="block text-2xs text-text-tertiary mb-1">
            The scanned code must equal one of these, comma-separated, e.g. {'{subject.containerCode}'}; a list facet such as {'{subject.offeredContainers}'} allows every entry.
          </span>
          <input
            value={(step.match?.target ?? []).join(', ')}
            onChange={(e) => {
              const target = parseList(e.target.value);
              onPatch({ match: target.length || step.match?.facets ? { ...step.match, target: target.length ? target : undefined } : undefined });
            }}
            className="input w-full font-mono"
            placeholder="{subject.containerCode}"
            aria-label="Must match"
          />
        </label>
      )}
      {mode === 'from' && (
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Shared facets</span>
          <span className="block text-2xs text-text-tertiary mb-1">The container must carry the held item's value for these.</span>
          <input
            value={(step.match?.facets ?? []).join(', ')}
            onChange={(e) => {
              const facets = parseList(e.target.value);
              onPatch({ match: facets.length || step.match?.target ? { ...step.match, facets: facets.length ? facets : undefined } : undefined });
            }}
            className="input w-[12rem] font-mono"
            placeholder="containerKey"
            aria-label="Shared facets"
          />
        </label>
      )}
      {mode === 'from' && step.refuse && (
        <label className="block basis-full">
          <span className="block text-xs text-text-secondary mb-1">When no open container carries it</span>
          <span className="block text-2xs text-text-tertiary mb-1">
            What the station says when the scan is right but nothing is open under that code. Empty: the next step runs.
          </span>
          <input
            value={step.refuse.missing ?? ''}
            onChange={(e) => onPatch({ refuse: { ...step.refuse!, missing: e.target.value || undefined } })}
            className="input w-full"
            placeholder="That container was just taken. Scan the item again."
            aria-label="When no open container carries it"
          />
        </label>
      )}
      {mode === 'into' && <IntoSubjectItemFields step={step} onPatch={onPatch} />}
      {actsOnSubject && (
        <label className="block basis-full">
          <span className="block text-xs text-text-secondary mb-1">When it lands</span>
          <span className="block text-2xs text-text-tertiary mb-1">
            What the station shows, large, once the write lands. Same tokens as the line below.
          </span>
          <input
            value={step.done?.markdown ?? ''}
            onChange={(e) => onPatch({ done: e.target.value ? { markdown: e.target.value } : undefined })}
            className="input w-full"
            placeholder={fillsSubject ? '{fill.filled} of {fill.total} checked off.' : 'Place it in **{container.containerCode}**. All good.'}
            aria-label="When it lands"
          />
        </label>
      )}
      {actsOnSubject && (
        <label className="block basis-full">
          <span className="block text-xs text-text-secondary mb-1">When it is the wrong one</span>
          <span className="block text-2xs text-text-tertiary mb-1">
            What the station says. {'{subject.<facet>}'} reads the held item{mode === 'from' ? <>, {'{container.<facet>}'} the scanned container</> : null}{mode === 'into' && accumulate.item ? <>, {'{item.<facet>}'} the scanned item's row</> : null}{fillsSubject ? <>, {'{fill.pending}'} what is still expected</> : null}.
          </span>
          <input
            value={step.refuse?.markdown ?? ''}
            onChange={(e) => onPatch({ refuse: e.target.value ? { ...step.refuse, markdown: e.target.value } : undefined })}
            className="input w-full"
            placeholder="This one goes in **{subject.containerCode}**."
            aria-label="When it is the wrong one"
          />
        </label>
      )}
    </div>
  );
}
