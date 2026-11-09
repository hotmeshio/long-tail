import { useState, useEffect, useCallback, type MouseEvent, type ReactNode } from 'react';
import { LockedFormFrame } from './LockedFormFrame';
import { HelpCircle } from 'lucide-react';
import { evaluateShowIf, isHiddenField, isHiddenIfEmpty, type ShowIfContext } from '../../../lib/x-lt-show-if';
import { validateField } from '../../../lib/field-validator';
import { DISPLAY_ONLY_WIDGET_NAMES } from '../../../lib/display-only-widgets';
import { buildFormReview, readConfidenceSpec, summarizeReview } from '../../../lib/x-lt-confidence';
import { FieldRow } from './FieldRow';
import { FieldReview } from './FieldReview';
import { ReviewLegend } from './ReviewLegend';
import { formatReviewValue } from './review-value';
import { SectionGroup } from './SectionGroup';
import { DocumentPaneContext } from './document-pane';
import { type FormEntry, type JsonValue } from './form-cells';

/** `x-lt-layout: "split"`: documents in a pane beside the fields they verify. */
export const SPLIT_LAYOUT = 'split';

/** Clicks inside a live region of a locked form stay there, not on the claim nudge. */
const keepClick = (e: MouseEvent) => e.stopPropagation();

/**
 * Renders a JSON object as an editable form with typed inputs.
 *
 * - Strings → text input (textarea if > 80 chars)
 * - Booleans → toggle switch
 * - Numbers → number input
 * - Null → disabled placeholder
 * - Objects → nested section
 * - Arrays of strings → tag display
 * - Keys starting with `_` → hidden (preserved in output)
 *
 * Calls `onChange` with the full JSON string on every edit.
 */
