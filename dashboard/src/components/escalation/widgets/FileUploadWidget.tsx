import { useCallback, useRef } from 'react';

interface FileUploadWidgetProps {
  fieldKey: string;
  value: string;
  onChange: (v: string) => void;
  schema?: Record<string, unknown>;
}

/**
 * File upload widget that reads a file via FileReader and stores
 * its base64 data URL in the form value.
 */
export function FileUploadWidget({ fieldKey, value, onChange, schema }: FileUploadWidgetProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const accept = (schema?.accept as string) ?? undefined;
  const label = fieldKey.replace(/[_-]/g, ' ');
  const helperText = schema?.description as string | undefined;

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }, [onChange]);

  const hasFile = value.startsWith('data:');

  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
        {label}
      </label>
      {helperText && <p className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
      <div className="mt-1">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="btn-secondary text-xs px-3 py-1.5"
        >
          {hasFile ? 'Replace file' : 'Choose file'}
        </button>
        {hasFile && (
          <span className="ml-2 text-xs text-status-success">File attached</span>
        )}
      </div>
    </div>
  );
}
