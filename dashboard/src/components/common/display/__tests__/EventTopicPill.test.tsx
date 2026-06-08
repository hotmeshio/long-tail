import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventTopicPill } from '../EventTopicPill';

describe('EventTopicPill', () => {
  it('renders category.action from structured system topic', () => {
    render(<EventTopicPill topic="system.workflow.abc123.completed" />);
    expect(screen.getByText('workflow.completed')).toBeDefined();
  });

  it('truncates app topics to last two segments', () => {
    render(<EventTopicPill topic="app.vendor.orders.error" />);
    expect(screen.getByText('orders.error')).toBeDefined();
  });

  it('renders system milestone topic', () => {
    render(<EventTopicPill topic="system.milestone.wf-abc" />);
    expect(screen.getByText('milestone.wf-abc')).toBeDefined();
  });

  it('renders with a Radio icon', () => {
    const { container } = render(<EventTopicPill topic="system.task.tsk-001.created" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('uses inline-flex layout with monospace font', () => {
    const { container } = render(<EventTopicPill topic="system.task.tsk-001.created" />);
    const pill = container.firstChild as HTMLElement;
    expect(pill.className).toContain('inline-flex');
    expect(pill.className).toContain('font-mono');
  });
});
