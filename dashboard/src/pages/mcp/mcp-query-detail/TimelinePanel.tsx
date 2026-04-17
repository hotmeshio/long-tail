import { Lightbulb } from 'lucide-react';
import { WizardNav } from '../../../components/common/layout/WizardNav';
import { SwimlaneTimeline } from '../../workflows/workflow-execution/SwimlaneTimeline';
import { PanelTitle } from './PanelTitle';

interface TimelinePanelProps {
  events: any[];
  onBack: () => void;
  onNext?: () => void;
}

export function TimelinePanel({ events, onBack, onNext }: TimelinePanelProps) {
  return (
    <div>
      <PanelTitle title="Discover" subtitle="Activity swimlane showing tool calls and their durations" icon={Lightbulb} iconClass="text-status-warning" />
      <SwimlaneTimeline events={events} />
      <WizardNav>
        <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
        <button onClick={onNext} disabled={!onNext} className="btn-primary text-xs">Next: Compile</button>
      </WizardNav>
    </div>
  );
}
