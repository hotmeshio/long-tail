import { describe, it, expect } from 'vitest';
import { canInvokeWorkflow, hasGlobalInvocationAccess } from '../../services/invocation-access';

const member = (role: string) => ({ role, type: 'member' });
const config = (invocation_roles: string[], invocable = true) => ({ invocable, invocation_roles });

describe('hasGlobalInvocationAccess', () => {
  it('a superadmin JWT role, a superadmin grant, or admin held as admin type', () => {
    expect(hasGlobalInvocationAccess([], 'superadmin')).toBe(true);
    expect(hasGlobalInvocationAccess([{ role: 'ops', type: 'superadmin' }])).toBe(true);
    expect(hasGlobalInvocationAccess([{ role: 'admin', type: 'admin' }])).toBe(true);
  });

  it('an admin-typed grant on another role, or a member, is not global', () => {
    expect(hasGlobalInvocationAccess([{ role: 'printer-fleet', type: 'admin' }])).toBe(false);
    expect(hasGlobalInvocationAccess([member('printer-fleet')], 'member')).toBe(false);
  });
});

describe('canInvokeWorkflow', () => {
  it('not invocable is never invokable, even for superadmin', () => {
    expect(canInvokeWorkflow(config([], false), [], 'superadmin')).toBe(false);
  });

  it('an empty role list is open to every authenticated caller', () => {
    expect(canInvokeWorkflow(config([]), [])).toBe(true);
    expect(canInvokeWorkflow(config([]), [member('anything')])).toBe(true);
  });

  it('a named role must intersect the caller\'s grants', () => {
    expect(canInvokeWorkflow(config(['printer-fleet']), [member('printer-fleet')])).toBe(true);
    expect(canInvokeWorkflow(config(['printer-fleet']), [member('reviewer')])).toBe(false);
    expect(canInvokeWorkflow(config(['printer-fleet']), [])).toBe(false);
  });

  it('global access bypasses the named roles', () => {
    expect(canInvokeWorkflow(config(['engineer']), [], 'superadmin')).toBe(true);
    expect(canInvokeWorkflow(config(['engineer']), [{ role: 'admin', type: 'admin' }])).toBe(true);
    expect(canInvokeWorkflow(config(['engineer']), [{ role: 'x', type: 'superadmin' }])).toBe(true);
  });
});
