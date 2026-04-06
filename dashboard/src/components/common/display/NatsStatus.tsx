import { Radio } from 'lucide-react';
import { useEventStatus } from '../../../hooks/useEventContext';

interface NatsStatusProps {
  className?: string;
  onClick?: () => void;
}

/**
 * Icon indicator showing the NATS WebSocket connection status.
 * Displays a Radio icon with a green/gray status dot.
 */
export function NatsStatus({ className = '', onClick }: NatsStatusProps) {
  const { connected } = useEventStatus();

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative text-text-tertiary hover:text-accent transition-colors ${className}`}
      title={connected ? 'Live events enabled' : 'Live events disconnected'}
      aria-label={connected ? 'Live events enabled' : 'Live events disconnected'}
    >
      <Radio className="w-4 h-4" strokeWidth={1.5} />
      <span
        className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-text-tertiary'}`}
        data-testid="nats-status-dot"
      />
    </button>
  );
}
