import { useState, useEffect } from 'react';

const UNITS = [
  { value: 1, label: 'minutes' },
  { value: 60, label: 'hours' },
] as const;

interface CustomDurationPickerProps {
  /** Called with the computed duration in minutes whenever quantity or unit changes */
  onChange: (minutes: number) => void;
  /** Compact variant for inline use (e.g. action bars) */
  compact?: boolean;
  /** Auto-focus the quantity input */
  autoFocus?: boolean;
  'data-testid'?: string;
}

export function CustomDurationPicker({
  onChange,
  compact,
  autoFocus,
  'data-testid': testId = 'custom-duration-input',
}: CustomDurationPickerProps) {
  const [quantity, setQuantity] = useState('');
  const [multiplier, setMultiplier] = useState(1);

  useEffect(() => {
    const q = parseInt(quantity);
    onChange(q > 0 ? q * multiplier : 0);
  }, [quantity, multiplier, onChange]);

  const textSize = compact ? 'text-xs' : 'text-sm';
  const inputWidth = compact ? 'w-16' : 'w-20';

  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <input
        type="number"
        min={1}
        max={multiplier === 60 ? 24 : 1440}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        placeholder={multiplier === 60 ? 'hrs' : 'min'}
        className={`input ${textSize} ${inputWidth} text-center`}
        autoFocus={autoFocus}
        data-testid={`${testId}-quantity`}
      />
      <select
        value={multiplier}
        onChange={(e) => setMultiplier(parseInt(e.target.value))}
        className={`select ${textSize} py-1`}
        data-testid={`${testId}-unit`}
      >
        {UNITS.map((u) => (
          <option key={u.value} value={u.value}>{u.label}</option>
        ))}
      </select>
    </div>
  );
}
