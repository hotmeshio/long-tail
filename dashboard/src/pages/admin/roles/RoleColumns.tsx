import { Trash2 } from 'lucide-react';
import { type RoleDetail } from '../../../api/roles';
import { type Column } from '../../../components/common/data/DataTable';
import { RolePill } from '../../../components/common/display/RolePill';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';

export function getRoleColumns(
  onDelete: (row: RoleDetail) => void,
): Column<RoleDetail>[] {
  return [
    {
      key: 'role',
      label: 'Role',
      render: (row) => <RolePill role={row.role} />,
    },
    {
      key: 'user_count',
      label: 'Users',
      render: (row) =>
        row.user_count > 0
          ? <span className="text-text-primary">{row.user_count}</span>
          : <span className="text-text-tertiary">0</span>,
      className: 'w-24 text-right',
    },
    {
      key: 'chain_count',
      label: 'Escalations',
      render: (row) =>
        row.chain_count > 0
          ? <span className="text-text-primary">{row.chain_count}</span>
          : <span className="text-text-tertiary">0</span>,
      className: 'w-28 text-right',
    },
    {
      key: 'workflow_count',
      label: 'Workflows',
      render: (row) =>
        row.workflow_count > 0
          ? <span className="text-text-primary">{row.workflow_count}</span>
          : <span className="text-text-tertiary">0</span>,
      className: 'w-28 text-right',
    },
    {
      key: 'actions',
      label: '',
      render: (row) => {
        const inUse = row.user_count > 0 || row.chain_count > 0 || row.workflow_count > 0;
        if (inUse) return null;
        return (
          <RowActionGroup>
            <RowAction
              icon={Trash2}
              title="Delete role"
              onClick={() => onDelete(row)}
              colorClass="text-text-tertiary hover:text-status-error"
            />
          </RowActionGroup>
        );
      },
      className: 'w-16 text-right',
    },
  ];
}
