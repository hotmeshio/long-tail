import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventTopicPill } from '../EventTopicPill';

describe('EventTopicPill', () => {
  it('renders the last two segments of the topic', () => {
    render(<EventTopicPill topic="workflow.completed" />);
    expect(screen.getByText('workflow.completed')).toBeDefined();
  });

  it('truncates long topics to last two segments', () => {
    render(<EventTopicPill topic="app.vendor.orders.error" />);
    expect(screen.getByText('orders.error')).toBeDefined();
  });

  it('renders single-segment topics as-is', () => {
    render(<EventTopicPill topic="milestone" />);
    expect(screen.getByText('milestone')).toBeDefined();
  });

  it('renders with a Radio icon', () => {
    const { container } = render(<EventTopicPill topic="task.created" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('uses inline-flex layout with monospace font', () => {
    const { container } = render(<EventTopicPill topic="task.created" />);
    const pill = container.firstChild as HTMLElement;
    expect(pill.className).toContain('inline-flex');
    expect(pill.className).toContain('font-mono');
  });
});
