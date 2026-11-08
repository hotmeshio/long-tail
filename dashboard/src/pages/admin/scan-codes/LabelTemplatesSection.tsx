import { Plus, Tag } from 'lucide-react';

import type { LabelTemplate } from '../../../api/labels';
import type { ScanRule } from '../../../api/scan-codes';
import { LabelTemplateEditor } from './LabelTemplateEditor';
import { SectionGroup } from './SectionGroup';

/** The scheme's label templates, and the editor for the one selected. */
export function LabelTemplatesSection({ schemeVersion, identity, rules, templates, selected, onSelect }: {
  schemeVersion: number;
  identity: boolean;
  rules: ScanRule[];
  templates: LabelTemplate[];
  /** A template name, `new`, or null. */
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  const editing = selected === 'new' ? null : templates.find((t) => t.name === selected) ?? null;
  return (
    <SectionGroup icon={Tag} label="Labels" annotation={identity ? 'badge layouts; badges print from Accounts' : 'what a printed label of this scheme shows'}>
      <div className="divide-y divide-surface-border border-y border-surface-border max-w-form">
        {templates.map((t) => (
          <button
            key={t.name}
            type="button"
            onClick={() => onSelect(selected === t.name ? null : t.name)}
            className={`w-full flex items-center gap-4 py-3 px-2 text-left transition-colors ${selected === t.name ? 'bg-accent/10' : 'hover:bg-surface-sunken'}`}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text-primary truncate">{t.title}</div>
              <div className="text-2xs text-text-tertiary truncate">
                {t.codes.length} {t.codes.length === 1 ? 'code' : 'codes'} · {t.symbology} · {t.media ?? 'default media'}
                {t.sensitive && ' · confirms before printing'}
                {t.source === 'code' && ' · declared in code'}
              </div>
            </div>
          </button>
        ))}
        <div className="py-3 px-2">
          <button type="button" onClick={() => onSelect('new')} disabled={rules.length === 0} className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Add a label template
          </button>
        </div>
      </div>
      {selected && (
        <div className="mt-6">
          <LabelTemplateEditor
            key={selected}
            schemeVersion={schemeVersion}
            identity={identity}
            rules={rules}
            template={editing}
            onDone={() => onSelect(null)}
          />
        </div>
      )}
    </SectionGroup>
  );
}