export function ResolverForm({ value, onChange, disabled, submitAttempted, escalationContext, onOpenHelp, onDisabledClick, disabledHint }: {
  value: string;
  onChange: (json: string) => void;
  disabled?: boolean;
  submitAttempted?: boolean;
  escalationContext?: ShowIfContext;
  /** Opens the Instructions panel view; renders a help icon when the schema carries authored help. */
  onOpenHelp?: () => void;
  /** Fires when the user clicks the locked form — the page points them at Claim. */
  onDisabledClick?: () => void;
  /** Cursor-following hint over the locked form naming the state or gesture. */
  disabledHint?: ReactNode;
}) {
  const [data, setData] = useState<Record<string, JsonValue>>({});
  const [hidden, setHidden] = useState<Record<string, JsonValue>>({});
  const [formSchema, setFormSchema] = useState<Record<string, any> | null>(null);
  const [parseError, setParseError] = useState(false);
  const [touched, setTouched] = useState<Set<string>>(new Set());

  // Parse incoming JSON
  useEffect(() => {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const visible: Record<string, JsonValue> = {};
        const internal: Record<string, JsonValue> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (k.startsWith('_') || k.startsWith('$')) {
            internal[k] = v as JsonValue;
          } else {
            visible[k] = v as JsonValue;
          }
        }
        setData(visible);
        setHidden(internal);
        setFormSchema(
          internal._form_schema && typeof internal._form_schema === 'object'
            ? internal._form_schema as Record<string, any>
            : null,
        );
        setParseError(false);
      }
    } catch {
      setParseError(true);
    }
  }, [value]);

  const emitChange = useCallback((updated: Record<string, JsonValue>) => {
    setData(updated);
    onChange(JSON.stringify({ ...updated, ...hidden }, null, 2));
  }, [hidden, onChange]);

  const updateField = useCallback((key: string, val: JsonValue) => {
    emitChange({ ...data, [key]: val });
  }, [data, emitChange]);

  const markTouched = useCallback((key: string) => {
    setTouched((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  if (parseError) {
    return (
      <p className="text-xs text-status-error">
        Unable to parse resolver data as form. Use the JSON editor below.
      </p>
    );
  }

  const allEntries = Object.entries(data);
  if (allEntries.length === 0) {
    return (
      <p className="text-xs text-text-tertiary italic">
        No resolver fields defined.
      </p>
    );
  }

  // Field ordering via x-lt-order
  const fieldOrder = formSchema?.['x-lt-order'] as string[] | undefined;
  const ordered = fieldOrder
    ? [...allEntries].sort((a, b) => {
        const ai = fieldOrder.indexOf(a[0]);
        const bi = fieldOrder.indexOf(b[0]);
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      })
    : allEntries;

  // Merge current form data into the resolver domain so x-lt-showIf: 'resolver.field'
  // reacts to live edits — the parent context only carries the saved row state.
  const liveCtx: ShowIfContext = { ...(escalationContext ?? {}), resolver: data as Record<string, unknown>, input: data as Record<string, unknown> };

  // Visibility via x-lt-hidden, x-lt-showIf and x-lt-hide-if-empty; a hidden
  // field keeps its value in the payload.
  const entries = ordered.filter(([key, val]) => {
    const fieldSchema = formSchema?.properties?.[key] as Record<string, unknown> | undefined;
    if (isHiddenField(fieldSchema)) return false;
    if (!evaluateShowIf(fieldSchema?.['x-lt-showIf'], liveCtx)) return false;
    return !isHiddenIfEmpty(fieldSchema, val);
  });

  const requiredFields = new Set(formSchema?.required as string[] ?? []);
  const layout = formSchema?.['x-lt-layout'] as string | undefined;
  const isDocumentField = (key: string) =>
    (formSchema?.properties?.[key] as Record<string, unknown> | undefined)?.['x-lt-widget'] === DISPLAY_ONLY_WIDGET_NAMES.DOCUMENT;
  const isSplit = layout === SPLIT_LAYOUT && entries.some(([key]) => isDocumentField(key));
  const paneEntries = isSplit ? entries.filter(([key]) => isDocumentField(key)) : [];
  const fieldEntries = isSplit ? entries.filter(([key]) => !isDocumentField(key)) : entries;

  // Model review: proposals and scores from the envelope, against the live
  // answers (or, on a resolved row, the answers submitted).
  const confidence = readConfidenceSpec(formSchema);
  const review = confidence && formSchema
    ? buildFormReview(confidence, formSchema, liveCtx as Record<string, unknown>, data as Record<string, unknown>)
    : null;
  const shownKeys = entries.map(([key]) => key);
  const reviewSummary = confidence && review ? summarizeReview(confidence, review, shownKeys) : null;
  const proposedCount = review ? shownKeys.filter((key) => review[key]?.hasProposal).length : 0;
  const schemaTitle = formSchema?.title as string | undefined;
  const schemaDescription = formSchema?.description as string | undefined;
  const hasAuthoredHelp =
    typeof formSchema?.['x-lt-help'] === 'string' || typeof formSchema?.['x-lt-context'] === 'string';

  // Group entries by x-lt-section for labeled visual grouping.
  // Fields without x-lt-section or with an empty value form an unnamed group.
  type Section = { name: string | null; entries: FormEntry[] };
  const sectionGroups: Section[] = [];
  for (const entry of fieldEntries) {
    const [key] = entry;
    const fieldSchema = formSchema?.properties?.[key] as Record<string, unknown> | undefined;
    const sectionName = (fieldSchema?.['x-lt-section'] as string | undefined)?.trim() || null;
    const last = sectionGroups[sectionGroups.length - 1];
    if (!last || last.name !== sectionName) {
      sectionGroups.push({ name: sectionName, entries: [entry] });
    } else {
      last.entries.push(entry);
    }
  }

  const renderField = ([key, val]: FormEntry) => {
    const fieldSchema = formSchema?.properties?.[key] as Record<string, unknown> | undefined;
    const isReadOnly = fieldSchema?.readOnly === true;
    const span = (fieldSchema?.['x-lt-span'] as number) ?? 1;
    const isReq = requiredFields.has(key);
    const isTouched = touched.has(key) || !!submitAttempted;

    const error = validateField(val, fieldSchema, isReq, isTouched, liveCtx as Record<string, unknown>);
    // A locked form locks each field; a document stays readable and pageable.
    const isLive = isDocumentField(key);
    const locked = !!disabled && !isLive;
    const fieldReview = review?.[key];

    const row = (
      <FieldRow
        fieldKey={key}
        value={val}
        onChange={(v) => updateField(key, v)}
        onBlur={() => markTouched(key)}
        schema={formSchema}
        isRequired={isReq}
        isReadOnly={isReadOnly}
        error={error}
        escalationContext={liveCtx}
        submitAttempted={!!submitAttempted}
      />
    );

    return (
      <div
        key={key}
        className={`animate-[field-enter_0.2s_ease-out] ${layout === 'two-column' && span >= 2 ? 'col-span-full' : ''} ${locked ? 'pointer-events-none' : ''}`}
        inert={locked || undefined}
        onClick={disabled && isLive ? keepClick : undefined}
      >
        {fieldReview ? (
          <FieldReview
            fieldKey={key}
            review={fieldReview}
            proposedText={formatReviewValue(fieldReview.proposed, fieldSchema, liveCtx as Record<string, unknown>)}
            currentText={formatReviewValue(val, fieldSchema, liveCtx as Record<string, unknown>)}
            locked={!!disabled || isReadOnly}
            onRestore={() => updateField(key, (fieldReview.proposed ?? '') as JsonValue)}
          >
            {row}
          </FieldReview>
        ) : row}
      </div>
    );
  };

  const sections = (
    <div className="space-y-8">
      {sectionGroups.map((group, i) => (
        <SectionGroup
          key={group.name ?? `__s${i}`}
          name={group.name}
          entries={group.entries}
          formSchema={formSchema}
          layout={isSplit ? undefined : layout}
          renderField={renderField}
        />
      ))}
    </div>
  );

  // Split: the pane holds the documents and stays in view while the fields
  // beside it scroll; below the split width the pane stacks above them.
  const content = isSplit ? (
    <div className="@container">
      <div className="grid grid-cols-1 @split:grid-cols-2 gap-x-col-gap gap-y-8 items-start">
        <DocumentPaneContext.Provider value={{ fill: paneEntries.length === 1 }}>
          <div className="@split:sticky @split:top-0 @split:max-h-[calc(100dvh-10rem)] @split:overflow-y-auto space-y-12">
            {paneEntries.map((entry) => renderField(entry))}
          </div>
        </DocumentPaneContext.Provider>
        {sections}
      </div>
    </div>
  ) : sections;

  // A locked form stays fully readable, with no fade. `inert` (not just
  // pointer-events) locks each field for keyboard and assistive-tech users,
  // so fields leave the tab order entirely, and makes them transparent to hit
  // testing, so a click on a locked field lands on the frame, which reports
  // the interaction and carries the cursor hint. Documents and the review
  // key stay live: reading is not editing.
  // max-w-form: the form holds a readable measure on any monitor; a split
  // form holds two.
  const body = (
      <div aria-disabled={disabled || undefined}>
      <div className={disabled ? 'pointer-events-none' : undefined} inert={disabled || undefined}>
      {schemaTitle && (
        <div className="mb-1 flex items-center gap-1.5">
          <h3 className="heading-3">{schemaTitle}</h3>
          {hasAuthoredHelp && onOpenHelp && (
            <button
              type="button"
              onClick={onOpenHelp}
              title="Open instructions"
              aria-label="Open instructions"
              className="p-1 rounded-md text-text-tertiary hover:text-accent hover:bg-surface-hover transition-colors"
            >
              <HelpCircle className="w-4 h-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
      )}
      {schemaDescription && (
        <p className="text-sm text-text-secondary leading-relaxed mb-6">{schemaDescription}</p>
      )}
      </div>

      {reviewSummary && (
        <div onClick={disabled ? keepClick : undefined}>
          <ReviewLegend summary={reviewSummary} proposedCount={proposedCount} />
        </div>
      )}

      {content}
      </div>
  );

  const measure = isSplit ? 'max-w-[min(112rem,100%)]' : 'max-w-form';
  if (disabled) {
    return (
      <LockedFormFrame hint={disabledHint} onLockedClick={onDisabledClick} measure={measure}>
        {body}
      </LockedFormFrame>
    );
  }
  return <div className={`pb-8 ${measure}`}>{body}</div>;
}
