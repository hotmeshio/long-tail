import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EscalationTitleSelect } from '../EscalationTitleSelect';

const OPTIONS = [
  { value: 'intake-reviewer', label: 'Intake Reviewer' },
  { value: 'cad-designer', label: 'CAD Designer' },
];

describe('EscalationTitleSelect', () => {
  it('reads "All Escalations" when no role is selected', () => {
    render(<EscalationTitleSelect role="" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByText('All Escalations')).toBeInTheDocument();
  });

  it('reads the role title when a role is selected', () => {
    render(<EscalationTitleSelect role="intake-reviewer" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByText('Intake Reviewer')).toBeInTheDocument();
  });

  it('derives a title when the selected role is not in the options', () => {
    render(<EscalationTitleSelect role="print_farm" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByText('Print Farm')).toBeInTheDocument();
  });

  it('opens a menu listing All Escalations plus every queue', () => {
    render(<EscalationTitleSelect role="" options={OPTIONS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('All Escalations'));
    // Menu items (plus the trigger's own "All Escalations")
    expect(screen.getAllByText('All Escalations').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Intake Reviewer')).toBeInTheDocument();
    expect(screen.getByText('CAD Designer')).toBeInTheDocument();
  });

  it('selecting a queue calls onChange with its role id', () => {
    const onChange = vi.fn();
    render(<EscalationTitleSelect role="" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByText('All Escalations'));
    fireEvent.click(screen.getByText('CAD Designer'));
    expect(onChange).toHaveBeenCalledWith('cad-designer');
  });

  it('selecting All Escalations clears the role', () => {
    const onChange = vi.fn();
    render(<EscalationTitleSelect role="intake-reviewer" options={OPTIONS} onChange={onChange} />);
    // Open (trigger shows the role title), then pick All Escalations from the menu
    fireEvent.click(screen.getByText('Intake Reviewer'));
    fireEvent.click(screen.getByText('All Escalations'));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
