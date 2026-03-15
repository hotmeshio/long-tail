import { useState, useMemo, useCallback } from 'react';
import { Modal } from './Modal';
import { CustomDurationPicker } from '../form/CustomDurationPicker';
import { useUsers } from '../../../api/users';
import { useAuth } from '../../../hooks/useAuth';
import { useClaimDurations } from '../../../hooks/useClaimDurations';
import type { LTUserRecord } from '../../../api/types';

interface BulkAssignModalProps {
  open: boolean;
  onClose: () => void;
  selectedCount: number;
  /** Distinct roles of the selected escalations; scopes user list for admins */
  selectedRoles: string[];
  onSubmit: (targetUserId: string, durationMinutes: number) => void;
  isPending: boolean;
}

export function BulkAssignModal({
  open,
  onClose,
  selectedCount,
  selectedRoles,
  onSubmit,
  isPending,
}: BulkAssignModalProps) {
  const { isSuperAdmin } = useAuth();
  const claimDurations = useClaimDurations();
  const [step, setStep] = useState<'user' | 'duration'>('user');
  const [selectedUser, setSelectedUser] = useState<LTUserRecord | null>(null);
  const [search, setSearch] = useState('');
  const [duration, setDuration] = useState('30');
  const [customMinutes, setCustomMinutes] = useState(0);
  const onCustomChange = useCallback((m: number) => setCustomMinutes(m), []);

  // Admins with a single role: scope to that role. Otherwise show all active users.
  const roleFilter =
    !isSuperAdmin && selectedRoles.length === 1 ? selectedRoles[0] : undefined;

  const { data: usersData, isLoading: usersLoading } = useUsers({
    role: roleFilter,
    status: 'active',
    limit: 200,
  });

  const filteredUsers = useMemo(() => {
    const users = usersData?.users ?? [];
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.display_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q),
    );
  }, [usersData?.users, search]);

  const handleClose = () => {
    setStep('user');
    setSelectedUser(null);
    setSearch('');
    setDuration('30');
    setCustomMinutes(0);
    onClose();
  };

  const handleSelectUser = (user: LTUserRecord) => {
    setSelectedUser(user);
    setStep('duration');
  };

  const handleBack = () => {
    setStep('user');
  };

  const handleSubmit = () => {
    if (!selectedUser) return;
    const minutes = duration === 'custom' ? customMinutes : parseInt(duration);
    if (!minutes || minutes <= 0) return;
    onSubmit(selectedUser.id, minutes);
  };

  return (
    <Modal open={open} onClose={handleClose} title="Assign Escalations">
      <div className="space-y-4">
        {step === 'user' && (
          <>
            <p className="text-sm text-text-secondary">
              Select a user to assign{' '}
              <span className="font-medium text-text-primary">
                {selectedCount}
              </span>{' '}
              escalation(s) to:
            </p>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="input text-xs w-full"
              autoFocus
            />

            <div className="max-h-60 overflow-y-auto border border-surface-border rounded-lg divide-y divide-surface-border">
              {usersLoading && (
                <p className="text-xs text-text-tertiary p-3">
                  Loading users...
                </p>
              )}
              {!usersLoading && filteredUsers.length === 0 && (
                <p className="text-xs text-text-tertiary p-3">
                  No users found
                </p>
              )}
              {filteredUsers.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleSelectUser(user)}
                  className="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors"
                >
                  <p className="text-xs font-medium text-text-primary">
                    {user.display_name || user.external_id}
                  </p>
                  {user.email && (
                    <p className="text-[10px] text-text-tertiary">
                      {user.email}
                    </p>
                  )}
                </button>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={handleClose} className="btn-secondary text-xs">
                Cancel
              </button>
            </div>
          </>
        )}

        {step === 'duration' && selectedUser && (
          <>
            <p className="text-sm text-text-secondary">
              Assign to{' '}
              <span className="font-medium text-text-primary">
                {selectedUser.display_name || selectedUser.external_id}
              </span>{' '}
              for:
            </p>

            <select
              value={duration}
              onChange={(e) => { setDuration(e.target.value); setCustomMinutes(0); }}
              className="select w-full text-sm"
            >
              {claimDurations.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
              <option value="custom">Other...</option>
            </select>
            {duration === 'custom' && (
              <CustomDurationPicker onChange={onCustomChange} autoFocus />
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={handleBack} className="btn-secondary text-xs">
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={isPending}
                className="btn-primary text-xs"
              >
                {isPending ? 'Assigning...' : 'Assign'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
