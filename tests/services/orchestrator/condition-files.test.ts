import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@hotmeshio/hotmesh', () => ({
  Durable: {
    workflow: {
      condition: vi.fn(),
      proxyActivities: vi.fn().mockReturnValue({ ltResolveEscalation: vi.fn().mockResolvedValue(undefined) }),
    },
  },
}));

import { conditional } from '../../../services/orchestrator/condition';
import { Durable } from '@hotmeshio/hotmesh';

const mockCondition = Durable.workflow.condition as ReturnType<typeof vi.fn>;

describe('conditional files fold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCondition.mockResolvedValue({ approved: true });
  });

  it('folds files into the unindexed envelope beside the caller envelope', async () => {
    await conditional('sig-f', {
      role: 'intake-verifier',
      envelope: { formDefaults: { first_name: 'Ana' } },
      files: [{ path: 'referrals/r-1.pdf', as: 'referral' }],
    });
    expect(mockCondition).toHaveBeenCalledWith('sig-f', {
      role: 'intake-verifier',
      envelope: {
        formDefaults: { first_name: 'Ana' },
        files: [{ path: 'referrals/r-1.pdf', as: 'referral' }],
      },
    });
  });

  it('folds files and lookups into one envelope', async () => {
    await conditional('sig-fl', {
      role: 'intake-verifier',
      lookups: [{ domain: 'catalog', key: 'payers' }],
      files: [{ path: 'cards/c-1.png', as: 'card' }],
    });
    expect(mockCondition).toHaveBeenCalledWith('sig-fl', {
      role: 'intake-verifier',
      envelope: {
        lookups: [{ domain: 'catalog', key: 'payers' }],
        files: [{ path: 'cards/c-1.png', as: 'card' }],
      },
    });
  });

  it('passes a config without sugar through untouched', async () => {
    const config = { role: 'intake-verifier', envelope: { note: 'x' } };
    await conditional('sig-plain', config);
    expect(mockCondition).toHaveBeenCalledWith('sig-plain', config);
  });

  it('rejects a ref that leaves the store before the engine write', async () => {
    await expect(conditional('sig-bad', {
      role: 'intake-verifier',
      files: [{ path: 'referrals/../secrets.pdf', as: 'referral' }],
    })).rejects.toThrow(/storage key/);
    expect(mockCondition).not.toHaveBeenCalled();
  });

  it('rejects two refs sharing one address', async () => {
    await expect(conditional('sig-dup', {
      role: 'intake-verifier',
      files: [{ path: 'a.pdf', as: 'doc' }, { path: 'b.pdf', as: 'doc' }],
    })).rejects.toThrow(/more than one file/);
  });
});
