import type { ComponentType } from 'react';
import { FileUploadWidget } from './FileUploadWidget';
import { CodeEditorWidget } from './CodeEditorWidget';
import { SignatureWidget } from './SignatureWidget';
import { RichTextWidget } from './RichTextWidget';
import { MarkdownWidget } from './MarkdownWidget';

export interface WidgetProps {
  fieldKey: string;
  value: string;
  onChange: (v: string) => void;
  schema?: Record<string, unknown>;
}

/**
 * Registry of custom widgets referenced via `x-lt-widget` in JSON Schema.
 * Each widget renders a specialized input for a string field.
 */
export const WIDGET_MAP: Record<string, ComponentType<WidgetProps>> = {
  'file-upload': FileUploadWidget,
  'code-editor': CodeEditorWidget,
  'signature': SignatureWidget,
  'rich-text': RichTextWidget,
  'markdown': MarkdownWidget,
};
