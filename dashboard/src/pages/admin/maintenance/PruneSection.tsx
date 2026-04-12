import { useState } from 'react';
import { usePrune, type PruneResult } from '../../../api/maintenance';
import { Modal } from '../../../components/common/modal/Modal';
import { PruneFieldsEditor, DEFAULT_PRUNE_FIELDS, hasSelection, type PruneFields } from './controls';

function ResultCard({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg font-light text-text-primary">{value.toLocaleString()}</p>
      <p className="text-[10px] text-text-tertiary">{label}</p>
    </div>
  );
}

export function PruneSection() {
  const prune = usePrune();
  const [fields, setFields] = useState<PruneFields>(DEFAULT_PRUNE_FIELDS);
  const [result, setResult] = useState<PruneResult | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const handlePrune = () => {
    setResult(null);
    prune.mutate(
      {
        expire: fields.expire,
        jobs: fields.pruneJobs,
        engineStreams: fields.engineStreams,
        engineStreamsExpire: fields.engineStreamsExpire,
        workerStreams: fields.workerStreams,
        workerStreamsExpire: fields.workerStreamsExpire,
        attributes: fields.stripAttributes,
        pruneTransient: fields.pruneTransient,
      },
      {
        onSuccess: (data) => {
          setResult(data);
          setShowConfirm(false);
        },
      },
    );
  };

  return (
    <div className="space-y-8">
      <PruneFieldsEditor fields={fields} onChange={setFields} />

      {/* Action bar */}
      <div className="flex items-center justify-between pt-2 border-t border-surface-border">
        <p className="text-[10px] text-text-tertiary">
          {!hasSelection(fields)
            ? 'Select at least one operation to enable pruning.'
            : 'This action permanently deletes data and cannot be undone.'}
        </p>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={!hasSelection(fields) || prune.isPending}
          className="bg-status-error text-white px-4 py-1.5 rounded-md text-xs hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
        >
          {prune.isPending ? 'Pruning...' : 'Prune Now'}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="bg-surface-sunken rounded-md px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
            Results
          </p>
          <div className="flex flex-wrap gap-6">
            {result.jobs != null && result.jobs > 0 && <ResultCard label="Jobs deleted" value={result.jobs} />}
            {result.engineStreams != null && result.engineStreams > 0 && <ResultCard label="Engine streams" value={result.engineStreams} />}
            {result.workerStreams != null && result.workerStreams > 0 && <ResultCard label="Worker streams" value={result.workerStreams} />}
            {result.streams != null && result.engineStreams == null && result.streams > 0 && <ResultCard label="Streams" value={result.streams} />}
            {result.attributes != null && result.attributes > 0 && <ResultCard label="Artifacts stripped" value={result.attributes} />}
            {result.transient != null && result.transient > 0 && <ResultCard label="Transient deleted" value={result.transient} />}
            {result.marked != null && result.marked > 0 && <ResultCard label="Marked pruned" value={result.marked} />}
            {Object.values(result).every((v) => !v || v === 0) && (
              <p className="text-xs text-text-tertiary">Nothing to prune within the selected retention windows.</p>
            )}
          </div>
        </div>
      )}

      {prune.error && (
        <p className="text-xs text-status-error">{(prune.error as Error).message}</p>
      )}

      {/* Confirm modal */}
      <Modal open={showConfirm} onClose={() => setShowConfirm(false)} title="Confirm Prune">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            This will permanently delete data. This action cannot be undone.
          </p>
          <ul className="text-xs text-text-secondary space-y-1 list-disc list-inside">
            {fields.pruneJobs && <li>Delete jobs older than {fields.expire}</li>}
            {fields.engineStreams && <li>Delete engine streams older than {fields.engineStreamsExpire}</li>}
            {fields.workerStreams && <li>Delete worker streams older than {fields.workerStreamsExpire}</li>}
            {fields.stripAttributes && <li>Strip execution artifacts from completed jobs</li>}
            {fields.pruneTransient && <li>Delete transient (entity-less) jobs</li>}
          </ul>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowConfirm(false)} className="btn-secondary text-xs">Cancel</button>
            <button
              onClick={handlePrune}
              className="bg-status-error text-white px-3 py-1.5 rounded-md text-xs hover:opacity-90 transition-opacity"
              disabled={prune.isPending}
            >
              {prune.isPending ? 'Pruning...' : 'Confirm Prune'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
