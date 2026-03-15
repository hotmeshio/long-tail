import { useState, useEffect, type ReactNode } from 'react';

export function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  const [render, setRender] = useState(open);

  useEffect(() => {
    if (open) setRender(true);
  }, [open]);

  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      onTransitionEnd={() => { if (!open) setRender(false); }}
    >
      <div className="overflow-hidden">
        {render ? children : null}
      </div>
    </div>
  );
}
