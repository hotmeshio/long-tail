import { StatCard } from '../../../components/common/data/StatCard';
import type { Duration } from './helpers';

interface StreamStat {
  stream_type: string;
  count: number;
}

interface MeshStatCardsProps {
  engineCount: number;
  workerCount: number;
  pending: number;
  byStream: StreamStat[];
  activeDuration: Duration;
}

export function MeshStatCards({
  engineCount,
  workerCount,
  pending,
  byStream,
  activeDuration,
}: MeshStatCardsProps) {
  const engineProcessed = byStream
    .filter((s) => s.stream_type === 'engine')
    .reduce((sum, s) => sum + s.count, 0);
  const workerProcessed = byStream
    .filter((s) => s.stream_type === 'worker')
    .reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="grid grid-cols-5 gap-4 mb-8">
      <StatCard label="Engines" value={engineCount} />
      <StatCard label="Workers" value={workerCount} />
      <StatCard
        label="Pending"
        value={pending}
        colorClass={pending ? 'text-status-warning' : 'text-text-primary'}
      />
      <StatCard
        label={`Engine Msgs (${activeDuration})`}
        value={engineProcessed.toLocaleString()}
        colorClass="text-blue-500"
      />
      <StatCard
        label={`Worker Msgs (${activeDuration})`}
        value={workerProcessed.toLocaleString()}
      />
    </div>
  );
}
