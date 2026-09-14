import { useEffect, useMemo, useState } from 'react';
import { ResolverForm } from '../../../components/escalation/ResolverForm';
import { seedFormJson } from '../../../lib/seed-form-json';
import { buildInvokeFormContext } from '../../../lib/invoke-context';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';

function parseSchema(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.properties ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The input form rendered live from the editor text through the same
 * ResolverForm the Invoke Tool page uses. Interactive, so conditional sections
 * can be walked before saving. Nothing here submits.
 */
export function InputFormPreview({ schemaText }: { schemaText: string }) {
  const schema = useMemo(() => parseSchema(schemaText), [schemaText]);
  const seed = useMemo(() => (schema ? seedFormJson(schema) : ''), [schema]);
  const [json, setJson] = useState(seed);
  useEffect(() => { setJson(seed); }, [seed]);
  const context = useMemo<ShowIfContext>(() => ({ ...buildInvokeFormContext({}), resolver: null }), []);

  if (!schema) {
    return (
      <p className="text-2xs text-text-tertiary">
        A schema with <code className="font-mono">properties</code> previews here as the operator's form.
      </p>
    );
  }

  return (
    <div className="@container" data-testid="input-form-preview">
      <ResolverForm value={json} onChange={setJson} escalationContext={context} />
    </div>
  );
}
