import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInvokeWorkflow } from '../../../api/workflows';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { Pill } from '../../../components/common/display/Pill';
import { useAuth } from '../../../hooks/useAuth';
import type { LTWorkflowConfig } from '../../../api/types';
import {
  DEFAULT_ENVELOPE,
  extractDataFields,
  dataToFields,
  fieldsToJson,
} from './helpers';
import { IdentitySummary } from './IdentitySummary';
import { EnvelopeEditor } from './EnvelopeEditor';

export function StartNowPanel({ selected, executionsPath }: { selected: LTWorkflowConfig; executionsPath: string }) {
  const navigate = useNavigate();
  const { isSuperAdmin, hasRoleType } = useAuth();
  const isAdmin = isSuperAdmin || hasRoleType('admin');
  const invokeMutation = useInvokeWorkflow();
  const [jsonInput, setJsonInput] = useState(DEFAULT_ENVELOPE);
  const [parseError, setParseError] = useState('');
  const [formFields, setFormFields] = useState<Record<string, unknown>>({});
  const [isJsonMode, setIsJsonMode] = useState(false);
  const [overrideBot, setOverrideBot] = useState('');

  const dataFields = useMemo(
    () => extractDataFields(selected.envelope_schema ?? null),
    [selected.envelope_schema],
  );
  const hasFormView = dataFields.length > 0;

  const schemaMetadata = useMemo(() => {
    if (!selected.envelope_schema) return {};
    const md = selected.envelope_schema.metadata;
    return md && typeof md === 'object' ? (md as Record<string, unknown>) : {};
  }, [selected.envelope_schema]);

  useEffect(() => {
    setParseError('');
    invokeMutation.reset();

    const prefill = sessionStorage.getItem('lt:invoke:prefill');
    if (prefill) {
      sessionStorage.removeItem('lt:invoke:prefill');
      setJsonInput(prefill);
      try {
        const parsed = JSON.parse(prefill);
        const data = parsed?.data ?? parsed;
        if (data && typeof data === 'object') setFormFields(dataToFields(data));
      } catch { /* use as-is */ }
      setIsJsonMode(true);
      setOverrideBot('');
      return;
    }

    const json = selected.envelope_schema
      ? JSON.stringify(selected.envelope_schema, null, 2)
      : DEFAULT_ENVELOPE;
    setJsonInput(json);
    if (selected.envelope_schema?.data && typeof selected.envelope_schema.data === 'object') {
      setFormFields(dataToFields(selected.envelope_schema.data as Record<string, unknown>));
    } else {
      setFormFields({});
    }
    setIsJsonMode(!extractDataFields(selected.envelope_schema ?? null).length);
    setOverrideBot('');
  }, [selected.workflow_type]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleMode = () => {
    if (isJsonMode) {
      try {
        const parsed = JSON.parse(jsonInput);
        if (parsed.data && typeof parsed.data === 'object') setFormFields(dataToFields(parsed.data));
      } catch { /* keep existing */ }
    } else {
      setJsonInput(fieldsToJson(formFields, schemaMetadata));
    }
    setIsJsonMode(!isJsonMode);
  };

  const updateFormField = (key: string, value: unknown, type: string) => {
    let parsed = value;
    if (type === 'number') parsed = value === '' ? 0 : Number(value);
    else if (type === 'boolean') parsed = value === 'true' || value === true;
    const updated = { ...formFields, [key]: parsed };
    setFormFields(updated);
    setJsonInput(fieldsToJson(updated, schemaMetadata));
  };

  const handleInvoke = async () => {
    setParseError('');
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(jsonInput);
    } catch {
      setParseError('Invalid JSON');
      return;
    }
    const { data, metadata } = envelope;
    if (!data || typeof data !== 'object') {
      setParseError('Envelope must include a "data" object');
      return;
    }
    try {
      await invokeMutation.mutateAsync({
        workflowType: selected.workflow_type,
        data: data as Record<string, unknown>,
        metadata: (metadata as Record<string, unknown>) ?? undefined,
        ...(overrideBot ? { execute_as: overrideBot } : {}),
      });
      navigate(executionsPath);
    } catch { /* error via mutation */ }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <SectionLabel>{selected.workflow_type}</SectionLabel>
          <div className="flex gap-2">
            {selected.roles.map((r) => (
              <Pill key={r}>{r}</Pill>
            ))}
          </div>
        </div>
        {selected.description && (
          <p className="text-sm text-text-secondary mt-2 leading-relaxed">
            {selected.description}
          </p>
        )}
      </div>

      <IdentitySummary
        config={selected}
        overrideBot={overrideBot}
        onOverrideChange={setOverrideBot}
        showOverride={isAdmin}
      />

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

      {parseError && <p className="text-xs text-status-error">{parseError}</p>}
      {invokeMutation.error && <p className="text-xs text-status-error">{invokeMutation.error.message}</p>}
      {invokeMutation.isSuccess && <p className="text-xs text-status-success">Workflow started</p>}

      <button onClick={handleInvoke} disabled={invokeMutation.isPending} className="btn-primary">
        {invokeMutation.isPending ? 'Starting...' : 'Start Workflow'}
      </button>
    </div>
  );
}
