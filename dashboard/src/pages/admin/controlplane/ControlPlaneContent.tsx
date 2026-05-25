import { CollapsibleSection } from '../../../components/common/layout/CollapsibleSection';
import { StreamVolumeChart } from './StreamVolumeChart';
import { QueueCard } from './QueueCard';
import { QuorumFeed } from './QuorumFeed';
import { EngineCluster } from './EngineCluster';
import type { Duration } from './helpers';

interface ControlPlaneContentProps {
  collapsed: Record<string, boolean>;
  toggleSection: (key: string) => void;
  activeDuration: Duration;
  streamStats: { byStream: Array<any> } | undefined;
  isLoading: boolean;
  queueMap: Map<string, Array<any>>;
  expandedQueues: Set<string>;
  toggleQueue: (queue: string) => void;
  allQueuesExpanded: boolean;
  toggleAllQueues: () => void;
  handleRowClick: (profile: any) => void;
  handleResumeThrottle: (profile: any) => void;
  handleQueueThrottle: (queue: string) => void;
  handleResumeQueue: (queue: string) => void;
  engines: Array<any>;
  bridgeActive: boolean;
}

export function ControlPlaneContent({
  collapsed,
  toggleSection,
  activeDuration,
  streamStats,
  isLoading,
  queueMap,
  expandedQueues,
  toggleQueue,
  allQueuesExpanded,
  toggleAllQueues,
  handleRowClick,
  handleResumeThrottle,
  handleQueueThrottle,
  handleResumeQueue,
  engines,
  bridgeActive,
}: ControlPlaneContentProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
      <div className="flex flex-col gap-12 mt-10">
        {/* Stream Volume section */}
        <CollapsibleSection
          title={`Stream Volume (${activeDuration})`}
          sectionKey="volume"
          isCollapsed={!!collapsed.volume}
          onToggle={toggleSection}
          contentClassName="mt-4 ml-7"
        >
          <StreamVolumeChart
            byStream={streamStats?.byStream ?? []}
            onNodeFilter={() => {}}
            onQueueFilter={() => {}}
          />
        </CollapsibleSection>

        {/* Task Queues section */}
        <CollapsibleSection
          title="Worker Queues"
          sectionKey="queues"
          isCollapsed={!!collapsed.queues}
          onToggle={toggleSection}
          contentClassName="mt-4 ml-7 flex flex-col gap-0"
        >
          {isLoading ? (
            <p className="text-xs text-text-tertiary">Discovering mesh nodes...</p>
          ) : queueMap.size === 0 ? (
            <p className="text-xs text-text-tertiary">No worker queues found. Click "Roll Call" to discover.</p>
          ) : (
            <>
              <div className="flex justify-end mb-2">
                <button onClick={toggleAllQueues} className="text-[10px] text-accent hover:underline">
                  {allQueuesExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              </div>
              {[...queueMap.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([queue, qWorkers]) => (
                  <QueueCard
                    key={queue}
                    queue={queue}
                    workers={qWorkers}
                    expanded={expandedQueues.has(queue)}
                    onToggle={toggleQueue}
                    onWorkerClick={handleRowClick}
                    onResumeThrottle={handleResumeThrottle}
                    onQueueThrottle={handleQueueThrottle}
                    onResumeQueue={handleResumeQueue}
                    byStream={streamStats?.byStream ?? []}
                    activeDuration={activeDuration}
                  />
                ))}
            </>
          )}
        </CollapsibleSection>

        {/* Engine cluster */}
        <CollapsibleSection
          title={`Engine Cluster (${engines.length})`}
          sectionKey="engines"
          isCollapsed={!!collapsed.engines}
          onToggle={toggleSection}
          contentClassName="mt-4 ml-7"
        >
          <EngineCluster
            engines={engines}
            onThrottle={handleRowClick}
            onResumeThrottle={handleResumeThrottle}
            isLoading={isLoading}
          />
        </CollapsibleSection>
      </div>

      <QuorumFeed bridgeActive={bridgeActive} />
    </div>
  );
}
