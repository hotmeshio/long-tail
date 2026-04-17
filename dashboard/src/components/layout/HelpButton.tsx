import { X } from 'lucide-react';
import { useHelpAssistant } from '../../hooks/useHelpAssistant';

export function HelpButton() {
  const { helpOpen, toggleHelp } = useHelpAssistant();

  return (
    <button
      onClick={toggleHelp}
      className="fixed right-6 z-[45] flex items-center justify-center w-10 h-10 rounded-full bg-white border-2 border-accent shadow-lg hover:scale-110 transition-transform duration-150"
      style={{ bottom: 'calc(var(--feed-height, 32px) + 24px)' }}
      aria-label={helpOpen ? 'Close help' : 'Ask for help'}
    >
      {helpOpen ? (
        <X className="w-5 h-5 text-accent" strokeWidth={1.5} />
      ) : (
        <img src="/logo512.png" alt="Help" className="w-8 h-8 -rotate-[135deg]" />
      )}
    </button>
  );
}
