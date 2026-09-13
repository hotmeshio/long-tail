import { Play } from 'lucide-react';
import { SidebarNav } from './SidebarNav';
import { useInvocableWorkflows } from '../../api/workflows';

/**
 * "Tools" — the operator's entry to Invoke. The section self-assembles from
 * the caller's invokable workflows and renders nothing when there are none.
 */
export function ToolsSidebar() {
  const { data } = useInvocableWorkflows();
  if (!data?.length) return null;
  return (
    <SidebarNav
      heading="Tools"
      entries={[{ to: '/workflows/durable/invoke', label: 'Invoke', icon: Play }]}
    />
  );
}
