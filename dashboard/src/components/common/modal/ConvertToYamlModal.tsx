import { useState, useMemo, useRef, useEffect } from 'react';
import { Modal } from './Modal';
import { TagInput } from '../form/TagInput';
import { useYamlWorkflowAppIds } from '../../../api/yaml-workflows';

interface ConvertToYamlModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    app_id: string;
    subscribes: string;
    tags: string[];
  }) => void;
  isPending?: boolean;
}

/** HotMesh appId: letters and digits only (no dashes, no underscores). Must start with a letter. */
const NAMESPACE_RE = /^[a-z][a-z0-9]*$/;

function validateNamespace(value: string): string | null {
  if (!value) return 'Namespace is required';
  if (value.includes('-') || value.includes('_')) return 'Only letters and numbers allowed — no dashes or underscores';
  if (!NAMESPACE_RE.test(value)) {
    if (!/^[a-z]/.test(value)) return 'Must start with a lowercase letter';
    return 'Only lowercase letters and numbers allowed';
  }
  return null;
}

function sanitize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const STEP_LABELS = ['Namespace', 'Tool', 'Tags'] as const;

export function ConvertToYamlModal({
  open,
  onClose,
  onSubmit,
  isPending,
}: ConvertToYamlModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [appId, setAppId] = useState('');
  const [appIdTouched, setAppIdTouched] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [name, setName] = useState('');
  const [subscribes, setSubscribes] = useState('');
  const [autoSubscribes, setAutoSubscribes] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: appIdData } = useYamlWorkflowAppIds();
  const allAppIds = useMemo(() => appIdData?.app_ids ?? [], [appIdData?.app_ids]);

  const filteredAppIds = useMemo(() => {
    if (!appId) return allAppIds;
    return allAppIds.filter((id) => id.includes(appId.toLowerCase()));
  }, [allAppIds, appId]);

  const isExisting = allAppIds.includes(appId);
  const nsError = appIdTouched ? validateNamespace(appId) : null;

  const derivedSubscribes = autoSubscribes ? sanitize(name) : subscribes;

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStep(1);
      setAppId('');
      setAppIdTouched(false);
      setName('');
      setSubscribes('');
      setAutoSubscribes(true);
      setTags([]);
    }
  }, [open]);

  const handleNextNamespace = () => {
    setAppIdTouched(true);
    if (validateNamespace(appId)) return;
    setStep(2);
  };

  const handleNextTool = () => {
    if (!name.trim()) return;
    setStep(3);
  };

  const handleSubmit = () => {
    onSubmit({
      name: name.trim(),
      app_id: appId,
      subscribes: derivedSubscribes,
      tags,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Export as MCP Workflow Tool" maxWidth="max-w-lg">
      {/* Step indicator */}
      <div className="flex items-center gap-3 mb-6">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            {s > 1 && <div className={`w-8 h-px ${step >= s ? 'bg-accent' : 'bg-surface-border'}`} />}
            <span
              className={`w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center transition-colors ${
                step === s
                  ? 'bg-accent text-text-inverse'
                  : step > s
                    ? 'bg-accent/20 text-accent'
                    : 'bg-surface-sunken text-text-tertiary'
              }`}
            >
              {s}
            </span>
            <span className={`text-xs ${step === s ? 'text-text-primary font-medium' : 'text-text-tertiary'}`}>
              {STEP_LABELS[s - 1]}
            </span>
          </div>
        ))}
      </div>

      {/* ── Step 1: Namespace ── */}
      {step === 1 && (
        <div>
          <p className="text-xs text-text-secondary mb-4 leading-relaxed">
            Choose which namespace (MCP server) to add this tool to, or create a new one.
          </p>

          <div ref={dropdownRef} className="relative">
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
              Namespace
            </label>
            <input
              ref={inputRef}
              type="text"
              value={appId}
              onChange={(e) => {
                setAppId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''));
                setAppIdTouched(true);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              className={`w-full bg-surface-sunken border rounded-md px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary transition-colors ${
                nsError ? 'border-status-error' : 'border-surface-border'
              }`}
              placeholder="e.g. mydbinsights"
              autoFocus
            />

            {/* Dropdown */}
            {showDropdown && filteredAppIds.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-surface-raised border border-surface-border rounded-md shadow-lg z-10 max-h-40 overflow-y-auto">
                {filteredAppIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setAppId(id);
                      setAppIdTouched(true);
                      setShowDropdown(false);
                    }}
                    className="block w-full text-left px-3 py-2 text-xs font-mono text-text-secondary hover:bg-surface-hover transition-colors"
                  >
                    {id}
                  </button>
                ))}
              </div>
            )}

            {/* Validation / hint */}
            {nsError && (
              <p className="text-[10px] text-status-error mt-1">{nsError}</p>
            )}
            {!nsError && appId && !isExisting && (
              <p className="text-[10px] text-accent mt-1">
                New namespace — will be created when this tool is exported.
              </p>
            )}
            {!nsError && appId && isExisting && (
              <p className="text-[10px] text-text-tertiary mt-1">
                Tool will be added to existing namespace.
              </p>
            )}
            {!appId && !nsError && (
              <p className="text-[10px] text-text-tertiary mt-1">
                Lowercase letters and numbers only. Must start with a letter.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleNextNamespace}
              disabled={!appId || !!validateNamespace(appId)}
              className="btn-primary text-xs"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Tool details ── */}
      {step === 2 && (
        <div>
          <p className="text-xs text-text-secondary mb-4 leading-relaxed">
            Define the tool name and topic for namespace <span className="font-mono text-text-primary">{appId}</span>.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
                Tool Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                placeholder="e.g. Show Escalated Processes"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
                Subscribes Topic
              </label>
              <div className="flex items-center gap-2 mb-1">
                <input
                  type="text"
                  value={derivedSubscribes}
                  onChange={(e) => {
                    setAutoSubscribes(false);
                    setSubscribes(e.target.value);
                  }}
                  className="flex-1 bg-surface-sunken border border-surface-border rounded-md px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                  placeholder="e.g. show-escalated-processes"
                />
                {!autoSubscribes && (
                  <button
                    type="button"
                    onClick={() => setAutoSubscribes(true)}
                    className="text-[10px] text-accent hover:underline shrink-0"
                  >
                    Auto
                  </button>
                )}
              </div>
              <p className="text-[10px] text-text-tertiary">
                The topic this graph subscribes to. Worker topics derive from this (e.g. {derivedSubscribes || '...'}.tool_name).
              </p>
            </div>
          </div>

          <div className="flex justify-between pt-6">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Back
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleNextTool}
                disabled={!name.trim()}
                className="btn-primary text-xs"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Tags ── */}
      {step === 3 && (
        <div>
          <p className="text-xs text-text-secondary mb-4 leading-relaxed">
            Add tags to describe what <span className="font-mono text-text-primary">{name}</span> does.
            Tags help LLMs and users discover this tool by capability.
          </p>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
              Tags
            </label>
            <TagInput
              tags={tags}
              onChange={setTags}
              placeholder="e.g. database, analytics, query"
            />
            <p className="text-[10px] text-text-tertiary mt-1.5">
              Lowercase, hyphenated. Press Enter or comma to add. These are used for tag-based tool discovery (e.g. <span className="font-mono">database</span>, <span className="font-mono">vision</span>, <span className="font-mono">document-processing</span>).
            </p>
          </div>

          <div className="flex justify-between pt-6">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Back
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isPending}
                className="btn-primary text-xs"
              >
                {isPending ? 'Exporting...' : 'Export'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
