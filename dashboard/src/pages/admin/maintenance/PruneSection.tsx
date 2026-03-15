import { useState } from 'react';
import {
  usePrune,
  type PruneResult,
} from '../../../api/maintenance';
import { Modal } from '../../../components/common/modal/Modal';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { RETENTION_PERIOD_OPTIONS } from '../../../lib/constants';

export function PruneSection() {
  const prune = usePrune();
  const [expire, setExpire] = useState('7 days');
  const [pruneJobs, setPruneJobs] = useState(true);
  const [pruneStreams, setPruneStreams] = useState(true);
  const [stripAttributes, setStripAttributes] = useState(false);
  const [pruneTransient, setPruneTransient] = useState(false);
  const [result, setResult] = useState<PruneResult | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const nothingSelected = !pruneJobs && !pruneStreams && !stripAttributes && !pruneTransient;

  const handlePrune = () => {
    setResult(null);
    prune.mutate(
      {
        expire,
        jobs: pruneJobs,
        streams: pruneStreams,
        attributes: stripAttributes,
        pruneTransient,
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
    <section className="pb-10 mb-10 border-b border-surface-border">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <SectionLabel>Manual Prune</SectionLabel>
          <p className="text-xs text-text-secondary mt-1">
            Immediately prune expired jobs, streams, and execution artifacts.
          </p>
        </div>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={nothingSelected || prune.isPending}
          className="btn-primary text-xs shrink-0"
        >
          {prune.isPending ? 'Pruning...' : 'Prune Now'}
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Retention Period
          </label>
          <select
            value={expire}
            onChange={(e) => setExpire(e.target.value)}
            className="select text-xs w-48"
          >
            {RETENTION_PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={pruneJobs}
              onChange={(e) => setPruneJobs(e.target.checked)}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <div>
              <span className="text-xs text-text-primary">Delete expired jobs</span>
              <p className="text-[10px] text-text-tertiary">Hard-delete job rows past retention</p>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={pruneStreams}
              onChange={(e) => setPruneStreams(e.target.checked)}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <div>
              <span className="text-xs text-text-primary">Delete expired streams</span>
              <p className="text-[10px] text-text-tertiary">Hard-delete stream messages past retention</p>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={stripAttributes}
              onChange={(e) => setStripAttributes(e.target.checked)}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <div>
              <span className="text-xs text-text-primary">Strip execution artifacts</span>
              <p className="text-[10px] text-text-tertiary">Remove execution details, keep export data</p>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={pruneTransient}
              onChange={(e) => setPruneTransient(e.target.checked)}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <div>
              <span className="text-xs text-text-primary">Delete transient jobs</span>
              <p className="text-[10px] text-text-tertiary">Jobs without an entity (orphaned)</p>
            </div>
          </label>
        </div>

        {result && (
          <div className="bg-surface-sunken rounded-md px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
              Prune Results
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {result.jobs !== undefined && (
                <div>
                  <p className="text-lg font-light text-text-primary">{result.jobs}</p>
                  <p className="text-[10px] text-text-tertiary">Jobs deleted</p>
                </div>
              )}
              {result.streams !== undefined && (
                <div>
                  <p className="text-lg font-light text-text-primary">{result.streams}</p>
                  <p className="text-[10px] text-text-tertiary">Streams deleted</p>
                </div>
              )}
              {result.attributes !== undefined && (
                <div>
                  <p className="text-lg font-light text-text-primary">{result.attributes}</p>
                  <p className="text-[10px] text-text-tertiary">Artifacts stripped</p>
                </div>
              )}
              {result.transient !== undefined && (
                <div>
                  <p className="text-lg font-light text-text-primary">{result.transient}</p>
                  <p className="text-[10px] text-text-tertiary">Transient deleted</p>
                </div>
              )}
            </div>
          </div>
        )}

        {prune.error && (
          <p className="text-xs text-status-error">{(prune.error as Error).message}</p>
        )}
      </div>

      {/* Confirm prune modal */}
      <Modal open={showConfirm} onClose={() => setShowConfirm(false)} title="Confirm Prune">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            This will permanently delete data older than{' '}
            <span className="font-medium text-text-primary">{expire}</span>.
            This action cannot be undone.
          </p>
          <ul className="text-xs text-text-secondary space-y-1 list-disc list-inside">
            {pruneJobs && <li>Delete expired jobs</li>}
            {pruneStreams && <li>Delete expired streams</li>}
            {stripAttributes && <li>Strip execution artifacts</li>}
            {pruneTransient && <li>Delete transient (entity-less) jobs</li>}
          </ul>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowConfirm(false)} className="btn-secondary text-xs">
              Cancel
            </button>
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
    </section>
  );
}
