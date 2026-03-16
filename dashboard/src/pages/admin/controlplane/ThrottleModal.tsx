import { useState } from 'react';
import { Modal } from '../../../components/common/modal/Modal';
import type { ThrottleTarget } from './helpers';

interface ThrottleModalProps {
  open: boolean;
  onClose: () => void;
  targets: ThrottleTarget[];
  onApply: (ms: number) => void;
  isPending: boolean;
}

const PRESETS = [
  { label: 'Resume', ms: 0 },
  { label: '0.5s', ms: 500 },
  { label: '1s', ms: 1000 },
  { label: '5s', ms: 5000 },
  { label: '30s', ms: 30000 },
  { label: 'Pause', ms: -1 },
];

function TargetPill({ target }: { target: ThrottleTarget }) {
  const isEngine = target.label === 'All Engines' || target.label.startsWith('Engine ');
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${
      isEngine ? 'bg-blue-500/10 text-blue-500' : 'bg-surface-sunken text-text-secondary'
    }`}>
      {target.label}
    </span>
  );
}

export function ThrottleModal({ open, onClose, targets, onApply, isPending }: ThrottleModalProps) {
  const [seconds, setSeconds] = useState('0');

  return (
    <Modal open={open} onClose={onClose} title="Adjust Throttle">
      <div className="space-y-4">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Targets</p>
          <div className="flex flex-wrap gap-1.5">
            {targets.map((t, i) => (
              <TargetPill key={t.guid || t.topic || i} target={t} />
            ))}
          </div>
        </div>

        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Presets</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => { setSeconds(p.ms === -1 ? '-1' : String(p.ms / 1000)); onApply(p.ms); }}
                disabled={isPending}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  p.ms === -1
                    ? 'bg-status-error/10 text-status-error hover:bg-status-error/20'
                    : p.ms === 0
                      ? 'bg-status-success/10 text-status-success hover:bg-status-success/20'
                      : 'bg-surface-sunken text-text-secondary hover:bg-surface-hover'
                } disabled:opacity-50`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
            Custom (seconds between messages)
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              step="0.1"
              min="-1"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
              className="input text-xs py-1.5 px-3 w-28"
            />
            <button
              onClick={() => {
                const s = parseFloat(seconds);
                if (isNaN(s)) return;
                onApply(s === -1 ? -1 : Math.round(s * 1000));
              }}
              disabled={isPending}
              className="btn-primary text-xs py-1.5 px-4 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
          <p className="text-[10px] text-text-tertiary mt-1">
            0 = resume, -1 = pause indefinitely
          </p>
        </div>
      </div>
    </Modal>
  );
}
