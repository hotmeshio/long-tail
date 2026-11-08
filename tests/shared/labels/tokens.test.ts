import { describe, it, expect } from 'vitest';

import { listLabelTokens, renderLabelText, unknownLabelTokens, userTokenKeys } from '../../../shared/labels/tokens';

describe('renderLabelText', () => {
  const ctx = {
    target: 'A-3',
    item: { subtitle: 'Acme North', region: 'north' },
    user: { display_name: 'Ada Park', roles: ['gluer', 'finisher'] },
    scheme: { name: 'Two-code label' },
  };

  it('fills target, item, user and scheme tokens', () => {
    expect(renderLabelText('{target}', ctx)).toBe('A-3');
    expect(renderLabelText('{item.subtitle} · {item.region}', ctx)).toBe('Acme North · north');
    expect(renderLabelText('{user.display_name}', ctx)).toBe('Ada Park');
    expect(renderLabelText('{scheme.name}', ctx)).toBe('Two-code label');
  });

  it('joins list values', () => {
    expect(renderLabelText('{user.roles}', ctx)).toBe('gluer, finisher');
  });

  it('renders a missing value empty and trims', () => {
    expect(renderLabelText('{item.missing} {target}', ctx)).toBe('A-3');
    expect(renderLabelText('{user.display_name}', { target: 'x' })).toBe('');
  });

  it('leaves objects out', () => {
    expect(renderLabelText('{item.nested}', { target: 'x', item: { nested: { a: 1 } } })).toBe('');
  });
});

describe('token inspection', () => {
  it('lists tokens and names the unknown ones', () => {
    expect(listLabelTokens('{target} {item.a} {bogus}')).toEqual(['target', 'item.a', 'bogus']);
    expect(unknownLabelTokens('{target} {item.a} {bogus} {user.}')).toEqual(['bogus', 'user.']);
  });

  it('names user keys', () => {
    expect(userTokenKeys('{user.display_name} {user.badge_id} {item.x}')).toEqual(['display_name', 'badge_id']);
  });
});
