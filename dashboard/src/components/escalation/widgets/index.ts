import type { ComponentType } from 'react';
import { FileUploadWidget } from './FileUploadWidget';
import { CodeEditorWidget } from './CodeEditorWidget';
import { SignatureWidget } from './SignatureWidget';
import { RichTextWidget } from './RichTextWidget';
import { MarkdownWidget } from './MarkdownWidget';
import { ChecklistWidget } from './ChecklistWidget';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';

export interface WidgetProps {
  fieldKey: string;
  value: string;
  onChange: (v: string) => void;
  schema?: Record<string, unknown>;
  /** Escalation context — used by widgets that read from envelope/metadata/payload at render time. */
  escalationContext?: ShowIfContext;
  /** Whether this field is listed in the schema's required array. */
  isRequired?: boolean;
  /** Whether the user has attempted to submit — triggers required/validation display in widgets. */
  submitAttempted?: boolean;
  /** Validation error to display inside the widget. */
  error?: string;
}

/**
 * Registry of custom widgets referenced via `x-lt-widget` in JSON Schema.
 * String-typed fields receive value directly; object-typed fields are
 * JSON-serialized into the widget and parsed back on change (see FieldRow).
 */
export const WIDGET_MAP: Record<string, ComponentType<WidgetProps>> = {
  'file-upload': FileUploadWidget,
  'code-editor': CodeEditorWidget,
  'signature': SignatureWidget,
  'rich-text': RichTextWidget,
  'markdown': MarkdownWidget,
  'checklist': ChecklistWidget,
};
