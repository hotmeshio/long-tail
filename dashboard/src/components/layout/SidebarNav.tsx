import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Collapsible } from '../common/layout/Collapsible';
import { useSidebar } from '../../hooks/useSidebar';

export interface NavItem {
  kind?: 'link';
  to: string;
  label: string;
  end?: boolean;
  icon?: LucideIcon;
}

export interface NavGroup {
  kind: 'group';
  label: string;
  matchPaths: string[];
  items: NavItem[];
  icon?: LucideIcon;
}

export type NavEntry = NavItem | NavGroup;

interface SidebarNavProps {
  heading: string;
  headingTo?: string;
  entries: NavEntry[];
}

function getLinkClass(collapsed: boolean) {
  return ({ isActive }: { isActive: boolean }) => {
    const base = 'flex items-center rounded-md transition-colors duration-150';
    const active = 'bg-surface-hover text-text-primary font-medium';
    const inactive = 'text-text-secondary hover:text-text-primary hover:bg-surface-hover';

    if (collapsed) {
      return `${base} justify-center w-10 h-10 mx-auto ${isActive ? active : inactive}`;
    }
    return `${base} gap-3 px-4 py-2 text-sm ${isActive ? active : inactive}`;
  };
}

function getSubLinkClass() {
  return ({ isActive }: { isActive: boolean }) => {
    const base = 'flex items-center gap-3 pl-11 pr-4 py-1.5 text-xs rounded-md transition-colors duration-150';
    const active = 'text-text-primary font-medium';
    const inactive = 'text-text-tertiary hover:text-text-secondary';
    return `${base} ${isActive ? active : inactive}`;
  };
}

function NavGroupSection({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  const { pathname } = useLocation();
  const isChildActive = group.matchPaths.some((p) => pathname.startsWith(p));
  const [expanded, setExpanded] = useState(isChildActive);

  const open = expanded || isChildActive;

  // Collapsed: render each sub-item individually
  if (collapsed) {
    return (
      <>
        {group.items.map((sub) => (
          <NavLink
            key={sub.to}
            to={sub.to}
            className={getLinkClass(true)}
            title={sub.label}
          >
            {sub.icon && <sub.icon className="w-5 h-5 shrink-0 text-accent-muted" strokeWidth={1.5} />}
          </NavLink>
        ))}
      </>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 text-sm rounded-md transition-colors duration-150 text-text-secondary hover:text-text-primary hover:bg-surface-hover"
      >
        <span className="flex items-center gap-3">
          {group.icon && <group.icon className="w-5 h-5 shrink-0 text-accent-muted" strokeWidth={1.5} />}
          <span>{group.label}</span>
        </span>
        <svg
          className={`w-3.5 h-3.5 text-text-tertiary transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <Collapsible open={open}>
        {group.items.map((sub) => (
          <NavLink key={sub.to} to={sub.to} end={sub.end} className={getSubLinkClass()}>
            {sub.icon && <sub.icon className="w-4 h-4 shrink-0 text-accent-muted" strokeWidth={1.5} />}
            <span>{sub.label}</span>
          </NavLink>
        ))}
      </Collapsible>
    </div>
  );
}

function isGroup(entry: NavEntry): entry is NavGroup {
  return entry.kind === 'group';
}

export function SidebarNav({ heading, headingTo, entries }: SidebarNavProps) {
  const { collapsed } = useSidebar();

  return (
    <div className="space-y-1">
      {collapsed ? (
        headingTo ? (
          <NavLink
            to={headingTo}
            end
            className={({ isActive }) =>
              `block h-px mx-3 my-2 transition-colors duration-150 ${
                isActive ? 'bg-accent' : 'bg-surface-border hover:bg-text-tertiary'
              }`
            }
            title={heading}
          />
        ) : (
          <div className="h-px bg-surface-border mx-3 my-2" />
        )
      ) : headingTo ? (
        <NavLink
          to={headingTo}
          end
          className={({ isActive }) =>
            `block px-4 py-2 text-[10px] font-semibold uppercase tracking-widest transition-colors duration-150 ${
              isActive ? 'text-accent' : 'text-text-tertiary hover:text-text-secondary'
            }`
          }
        >
          {heading}
        </NavLink>
      ) : (
        <p className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          {heading}
        </p>
      )}
      {entries.map((entry) =>
        isGroup(entry) ? (
          <NavGroupSection key={entry.label} group={entry} collapsed={collapsed} />
        ) : (
          <NavLink
            key={entry.to}
            to={entry.to}
            end={entry.end}
            className={getLinkClass(collapsed)}
            title={collapsed ? entry.label : undefined}
          >
            {entry.icon && <entry.icon className="w-5 h-5 shrink-0 text-accent-muted" strokeWidth={1.5} />}
            {!collapsed && <span>{entry.label}</span>}
          </NavLink>
        ),
      )}
    </div>
  );
}
