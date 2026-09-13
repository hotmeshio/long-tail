import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowIcon } from '../display/WorkflowIcon';
import { WorkflowIconPicker } from '../form/WorkflowIconPicker';
import { WORKFLOW_ICON_NAMES, workflowIconGlyph, filterWorkflowIcons } from '../../../lib/workflow-icons';
import { Wrench, ShieldCheck } from 'lucide-react';

describe('workflow icons', () => {
  it('every curated name resolves to a glyph and unknown names do not', () => {
    for (const name of WORKFLOW_ICON_NAMES) expect(workflowIconGlyph(name)).toBeTruthy();
    expect(workflowIconGlyph('Sword')).toBeNull();
    expect(workflowIconGlyph(null)).toBeNull();
  });

  it('WorkflowIcon shows the declared glyph, else the tier glyph', () => {
    const { container: a } = render(<WorkflowIcon icon="Wrench" tier="certified" />);
    const { container: b } = render(<Wrench aria-hidden strokeWidth={1.5} />);
    expect(a.innerHTML).toBe(b.innerHTML);
    const { container: c } = render(<WorkflowIcon icon={null} tier="certified" />);
    const { container: d } = render(<ShieldCheck aria-hidden strokeWidth={1.5} />);
    expect(c.innerHTML).toBe(d.innerHTML);
  });

  it('the picker marks the choice and offers a return to the tier glyph', () => {
    const onChange = vi.fn();
    render(<WorkflowIconPicker value="Wrench" onChange={onChange} />);
    expect(screen.getByRole('option', { name: 'Wrench' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('option', { name: 'Printer' }));
    expect(onChange).toHaveBeenCalledWith('Printer');
    fireEvent.click(screen.getByRole('option', { name: 'No icon (tier glyph)' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('the filter narrows by lucide name or constant key', () => {
    expect(filterWorkflowIcons('wren')).toEqual(['Wrench']);
    expect(filterWorkflowIcons('CHECKLIST')).toEqual(['ListChecks']);
    expect(filterWorkflowIcons('shopping cart')).toEqual(['ShoppingCart']);
    expect(filterWorkflowIcons('')).toHaveLength(WORKFLOW_ICON_NAMES.length);
    const onChange = vi.fn();
    render(<WorkflowIconPicker value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Filter icons'), { target: { value: 'print' } });
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('title'))).toEqual(['No icon (tier glyph)', 'Printer']);
  });
});
