import { describe, it, expect } from 'vitest';

import { orderRolesByParent } from '../../../services/role/apply-order';

const names = (roles: { role: string }[]) => roles.map((r) => r.role);

describe('orderRolesByParent', () => {
  it('applies each parent before the role that names it, keeping declaration order otherwise', () => {
    const roles = [
      { role: 'pack', parent_role: 'inspect' }, { role: 'print' }, { role: 'inspect', parent_role: 'print' }, { role: 'ship' },
    ];
    expect(names(orderRolesByParent(roles))).toEqual(['print', 'inspect', 'pack', 'ship']);
  });

  it('takes a parent outside the list to exist already', () => {
    expect(names(orderRolesByParent([{ role: 'pack', parent_role: 'reviewer' }, { role: 'ship', parent_role: null }]))).toEqual(['pack', 'ship']);
  });

  it('refuses a cycle, naming the roles in it', () => {
    const roles = [{ role: 'a', parent_role: 'c' }, { role: 'b', parent_role: 'a' }, { role: 'c', parent_role: 'b' }, { role: 'd' }];
    expect(() => orderRolesByParent(roles)).toThrow('roles form a parent_role cycle: a → c → b → a');
    expect(() => orderRolesByParent([{ role: 'self', parent_role: 'self' }])).toThrow(/self → self/);
  });

  it('applies each role once', () => {
    const roles = [{ role: 'child', parent_role: 'mid' }, { role: 'mid', parent_role: 'root' }, { role: 'root' }, { role: 'other', parent_role: 'root' }];
    expect(names(orderRolesByParent(roles))).toEqual(['root', 'mid', 'child', 'other']);
  });
});
