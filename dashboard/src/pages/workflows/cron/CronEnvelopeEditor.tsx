import { useState, useMemo } from 'react';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { extractFormFields } from './helpers';

interface CronEnvelopeEditorProps {
  envelopeInput: string;
  setEnvelopeInput: (value: string) => void;
  envelopeError: string;
  setEnvelopeError: (value: string) => void;
  isEnvelopeModified: boolean;
  onResetEnvelope: () => void;
}

export function CronEnvelopeEditor({
  envelopeInput,
  setEnvelopeInput,
  envelopeError,
  setEnvelopeError,
  isEnvelopeModified,
  onResetEnvelope,
}: CronEnvelopeEditorProps) {
  const [viewMode, setViewMode] = useState<'json' | 'form'>('json');

  const parsedEnvelope = useMemo(() => {
    try {
      return JSON.parse(envelopeInput) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [envelopeInput]);

  const formFields = useMemo(
    () => (parsedEnvelope ? extractFormFields(parsedEnvelope) : null),
    [parsedEnvelope],
  );

  const handleFormFieldChange = (key: string, value: string) => {
    if (!parsedEnvelope) return;
    const data = { ...((parsedEnvelope.data as Record<string, unknown>) ?? {}) };
    const original = data[key];
    if (typeof original === 'number') {
      data[key] = value === '' ? 0 : Number(value);
    } else if (typeof original === 'boolean') {
      data[key] = value === 'true';
    } else {
      data[key] = value;
    }
    const updated = { ...parsedEnvelope, data };
    setEnvelopeInput(JSON.stringify(updated, null, 2));
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <SectionLabel>Cron Envelope</SectionLabel>
        <div className="flex items-center gap-3">
          {isEnvelopeModified && (
            <button
              type="button"
              onClick={onResetEnvelope}
              className="text-[10px] text-status-warning hover:text-status-warning/80 transition-colors"
            >
              Reset to default
            </button>
          )}
          {formFields && (
            <div className="flex rounded overflow-hidden border border-surface-border">
              <button
                type="button"
                onClick={() => setViewMode('form')}
                className={`px-2 py-0.5 text-[10px] transition-colors ${
                  viewMode === 'form'
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                Form
              </button>
              <button
                type="button"
                onClick={() => setViewMode('json')}
                className={`px-2 py-0.5 text-[10px] transition-colors ${
                  viewMode === 'json'
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                JSON
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="text-[10px] text-text-tertiary mb-3">
        This envelope is sent as the workflow input on each cron invocation. Edit to customize.
      </p>

      {viewMode === 'form' && formFields ? (
        <div className="space-y-3">
          {formFields.map(({ key, value, type }) => (
            <div key={key}>
              <label className="block text-[11px] text-text-secondary mb-1 font-mono">
                {key}
              </label>
              {type === 'boolean' ? (
                <select
                  value={value}
                  onChange={(e) => handleFormFieldChange(key, e.target.value)}
                  className="input text-xs w-full"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type={type === 'number' ? 'number' : 'text'}
                  value={value}
                  onChange={(e) => handleFormFieldChange(key, e.target.value)}
                  className="input text-xs font-mono w-full"
                />
              )}
            </div>
          ))}
          {parsedEnvelope?.metadata != null && typeof parsedEnvelope.metadata === 'object' && Object.keys(parsedEnvelope.metadata as Record<string, unknown>).length > 0 && (
            <p className="text-[10px] text-text-tertiary mt-2">
              Metadata fields are editable in JSON view.
            </p>
          )}
        </div>
      ) : (
        <textarea
          value={envelopeInput}
          onChange={(e) => {
            setEnvelopeInput(e.target.value);
            setEnvelopeError('');
          }}
          className="input font-mono text-xs w-full"
          rows={10}
          spellCheck={false}
        />
      )}

      {envelopeError && (
        <p className="text-[10px] text-status-error mt-2">{envelopeError}</p>
      )}
      {isEnvelopeModified && (
        <p className="text-[10px] text-accent mt-1.5">
          Envelope has been customized. Changes will be saved with the schedule.
        </p>
      )}
    </div>
  );
}
