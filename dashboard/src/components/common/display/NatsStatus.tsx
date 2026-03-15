import { useNatsStatus } from '../../../hooks/useNats';

interface NatsStatusProps {
  className?: string;
}

/**
 * Small indicator showing the NATS WebSocket connection status.
 * Displays a colored dot with "Live" or "Offline" text.
 */
export function NatsStatus({ className = '' }: NatsStatusProps) {
  const { connected } = useNatsStatus();

  return (
    <span
      className={`flex items-center gap-1.5 text-[10px] text-text-tertiary ${className}`}
      title={connected ? 'Live updates connected' : 'Live updates disconnected'}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-text-tertiary'}`}
        data-testid="nats-status-dot"
      />
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}
