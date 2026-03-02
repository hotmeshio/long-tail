import { PageHeader } from '../../../components/common/PageHeader';
import { PruneSection } from './PruneSection';
import { ScheduledMaintenanceSection } from './ScheduledMaintenanceSection';

export function MaintenancePage() {
  return (
    <div>
      <PageHeader title="Maintenance" />
      <PruneSection />
      <ScheduledMaintenanceSection />
    </div>
  );
}
