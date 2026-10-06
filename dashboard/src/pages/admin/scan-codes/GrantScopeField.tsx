/** How an identity scheme's badge grant is spent. */
export function GrantScopeField({
  value,
  onChange,
}: {
  value: 'action' | 'subject';
  onChange: (value: 'action' | 'subject') => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-text-secondary mb-1">Grant covers</span>
      <span className="block text-2xs text-text-tertiary mb-1">
        {value === 'subject'
          ? 'One held item: every act on it counts once, and the badge acts on that item only.'
          : 'Each act spends one use.'}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value as 'action' | 'subject')} className="select">
        <option value="action">Each act</option>
        <option value="subject">One held item</option>
      </select>
    </label>
  );
}
