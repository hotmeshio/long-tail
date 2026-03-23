import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { WizardSteps } from '../layout/WizardSteps';

const labels = ['Query', 'Review', 'Compile', 'Deploy', 'Test'] as const;

describe('WizardSteps', () => {
  it('renders all step labels', () => {
    render(<WizardSteps labels={labels} current={1} maxReachable={1} onStepClick={vi.fn()} />);
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('highlights current step', () => {
    render(<WizardSteps labels={labels} current={3} maxReachable={3} onStepClick={vi.fn()} />);
    const btn = screen.getByText('3');
    expect(btn.className).toContain('bg-accent');
    expect(btn.className).toContain('text-text-inverse');
  });

  it('enables clickable steps up to maxReachable', () => {
    const onClick = vi.fn();
    render(<WizardSteps labels={labels} current={2} maxReachable={3} onStepClick={onClick} />);
    fireEvent.click(screen.getByText('1'));
    expect(onClick).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByText('3'));
    expect(onClick).toHaveBeenCalledWith(3);
  });

  it('disables steps beyond maxReachable', () => {
    render(<WizardSteps labels={labels} current={1} maxReachable={2} onStepClick={vi.fn()} />);
    const btn4 = screen.getByText('4');
    expect(btn4).toBeDisabled();
    const btn5 = screen.getByText('5');
    expect(btn5).toBeDisabled();
  });

  it('has sticky positioning class', () => {
    const { container } = render(
      <WizardSteps labels={labels} current={1} maxReachable={1} onStepClick={vi.fn()} />,
    );
    const stickyDiv = container.firstElementChild;
    expect(stickyDiv?.className).toContain('sticky');
  });
});
