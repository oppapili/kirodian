/** @jest-environment jsdom */

import {
  CLAUDE_PROVIDER_ICON,
  createProviderIconSvg,
  KIRO_PROVIDER_ICON,
} from '@/shared/icons';

describe('createProviderIconSvg', () => {
  it('renders path-based provider icons with currentColor fill', () => {
    const svg = createProviderIconSvg(CLAUDE_PROVIDER_ICON, {
      className: 'test-icon',
      height: 12,
      parent: document.body,
      width: 12,
    });

    expect(svg.getAttribute('viewBox')).toBe(CLAUDE_PROVIDER_ICON.viewBox);
    expect(svg.getAttribute('width')).toBe('12');
    expect(svg.getAttribute('height')).toBe('12');
    expect(svg.classList.contains('claudian-provider-icon')).toBe(true);
    expect(svg.classList.contains('test-icon')).toBe(true);

    const path = svg.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('fill')).toBe('currentColor');
  });

  it('renders the Kiro provider icon as a transform-wrapped currentColor mark', () => {
    const svg = createProviderIconSvg(KIRO_PROVIDER_ICON, {
      dataProvider: 'kiro',
      parent: document.body,
    });

    expect(svg.getAttribute('viewBox')).toBe('0 0 75 100');
    const group = svg.querySelector('g');
    expect(group).not.toBeNull();
    expect(group?.getAttribute('transform')).toBe('matrix(3.800695,0,0,4.166604,-7.598366,0.001061)');
    const path = svg.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('fill')).toBe('currentColor');
    expect(path?.getAttribute('fill-rule')).toBe('evenodd');
  });
});
