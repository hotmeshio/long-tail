import { ChoreographySidebar } from './ChoreographySidebar';
import { PinnedViewsSidebar } from './PinnedViewsSidebar';
import { OrchestrationSidebar } from './OrchestrationSidebar';
import { ToolsSidebar } from './ToolsSidebar';
import { DesignSidebar } from './DesignSidebar';
import { StorageSidebar } from './StorageSidebar';
import { AdminSidebar } from './AdminSidebar';
import { useEngine } from '../../hooks/useEngine';
import type { ViewAsRole } from '../../lib/view-as';

export interface ShellNavSectionsProps {
  aiEnabled: boolean;
  isBuilder: boolean;
  isOps: boolean;
  viewAs: ViewAsRole | null;
  canSeePaceBoard: boolean;
  /** The deployment declares machine lines; the Lines entry renders. */
  showLines?: boolean;
}

/**
 * The navigation sections, shared verbatim by the ≥lg rail and the below-lg
 * drawer — one nav, two homes.
 */
export function ShellNavSections({ aiEnabled, isBuilder, isOps, viewAs, canSeePaceBoard, showLines }: ShellNavSectionsProps) {
  // Invoke drives HotMesh workflows; other engines start their own.
  const { native } = useEngine();
  return (
    <>
      <ChoreographySidebar aiEnabled={aiEnabled} isBuilder={isBuilder} isOps={isOps} viewAs={viewAs} canSeePaceBoard={canSeePaceBoard} showLines={showLines} />
      <PinnedViewsSidebar />
      {native && !isBuilder && <ToolsSidebar />}
      {isBuilder && <OrchestrationSidebar />}
      {isBuilder && aiEnabled && <DesignSidebar />}
      {isBuilder && <StorageSidebar />}
      {(isBuilder || isOps) && <AdminSidebar isBuilder={isBuilder} isOps={isOps} />}
    </>
  );
}
