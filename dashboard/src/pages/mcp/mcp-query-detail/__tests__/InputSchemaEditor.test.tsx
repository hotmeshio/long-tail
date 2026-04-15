import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InputSchemaEditor } from '../InputSchemaEditor';
import type { InputFieldMeta } from '../../../../api/types';

const FIELDS: InputFieldMeta[] = [
  { key: 'url', type: 'string', description: 'Target URL', classification: 'dynamic', source_step_index: 0, source_tool: 'navigate' },
  { key: 'username', type: 'string', description: 'Username', classification: 'dynamic', source_step_index: 1, source_tool: 'login' },
  { key: 'timeout', type: 'number', default: 5000, description: 'Timeout', classification: 'fixed', source_step_index: 1, source_tool: 'wait' },
  { key: 'full_page', type: 'boolean', default: true, description: 'Full Page', classification: 'fixed', source_step_index: 2, source_tool: 'screenshot' },
];

describe('InputSchemaEditor', () => {
  it('renders dynamic and fixed field sections', () => {
    render(<InputSchemaEditor fields={FIELDS} onChange={() => {}} editing={false} />);
    expect(screen.getByText(/Dynamic Inputs/)).toBeInTheDocument();
    expect(screen.getByText(/Fixed Defaults/)).toBeInTheDocument();
  });

  it('shows summary counts', () => {
    render(<InputSchemaEditor fields={FIELDS} onChange={() => {}} editing={false} />);
    expect(screen.getByText(/2 dynamic/)).toBeInTheDocument();
    expect(screen.getByText(/2 fixed/)).toBeInTheDocument();
  });

  it('renders all field keys', () => {
    render(<InputSchemaEditor fields={FIELDS} onChange={() => {}} editing={false} />);
    expect(screen.getByText('url')).toBeInTheDocument();
    expect(screen.getByText('username')).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
    expect(screen.getByText('full_page')).toBeInTheDocument();
  });

  it('shows classification badges', () => {
    render(<InputSchemaEditor fields={FIELDS} onChange={() => {}} editing={false} />);
    expect(screen.getAllByText('Dynamic').length).toBe(2);
    expect(screen.getAllByText('Fixed').length).toBe(2);
  });

  it('shows default values for fixed fields', () => {
    render(<InputSchemaEditor fields={FIELDS} onChange={() => {}} editing={false} />);
    expect(screen.getByText(/= 5000/)).toBeInTheDocument();
    expect(screen.getByText(/= true/)).toBeInTheDocument();
  });

  it('expands field details on click', () => {
    render(<InputSchemaEditor fields={FIELDS} onChange={() => {}} editing={false} />);
    fireEvent.click(screen.getByText('url'));
    expect(screen.getByText('Target URL')).toBeInTheDocument();
  });

  it('shows edit controls when editing=true and expanded', () => {
    render(<InputSchemaEditor fields={FIELDS} onChange={() => {}} editing={true} />);
    fireEvent.click(screen.getByText('url'));
    expect(screen.getByText(/Make fixed/)).toBeInTheDocument();
    expect(screen.getByText('Remove')).toBeInTheDocument();
  });

  it('calls onChange when toggling classification', () => {
    const onChange = vi.fn();
    render(<InputSchemaEditor fields={FIELDS} onChange={onChange} editing={true} />);
    // Expand the url field
    fireEvent.click(screen.getByText('url'));
    // Toggle to fixed
    fireEvent.click(screen.getByText(/Make fixed/));
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0];
    const urlField = updated.find((f: InputFieldMeta) => f.key === 'url');
    expect(urlField.classification).toBe('fixed');
  });

  it('calls onChange when removing a field', () => {
    const onChange = vi.fn();
    render(<InputSchemaEditor fields={FIELDS} onChange={onChange} editing={true} />);
    fireEvent.click(screen.getByText('url'));
    fireEvent.click(screen.getByText('Remove'));
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0];
    expect(updated.find((f: InputFieldMeta) => f.key === 'url')).toBeUndefined();
  });

  it('renders empty state when no fields', () => {
    render(<InputSchemaEditor fields={[]} onChange={() => {}} editing={false} />);
    expect(screen.getByText(/No input fields detected/)).toBeInTheDocument();
  });
});
