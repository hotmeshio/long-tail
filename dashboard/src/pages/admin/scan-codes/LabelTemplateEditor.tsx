import { useState } from 'react';
import { Plus, X } from 'lucide-react';

import { SelectField, TextField } from '../../../components/common/form/Field';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import {
  useDeleteLabelTemplate, useLabelMedia, useUpsertLabelTemplate, type LabelTemplate, type LabelTemplateCode,
} from '../../../api/labels';
import type { ScanRule } from '../../../api/scan-codes';

const MAX_CODES = 4;
const TONES = [
  { value: 'solid', label: 'Solid band' },
  { value: 'outline', label: 'Outlined band' },
  { value: 'plain', label: 'No band' },
];
const SYMBOLOGIES = [
  { value: 'code128', label: 'Code 128 (read from a distance)' },
  { value: 'qrcode', label: 'QR' },
  { value: 'datamatrix', label: 'DataMatrix (small labels)' },
];

/**
 * One label template: which of the scheme's actions print, each beside its
 * caption, and the text above them in label tokens. Saving names the
 * revision it edited, so a concurrent edit is refused instead of lost.
 */
export function LabelTemplateEditor({ schemeVersion, identity, rules, template, onDone }: {
  schemeVersion: number;
  identity: boolean;
  rules: ScanRule[];
  template: LabelTemplate | null;
  onDone: () => void;
}) {
  const { data: mediaData } = useLabelMedia();
  const upsert = useUpsertLabelTemplate();
  const remove = useDeleteLabelTemplate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(template?.name ?? '');
  const [title, setTitle] = useState(template?.title ?? '');
  const [codes, setCodes] = useState<LabelTemplateCode[]>(template?.codes ?? [{ category: rules[0]?.category ?? '0', tone: 'solid' }]);
  const [heading, setHeading] = useState(template?.text.title ?? (identity ? '{user.display_name}' : '{target}'));
  const [lines, setLines] = useState<string[]>(template?.text.lines ?? []);
  const [symbology, setSymbology] = useState(template?.symbology ?? (identity ? 'qrcode' : 'code128'));
  const [readable, setReadable] = useState(template?.human_readable ?? !identity);
  const [media, setMedia] = useState(template?.media ?? '');
  const [sensitive, setSensitive] = useState(template?.sensitive ?? identity);

  const setCode = (i: number, patch: Partial<LabelTemplateCode>) => setCodes(codes.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const tokenHint = identity
    ? 'Tokens: {user.display_name}, {user.roles}, {user.<property>}, {scheme.name}.'
    : 'Tokens: {target}, {item.<facet>} from the row or list, {scheme.name}.';

  function save() {
    upsert.mutate({
      name, scheme_version: schemeVersion, title, codes, symbology, human_readable: readable,
      text: { title: heading, lines: lines.filter(Boolean) }, media: media || null, sensitive: identity || sensitive,
      expected_revision: template?.revision,
    }, { onSuccess: onDone });
  }

  return (
    <div className="max-w-form space-y-4">
      <div className="grid gap-3 @form-cols:grid-cols-2">
        <TextField label="Name" required hint="Lowercase letters, digits and dashes." value={name} disabled={!!template} onChange={(e) => setName(e.target.value)} />
        <TextField label="Title" required hint="Shown when choosing a template." value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="space-y-2">
        <p className="label">Codes</p>
        <p className="hint -mt-1">Each action prints as its own code beside its caption; the caption defaults to the action's name.</p>
        {codes.map((code, i) => (
          <div key={i} className="grid gap-2 grid-cols-[1fr_1fr_1fr_auto] items-end">
            <SelectField
              aria-label={`Action ${i + 1}`}
              value={code.category}
              options={rules.map((r) => ({ value: r.category, label: `${r.category} · ${r.name}` }))}
              onChange={(e) => setCode(i, { category: e.target.value })}
            />
            <TextField aria-label={`Caption ${i + 1}`} placeholder="Caption" value={code.caption ?? ''} onChange={(e) => setCode(i, { caption: e.target.value || null })} />
            <SelectField aria-label={`Band ${i + 1}`} value={code.tone} options={TONES} onChange={(e) => setCode(i, { tone: e.target.value as LabelTemplateCode['tone'] })} />
            <button type="button" aria-label={`Remove code ${i + 1}`} disabled={codes.length === 1} onClick={() => setCodes(codes.filter((_, j) => j !== i))} className="h-8 text-text-tertiary hover:text-status-error disabled:opacity-30">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {codes.length < MAX_CODES && (
          <button type="button" onClick={() => setCodes([...codes, { category: rules[0]?.category ?? '0', tone: 'outline' }])} className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover">
            <Plus className="w-3.5 h-3.5" /> Add a code
          </button>
        )}
      </div>

      <TextField label="Heading" hint={tokenHint} value={heading} onChange={(e) => setHeading(e.target.value)} />
      <div className="grid gap-3 @form-cols:grid-cols-2">
        {[0, 1].map((i) => (
          <TextField key={i} label={`Line ${i + 1}`} value={lines[i] ?? ''} onChange={(e) => setLines(Object.assign([...lines], { [i]: e.target.value }))} />
        ))}
      </div>

      <div className="grid gap-3 @form-cols:grid-cols-2">
        <SelectField label="Symbology" value={symbology} options={SYMBOLOGIES} onChange={(e) => setSymbology(e.target.value as LabelTemplate['symbology'])} />
        <SelectField label="Readable code" value={readable ? 'yes' : 'no'} options={[{ value: 'yes', label: 'Print the code as text' }, { value: 'no', label: 'Symbol only' }]} onChange={(e) => setReadable(e.target.value === 'yes')} />
        <SelectField
          label="Default media"
          value={media}
          placeholder={`Deployment default (${mediaData?.defaultMedia ?? '…'})`}
          options={(mediaData?.media ?? []).map((m) => ({ value: m.id, label: m.name }))}
          onChange={(e) => setMedia(e.target.value)}
        />
        {identity ? (
          <p className="hint self-end">Badges always confirm before printing and record who printed them.</p>
        ) : (
          <SelectField
            label="Printing"
            hint="Sensitive labels confirm first and record who asked."
            value={sensitive ? 'sensitive' : 'open'}
            options={[{ value: 'open', label: 'Print without confirmation' }, { value: 'sensitive', label: 'Confirm and record' }]}
            onChange={(e) => setSensitive(e.target.value === 'sensitive')}
          />
        )}
      </div>

      {upsert.error && <p role="alert" className="text-xs text-status-error">{(upsert.error as Error).message}</p>}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={!name || !title || upsert.isPending} className="btn-primary text-xs">
          {upsert.isPending ? 'Saving…' : 'Save template'}
        </button>
        <button onClick={onDone} className="btn-secondary text-xs">Cancel</button>
        {template && (
          <button onClick={() => setConfirmDelete(true)} className="ml-auto text-xs text-status-error/70 hover:text-status-error">Delete template</button>
        )}
      </div>
      <ConfirmDeleteModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate(template!.name, { onSuccess: onDone })}
        title="Delete label template"
        description={`Delete "${template?.title}"? Printed labels keep working; the template stops being offered.`}
        isPending={remove.isPending}
        error={remove.error as Error | null}
      />
    </div>
  );
}
