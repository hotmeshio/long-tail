import { useState } from 'react';
import { Modal } from './Modal';

interface ConvertToYamlModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    app_id: string;
    subscribes: string;
  }) => void;
  isPending?: boolean;
}

function sanitize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function ConvertToYamlModal({
  open,
  onClose,
  onSubmit,
  isPending,
}: ConvertToYamlModalProps) {
  const [name, setName] = useState('');
  const [appId, setAppId] = useState('longtail');
  const [subscribes, setSubscribes] = useState('');
  const [autoSubscribes, setAutoSubscribes] = useState(true);

  const derivedSubscribes = autoSubscribes ? sanitize(name) : subscribes;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      app_id: appId.trim() || 'longtail',
      subscribes: derivedSubscribes,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Convert to MCP Pipeline">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Workflow Name *
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
            App ID (namespace)
          </label>
          <input
            type="text"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
            placeholder="longtail"
          />
          <p className="text-[10px] text-text-tertiary mt-1">
            Flows sharing the same App ID share a connection pool and are deployed together.
          </p>
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

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || isPending}
            className="btn-primary text-xs"
          >
            {isPending ? 'Converting...' : 'Convert'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
