import { useCallback, useEffect, useRef, useState } from 'react';
import { deriveFieldLabel } from '../../../lib/derive-field-label';
import { FieldLabel } from '../resolver-form/FieldChrome';

interface SignatureWidgetProps {
  fieldKey: string;
  value: string;
  onChange: (v: string) => void;
  schema?: Record<string, unknown>;
  isRequired?: boolean;
}

/**
 * HTML5 Canvas signature pad. Outputs a PNG data URL.
 */
export function SignatureWidget({ fieldKey, value, onChange, schema, isRequired }: SignatureWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const label = deriveFieldLabel(fieldKey, schema);
  const helperText = schema?.description as string | undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    // Deliberately unthemed: the signature is a captured document artifact —
    // the exported PNG must read like ink on paper regardless of theme.
    ctx.strokeStyle = '#1E1535';

    if (value && value.startsWith('data:')) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = value;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getPos = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // The backing store is a fixed 400×150 document; the element may display
    // at any width. Scale pointer coordinates into store space so the ink
    // lands under the cursor at every display size.
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }, []);

  const startDraw = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }, [getPos]);

  const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }, [isDrawing, getPos]);

  const endDraw = useCallback(() => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      onChange(canvas.toDataURL('image/png'));
    }
  }, [onChange]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange('');
  }, [onChange]);

  return (
    <div>
      <FieldLabel isRequired={isRequired}>
        {label}
      </FieldLabel>
      {helperText && <p className="text-2xs text-text-tertiary mt-0.5">{helperText}</p>}
      {/* The pad holds its natural document proportion (25rem = the 400px
          backing store), never stretched to the measure — the exported PNG
          is the artifact. Narrower cells shrink it; the scaling in getPos
          keeps the ink under the cursor either way. */}
      <div className="mt-1 max-w-[25rem] border border-surface-border rounded-md overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          width={400}
          height={150}
          className="w-full cursor-crosshair touch-none"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
      </div>
      <button
        type="button"
        onClick={clear}
        className="mt-1 text-2xs text-text-tertiary hover:text-accent transition-colors"
      >
        Clear
      </button>
    </div>
  );
}
