import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { QueryLifecycleSidebar } from '../QueryLifecycleSidebar';

describe('QueryLifecycleSidebar', () => {
  it('renders all 5 lifecycle steps', () => {
    render(
      <QueryLifecycleSidebar
        currentStep="query"
        completedSteps={new Set()}
      />,
    );
    expect(screen.getByText('Query')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Compile')).toBeInTheDocument();
    expect(screen.getByText('Deploy')).toBeInTheDocument();
    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('renders heading', () => {
    render(
      <QueryLifecycleSidebar
        currentStep="query"
        completedSteps={new Set()}
      />,
    );
    expect(screen.getByText('Lifecycle')).toBeInTheDocument();
  });

  it('highlights current step', () => {
    render(
      <QueryLifecycleSidebar
        currentStep="compile"
        completedSteps={new Set(['query', 'review'])}
      />,
    );
    const compileBtn = screen.getByText('Compile').closest('button');
    expect(compileBtn?.className).toContain('accent-primary');
  });

  it('calls onStepClick for completed steps', () => {
    const onStepClick = vi.fn();
    render(
      <QueryLifecycleSidebar
        currentStep="compile"
        completedSteps={new Set(['query', 'review'])}
        onStepClick={onStepClick}
      />,
    );
    fireEvent.click(screen.getByText('Query'));
    expect(onStepClick).toHaveBeenCalledWith('query');
  });

  it('disables future steps', () => {
    render(
      <QueryLifecycleSidebar
        currentStep="review"
        completedSteps={new Set(['query'])}
      />,
    );
    const deployBtn = screen.getByText('Deploy').closest('button');
    expect(deployBtn).toBeDisabled();
  });
});
