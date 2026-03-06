import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, children, maxWidth }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-text-primary/30"
        onClick={onClose}
      />
      {/* Dialog */}
      <div className={`relative bg-surface-raised border border-surface-border rounded-lg shadow-xl w-full ${maxWidth ?? 'max-w-md'} mx-4 max-h-[85vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary text-lg leading-none"
          >
            &times;
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
