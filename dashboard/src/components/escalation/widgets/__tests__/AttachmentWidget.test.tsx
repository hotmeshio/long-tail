import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AttachmentWidget } from '../AttachmentWidget';

const PNG_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const PDF_DATA = 'data:application/pdf;base64,JVBERi0xLjQ=';

function renderWidget(value: string, schema?: Record<string, unknown>) {
  return render(
    <AttachmentWidget fieldKey="defect_evidence" value={value} onChange={vi.fn()} schema={schema} />,
  );
}

describe('AttachmentWidget', () => {
  it('renders an image data URL inline with the field label', () => {
    renderWidget(PNG_DATA);
    expect(screen.getByText('defect evidence')).toBeInTheDocument();
    const img = screen.getByTestId('attachment-image-defect_evidence');
    expect(img).toHaveAttribute('src', PNG_DATA);
  });

  it('click expands to a full-size dialog; clicking again closes', () => {
    renderWidget(PNG_DATA);
    fireEvent.click(screen.getByTitle('View full size'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders an image URL (extension sniff) inline', () => {
    renderWidget('https://cdn.example.test/scan.jpg');
    expect(screen.getByTestId('attachment-image-defect_evidence')).toBeInTheDocument();
  });

  it('a PDF data URL is NEVER embedded — download affordance only', () => {
    const { container } = renderWidget(PDF_DATA);
    expect(container.querySelector('object, iframe, embed')).toBeNull();
    const link = screen.getByTestId('attachment-link-defect_evidence');
    expect(link).toHaveAttribute('download');
    expect(link.textContent).toContain('Download PDF');
  });

  it('a non-image URL opens in a new tab with rel=noopener', () => {
    renderWidget('https://files.example.test/report.pdf');
    const link = screen.getByTestId('attachment-link-defect_evidence');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.textContent).toContain('Open PDF');
  });

  it('renders a quiet empty state for a blank value', () => {
    renderWidget('');
    expect(screen.getByText('No attachment')).toBeInTheDocument();
  });

  it('shows the schema description as helper text', () => {
    renderWidget(PNG_DATA, { description: 'Uploaded by the reporting form' });
    expect(screen.getByText('Uploaded by the reporting form')).toBeInTheDocument();
  });
});
