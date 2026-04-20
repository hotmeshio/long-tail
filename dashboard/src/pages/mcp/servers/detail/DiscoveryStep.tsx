import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { TagInput } from '../../../../components/common/form/TagInput';
import type { ServerFormState } from './server-form-types';
import { labelCls, hintCls } from './server-form-types';

interface Props {
  form: ServerFormState;
  set: (field: keyof ServerFormState, value: any) => void;
}

export function DiscoveryStep({ form, set }: Props) {
  const [cpInput, setCpInput] = useState('');

  const addProvider = (raw: string) => {
    const v = raw.trim().toLowerCase();
    if (v && !form.credential_providers.includes(v)) {
      set('credential_providers', [...form.credential_providers, v]);
    }
    setCpInput('');
  };

  const removeProvider = (p: string) => {
    set('credential_providers', form.credential_providers.filter((x) => x !== p));
  };

  const handleCpKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addProvider(cpInput);
    } else if (e.key === 'Backspace' && !cpInput && form.credential_providers.length > 0) {
      removeProvider(form.credential_providers[form.credential_providers.length - 1]);
    }
  };

  return (
    <div className="space-y-5">
      {/* Tags */}
      <div>
        <label className={labelCls}>Tags</label>
        <TagInput
          tags={form.tags}
          onChange={(tags) => set('tags', tags)}
          placeholder="Add tag (e.g., database, analytics)..."
        />
        <p className={hintCls}>
          Tags enable tool discovery. Workflows filter available MCP servers by tags to find relevant tools.
        </p>
      </div>

      {/* Compile Hints */}
      <div>
        <label className={labelCls}>Compile Hints</label>
        <textarea
          value={form.compile_hints}
          onChange={(e) => set('compile_hints', e.target.value)}
          placeholder="Guidance for the workflow compiler when generating YAML from this server's tools..."
          className="input text-xs w-full leading-relaxed"
          rows={4}
          spellCheck={false}
        />
        <p className={hintCls}>
          Free-form text that guides the workflow compiler. Describe how tools should be composed, sequenced, or parameterized.
        </p>
      </div>

      {/* Credential Providers */}
      <div>
        <label className={labelCls}>Credential Providers</label>
        <div className="flex flex-wrap items-center gap-1.5 bg-surface-sunken border border-surface-border rounded-md px-2 py-1.5 focus-within:ring-1 focus-within:ring-accent-primary">
          {form.credential_providers.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-medium"
            >
              {p}
              <button
                type="button"
                onClick={() => removeProvider(p)}
                className="hover:text-status-error transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={cpInput}
            onChange={(e) => setCpInput(e.target.value)}
            onKeyDown={handleCpKey}
            onBlur={() => { if (cpInput.trim()) addProvider(cpInput); }}
            placeholder={form.credential_providers.length === 0 ? 'Add provider (e.g., github, slack)...' : ''}
            className="flex-1 min-w-[80px] bg-transparent text-xs text-text-primary outline-none placeholder:text-text-tertiary"
          />
        </div>
        <p className={hintCls}>
          IAM credential providers required by this server's tools. Users will be prompted to connect these before tool execution.
        </p>
      </div>
    </div>
  );
}
