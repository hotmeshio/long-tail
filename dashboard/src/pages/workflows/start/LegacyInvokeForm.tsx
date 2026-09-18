import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LTWorkflowConfig } from '../../../api/types';
import { DEFAULT_ENVELOPE, extractDataFields, dataToFields, fieldsToJson } from './helpers';
import { EnvelopeEditor } from './EnvelopeEditor';
import { InvokeFooter } from './InvokeFooter';
import { INVOKE_HOSTS, type InvokeHost, type InvokeSubmission } from './use-invoke-submit';

const PREFILL_KEY = 'lt:invoke:prefill';

/**
 * The template-driven envelope form: fields inferred from envelope_schema
 * values, with a JSON view for anything the template cannot express. The
 * surface every workflow gets until it declares an input_schema. A prefill
 * merges over the template's `data`, so a caller can hand the form values it
 * already knows.
 */
export function LegacyInvokeForm({
  selected,
  metadata,
  submission,
  lead,
  prefill,
  host = INVOKE_HOSTS.PAGE,
}: {
  selected: LTWorkflowConfig;
  metadata: Record<string, unknown>;
  submission: InvokeSubmission;
  /** Content that scrolls with the form ahead of its fields: description, identity, options. */
  lead?: ReactNode;
  /** `data` values merged over the envelope template. */
  prefill?: Record<string, unknown>;
  host?: InvokeHost;
}) {
  const [jsonInput, setJsonInput] = useState(DEFAULT_ENVELOPE);
  const [parseError, setParseError] = useState('');
  const [formFields, setFormFields] = useState<Record<string, unknown>>({});
  const [isJsonMode, setIsJsonMode] = useState(false);

  // The template with the prefill folded into its data: the shape the fields and the JSON view both start from.
  const envelope = useMemo<Record<string, unknown> | null>(() => {
    const template = selected.envelope_schema ?? null;
    if (!prefill || Object.keys(prefill).length === 0) return template;
    const templateData = template?.data;
    const data = { ...(templateData && typeof templateData === 'object' ? (templateData as Record<string, unknown>) : {}), ...prefill };
    return { ...(template ?? {}), data };
  }, [selected.envelope_schema, prefill]);

  const dataFields = useMemo(() => extractDataFields(envelope), [envelope]);
  const hasFormView = dataFields.length > 0;

  useEffect(() => {
    setParseError('');
    submission.reset();

    // A registry hand-off arrives through sessionStorage and opens in JSON view.
    const handoff = host === INVOKE_HOSTS.PAGE ? sessionStorage.getItem(PREFILL_KEY) : null;
    if (handoff) {
      sessionStorage.removeItem(PREFILL_KEY);
      setJsonInput(handoff);
      try {
        const parsed = JSON.parse(handoff);
        const data = parsed?.data ?? parsed;
        if (data && typeof data === 'object') setFormFields(dataToFields(data));
      } catch { /* use as-is */ }
      setIsJsonMode(true);
      return;
    }

    setJsonInput(envelope ? JSON.stringify(envelope, null, 2) : DEFAULT_ENVELOPE);
    const data = envelope?.data;
    setFormFields(data && typeof data === 'object' ? dataToFields(data as Record<string, unknown>) : {});
    setIsJsonMode(!extractDataFields(envelope).length);
  }, [selected.workflow_type]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleMode = () => {
    if (isJsonMode) {
      try {
        const parsed = JSON.parse(jsonInput);
        if (parsed.data && typeof parsed.data === 'object') setFormFields(dataToFields(parsed.data));
      } catch { /* keep existing */ }
    } else {
      setJsonInput(fieldsToJson(formFields, metadata));
    }
    setIsJsonMode(!isJsonMode);
  };

  const updateFormField = (key: string, value: unknown, type: string) => {
    let parsed = value;
    if (type === 'number') parsed = value === '' ? 0 : Number(value);
    else if (type === 'boolean') parsed = value === 'true' || value === true;
    const updated = { ...formFields, [key]: parsed };
    setFormFields(updated);
    setJsonInput(fieldsToJson(updated, metadata));
  };

  const handleInvoke = () => {
    setParseError('');
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(jsonInput);
    } catch {
      setParseError('Invalid JSON');
      return;
    }
    const { data, metadata: envelopeMetadata } = envelope;
    if (!data || typeof data !== 'object') {
      setParseError('Envelope must include a "data" object');
      return;
    }
    void submission.submit(
      data as Record<string, unknown>,
      (envelopeMetadata as Record<string, unknown> | undefined) ?? {},
    );
  };

  return (
    <div>
      <div className="space-y-6 pb-6">
        {lead}
        <EnvelopeEditor
        selectedConfig={selected}
        isJsonMode={isJsonMode}
        hasFormView={hasFormView}
        jsonInput={jsonInput}
        formFields={formFields}
        dataFields={dataFields}
        onJsonChange={(v) => { setJsonInput(v); setParseError(''); }}
        onToggleMode={handleToggleMode}
        onUpdateFormField={updateFormField}
        onSetFormFields={setFormFields}
      />
      </div>
      <InvokeFooter
        onSubmitAgain={submission.reset}
        onSubmit={handleInvoke}
        pending={submission.pending}
        error={parseError || submission.error}
        startedId={submission.startedId}
        executionPath={submission.executionPath}
        host={host}
      />
    </div>
  );
}
