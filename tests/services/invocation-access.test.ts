import { describe, it, expect } from 'vitest';
import { canInvokeWorkflow, hasGlobalInvocationAccess, mayActAs } from '../../services/invocation-access';

const member = (role: string) => ({ role, type: 'member' });
const config = (invocation_roles: string[], invocable = true) => ({ invocable, invocation_roles });

describe('hasGlobalInvocationAccess', () => {
  it('a superadmin grant, or admin held as admin type; no grants is not global', () => {
    expect(hasGlobalInvocationAccess([])).toBe(false);
    expect(hasGlobalInvocationAccess([{ role: 'ops', type: 'superadmin' }])).toBe(true);
    expect(hasGlobalInvocationAccess([{ role: 'admin', type: 'admin' }])).toBe(true);
  });

  it('an admin-typed grant on another role, or a member, is not global', () => {
    expect(hasGlobalInvocationAccess([{ role: 'printer-fleet', type: 'admin' }])).toBe(false);
    expect(hasGlobalInvocationAccess([member('printer-fleet')])).toBe(false);
  });
});

describe('canInvokeWorkflow', () => {
  it('not invocable is never invokable, even for superadmin', () => {
    expect(canInvokeWorkflow(config([], false), [{ role: 'x', type: 'superadmin' }])).toBe(false);
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
    expect(canInvokeWorkflow(config(['engineer']), [{ role: 'admin', type: 'admin' }])).toBe(true);
    expect(canInvokeWorkflow(config(['engineer']), [{ role: 'x', type: 'superadmin' }])).toBe(true);
  });
});

describe('system-authority workflows', () => {
  const capability = (invocation_roles: string[] = []) => ({ workflow_type: 'capabilityInvoke', invocable: true, invocation_roles });

  it('only a superadmin grant starts capabilityInvoke, whatever its stored roles', () => {
    expect(canInvokeWorkflow(capability(), [{ role: 'ops', type: 'superadmin' }])).toBe(true);
    expect(canInvokeWorkflow(capability(), [member('engineer')])).toBe(false);
    expect(canInvokeWorkflow(capability(), [{ role: 'admin', type: 'admin' }])).toBe(false);
    expect(canInvokeWorkflow(capability(['engineer']), [member('engineer')])).toBe(false);
  });

  it('a superadmin role claim without a superadmin grant is not enough', () => {
    expect(canInvokeWorkflow(capability(), [])).toBe(false);
  });
});

describe('mayActAs', () => {
  const grant = (role: string, type: string) => ({ role, type });

  it('a superadmin may act as anyone', () => {
    expect(mayActAs([grant('ops', 'superadmin')], [grant('ops', 'superadmin'), grant('fleet', 'admin')])).toBe(true);
  });

  it('a caller without an admin-type grant may not act as anyone else', () => {
    expect(mayActAs([member('fleet')], [member('fleet')])).toBe(false);
  });

  it('an admin may act as a principal whose grants it holds at the same or a higher type', () => {
    const admin = [grant('fleet', 'admin'), member('bins')];
    expect(mayActAs(admin, [member('fleet')])).toBe(true);
    expect(mayActAs(admin, [grant('fleet', 'admin'), member('bins')])).toBe(true);
    expect(mayActAs(admin, [])).toBe(true);
  });

  it('an admin may not act as a superadmin, or as anyone holding a role it lacks or holds lower', () => {
    const admin = [grant('fleet', 'admin'), member('bins')];
    expect(mayActAs(admin, [grant('ops', 'superadmin')])).toBe(false);
    expect(mayActAs(admin, [member('payroll')])).toBe(false);
    expect(mayActAs(admin, [grant('bins', 'admin')])).toBe(false);
  });
});
