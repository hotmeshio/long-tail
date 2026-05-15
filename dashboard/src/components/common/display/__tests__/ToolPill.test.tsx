import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolPill } from '../ToolPill';

describe('ToolPill', () => {
  it('renders the tool name', () => {
    render(<ToolPill name="gmail_search" />);
    expect(screen.getByText('gmail_search')).toBeDefined();
  });

  it('renders with a Wrench icon', () => {
    const { container } = render(<ToolPill name="test_tool" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('uses monospace font', () => {
    const { container } = render(<ToolPill name="test" />);
    const pill = container.firstChild as HTMLElement;
    expect(pill.className).toContain('font-mono');
  });

  it('supports size variants', () => {
    const { container: sm } = render(<ToolPill name="a" size="sm" />);
    const { container: md } = render(<ToolPill name="b" size="md" />);
    const smCls = (sm.firstChild as HTMLElement).className;
    const mdCls = (md.firstChild as HTMLElement).className;
    expect(smCls).not.toBe(mdCls);
  });
});
