import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SchemeBindingFields, bindersText, identifierOf } from '../SchemeBindingFields';

describe('scheme binding settings', () => {
  it('reads binder roles from comma text, and sends nothing when nothing is set', () => {
    expect(identifierOf(' loader , print-servicer ,', false)).toEqual({ binders: ['loader', 'print-servicer'] });
    expect(identifierOf('', true)).toEqual({ exclusiveTarget: true });
    expect(identifierOf('  ', false)).toBeNull();
    expect(bindersText({ binders: ['loader', 'packer'] })).toBe('loader, packer');
    expect(bindersText(null)).toBe('');
  });

  it('values per target is a choice between many and one', () => {
    const onExclusiveTarget = vi.fn();
    render(<SchemeBindingFields binders="" onBinders={vi.fn()} exclusiveTarget={false} onExclusiveTarget={onExclusiveTarget} />);
    fireEvent.change(screen.getByDisplayValue('Many'), { target: { value: 'one' } });
    expect(onExclusiveTarget).toHaveBeenCalledWith(true);
  });
});
