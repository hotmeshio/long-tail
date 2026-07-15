import { useEffect, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../api/settings';
import { getViewAs, setViewAs, clearViewAs, getAiOverride, setAiOverride, clearAiOverride, type ViewAsRole } from '../../lib/view-as';
import { LT_BASE } from '../../lib/base-path';

type RealTier = 'superadmin' | 'admin' | 'engineer' | 'operator';

interface ViewOption {
  id: ViewAsRole | null;
  label: string;
  description: string;
  minTier: RealTier;
}

const VIEW_OPTIONS: ViewOption[] = [
  {
    id: null,
    label: 'Your view',
    description: 'Full access based on your account role',
    minTier: 'operator',
  },
  {
    id: 'admin',
    label: 'Admin',
    description: 'Pace Board + identity management',
    minTier: 'superadmin',
  },
  {
    id: 'engineer',
    label: 'Engineer',
    description: 'Work queue + identity management',
    minTier: 'admin',
  },
  {
    id: 'operator',
    label: 'Operator',
    description: 'Escalation queue only',
    minTier: 'engineer',
  },
];

const TIER_ORDER: RealTier[] = ['operator', 'engineer', 'admin', 'superadmin'];

function tierIndex(t: RealTier): number {
  return TIER_ORDER.indexOf(t);
}

function canAccessOption(realTier: RealTier, minTier: RealTier): boolean {
  return tierIndex(realTier) >= tierIndex(minTier);
}

function realTierLabel(t: RealTier): string {
  if (t === 'superadmin') return 'superadmin';
  if (t === 'admin') return 'admin';
  if (t === 'engineer') return 'engineer';
  return 'operator';
}

export function EasterEggPanel({ onClose }: { onClose: () => void }) {
  const { isSuperAdmin, hasRoleType, hasRole } = useAuth();
  const { data: settings } = useSettings();
  const currentViewAs = getViewAs();
  const serverAiEnabled = !!settings?.ai?.enabled;
  const aiOverride = getAiOverride();
  const effectiveAiEnabled = aiOverride !== null ? aiOverride : serverAiEnabled;
  const [aiToggle, setAiToggle] = useState(effectiveAiEnabled);

  const realTier: RealTier = isSuperAdmin
    ? 'superadmin'
    : hasRoleType('admin')
      ? 'admin'
      : hasRole('engineer')
        ? 'engineer'
        : 'operator';

  const appName = settings?.branding?.appName ?? 'LongTail';
  const version = settings?.environment?.longTailVersion;
  const hotmeshVersion = settings?.environment?.hotmeshVersion;
  const nodeEnv = settings?.environment?.nodeEnv;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const availableOptions = VIEW_OPTIONS.filter(
    (o) => canAccessOption(realTier, o.minTier),
  );
  const hasViewOptions = availableOptions.length > 1;

  const handleSelect = (id: ViewAsRole | null) => {
    if (id === null) {
      clearViewAs();
    } else {
      setViewAs(id);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-surface-sunken/75 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      {/* Panel — click inside stops propagation to backdrop */}
      <div
        className="relative w-[440px] max-h-[85vh] overflow-y-auto bg-surface-raised px-12 py-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-quaternary hover:text-text-secondary transition-colors p-1"
          aria-label="Close"
        >
          <X className="w-4 h-4" strokeWidth={1.5} />
        </button>

        {/* Identity */}
        <div className="flex flex-col items-center gap-3 pb-8">
          <span
            className="logo-mark block w-20 h-20 opacity-50"
            style={{ '--logo-url': `url(${LT_BASE}/logo512.png)` } as CSSProperties}
          />
          <div className="text-center">
            <p className="text-2xl font-light text-text-primary tracking-[0.12em]">{appName}</p>
            {version && (
              <p className="mt-1 text-[11px] text-text-tertiary">
                v{version}
                {hotmeshVersion && <> · HotMesh v{hotmeshVersion}</>}
                {nodeEnv && nodeEnv !== 'production' && (
                  <span className="ml-1 text-status-warning">{nodeEnv}</span>
                )}
              </p>
            )}
          </div>
        </div>

        {hasViewOptions && (
          <>
            <hr className="border-surface-border/50 mb-6" />

            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-widest text-text-tertiary mb-4">
                View As
              </p>

              {availableOptions.map((opt) => {
                const isSelected = currentViewAs === opt.id;
                const label = opt.id === null
                  ? `Your view · ${realTierLabel(realTier)}`
                  : opt.label;

                return (
                  <button
                    key={String(opt.id)}
                    onClick={() => handleSelect(opt.id)}
                    className="w-full text-left flex items-start gap-3 py-2.5 px-1 group"
                  >
                    {/* Radio dot */}
                    <span
                      className={`mt-0.5 w-4 h-4 rounded-full border shrink-0 flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'border-accent bg-accent'
                          : 'border-surface-border group-hover:border-accent/60'
                      }`}
                    >
                      {isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </span>

                    <span>
                      <span className={`block text-sm font-medium transition-colors ${
                        isSelected ? 'text-accent' : 'text-text-primary group-hover:text-accent'
                      }`}>
                        {label}
                      </span>
                      <span className="block text-xs text-text-secondary mt-0.5">
                        {opt.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 mb-2" />
          </>
        )}

        <hr className="border-surface-border/50 mt-4" />

        {/* AI features toggle */}
        <div className="mt-6 mb-2">
          <p className="text-[10px] font-medium uppercase tracking-widest text-text-tertiary mb-4">
            Features
          </p>
          <button
            onClick={() => {
              const next = !aiToggle;
              setAiToggle(next);
              if (next === serverAiEnabled) {
                clearAiOverride();
              } else {
                setAiOverride(next);
              }
              window.location.reload();
            }}
            className="w-full text-left flex items-center justify-between py-2.5 px-1 group"
          >
            <span>
              <span className="block text-sm font-medium text-text-primary group-hover:text-accent transition-colors">
                AI features
              </span>
              <span className="block text-xs text-text-secondary mt-0.5">
                {aiToggle ? 'Enabled — AI assist, agent labels, bulk AI actions' : 'Hidden — automation labels, no AI surfaces'}
              </span>
            </span>
            {/* Toggle pill */}
            <span
              className={`shrink-0 ml-4 w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${
                aiToggle ? 'bg-accent' : 'bg-surface-border'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                  aiToggle ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </span>
          </button>
        </div>

        <hr className="border-surface-border/50 mt-4" />

        <p className="mt-4 text-[10px] text-text-quaternary text-center">
          Esc or click outside to close
        </p>
      </div>
    </div>
  );
}
