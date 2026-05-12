import { useState, useCallback, useRef, type DragEvent, type ReactNode } from 'react';
import { UploadCloud } from 'lucide-react';

interface DropZoneProps {
  onDrop: (files: File[]) => void;
  children: ReactNode;
  label?: string;
  accept?: string;
  disabled?: boolean;
}

function matchesAccept(file: File, accept: string): boolean {
  const patterns = accept.split(',').map(s => s.trim());
  for (const pattern of patterns) {
    if (pattern.startsWith('.') && file.name.toLowerCase().endsWith(pattern.toLowerCase())) return true;
    if (pattern === file.type) return true;
    if (pattern.endsWith('/*') && file.type.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
}

export function DropZone({ onDrop, children, label = 'Drop files here', accept, disabled }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (!disabled) setDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);
    console.debug('[DropZone] dropped files:', files.map(f => ({ name: f.name, type: f.type, size: f.size })));

    if (accept) {
      const filtered = files.filter(f => matchesAccept(f, accept));
      console.debug('[DropZone] after accept filter:', filtered.length, 'of', files.length);
      if (filtered.length) onDrop(filtered);
      else console.warn('[DropZone] no files matched accept pattern:', accept);
    } else {
      if (files.length) onDrop(files);
    }
  }, [onDrop, accept, disabled]);

  return (
    <div
      className="relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {dragOver && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity pointer-events-none"
          style={{ background: 'rgba(var(--color-surface-rgb, 255 255 255) / 0.85)' }}
        >
          <div className="flex flex-col items-center gap-2 px-6 py-5 rounded-xl border border-dashed border-text-quaternary/40">
            <UploadCloud className="w-8 h-8 text-text-tertiary" />
            <p className="text-xs text-text-secondary">{label}</p>
          </div>
        </div>
      )}
    </div>
  );
}
