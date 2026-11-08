/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('inline-edit.css', () => {
  let styles: HTMLStyleElement[] = [];

  beforeEach(() => {
    // One sheet per file, as the build concatenates them: jsdom drops the rest of a sheet after an
    // at-rule it cannot parse, such as model-selector.css's @container.
    styles = ['base/variables.css', 'toolbar/model-selector.css', 'features/inline-edit.css'].map((file) => {
      const style = document.createElement('style');
      style.textContent = readFileSync(path.resolve('src/style', file), 'utf8');
      document.head.appendChild(style);
      return style;
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    for (const style of styles) style.remove();
  });

  function mountComposer(providerId: string): HTMLElement {
    const container = document.createElement('div');
    container.className = 'claudian-inline-input-container';
    container.dataset.provider = providerId;
    container.innerHTML = '<div class="claudian-inline-input-wrap"><div class="claudian-inline-spinner"></div></div>';
    document.body.appendChild(container);
    return container;
  }

  it('spins in the Obsidian accent rather than the provider brand', () => {
    const spinner = mountComposer('kiro').querySelector<HTMLElement>('.claudian-inline-spinner')!;

    expect(window.getComputedStyle(spinner).borderTopColor).toBe('var(--interactive-accent)');
  });

  // The upstream "model chip logo colour" case asserted a per-provider
  // `--claudian-provider-logo` token (e.g. var(--claudian-brand-deepseek)). Kirodian is kiro-only
  // and its merged `base/variables.css` defines no `--claudian-provider-logo` for any provider, so
  // the per-provider logo-colour contract is not reproducible here and the deepseek provider does
  // not exist. The dedicated colour case is dropped (no kiro token to retarget it to); the menu's
  // float-geometry contract below retains the rest of the scenario's coverage.

  it('floats the model menu fixed above its chip, outside the clipped editor', () => {
    document.body.innerHTML = '<div class="claudian-inline-menu-layer" data-provider="kiro">'
      + '<div class="claudian-toolbar-popover claudian-toolbar-popover--floating"></div></div>';
    const menu = window.getComputedStyle(document.querySelector('.claudian-toolbar-popover')!);

    // ToolbarMenu supplies the chosen edge and available height; CSS must consume all three.
    expect(menu.position).toBe('fixed');
    expect(menu.top).toBe('var(--claudian-toolbar-popover-top, auto)');
    expect(menu.maxHeight).toBe('min(var(--claudian-toolbar-popover-max-height, 420px), 60vh)');
    expect(menu.bottom).toBe('var(--claudian-toolbar-popover-bottom)');
  });

  it('keeps the review gutter bars inside the widget box, which Obsidian clips', () => {
    document.body.innerHTML = '<div class="claudian-inline-diff-preview"><div class="claudian-inline-diff-preview-body">'
      + '<div class="claudian-diff-block claudian-diff-del"></div></div></div>';

    for (const selector of ['.claudian-inline-diff-preview-body', '.claudian-diff-block']) {
      const style = window.getComputedStyle(document.querySelector(selector)!);
      // jsdom keeps logical margins as declared, so a negative bleed shows up as a minus sign.
      expect(`${style.marginLeft} ${style.getPropertyValue('margin-inline')}`).not.toMatch(/-\d/);
    }
  });

  it('separates the composer from the selected text below with padding, since Obsidian zeroes widget margins', () => {
    const host = document.createElement('style');
    host.textContent = '.markdown-source-view.mod-cm6 .cm-content > * { margin: 0 !important; }';
    document.head.appendChild(host);
    for (const style of styles) document.head.appendChild(style);
    styles.push(host);
    document.body.innerHTML = '<div class="markdown-source-view mod-cm6"><div class="cm-content">'
      + '<div class="claudian-inline-input-container" contenteditable="false"></div></div></div>';
    const composer = window.getComputedStyle(document.querySelector('.claudian-inline-input-container')!);

    expect(parseFloat(composer.marginBottom || '0') + parseFloat(composer.paddingBottom || '0')).toBeGreaterThanOrEqual(8);
  });

  it('gates the ::highlight rule, since an ungated one adds a highlight style to every element restyle', () => {
    const css = readFileSync(path.resolve('src/style/features/inline-edit.css'), 'utf8');
    const highlightSelectors = css.match(/^[^{}\n]*::highlight\([^{]*/gm) ?? [];

    expect(highlightSelectors.map(selector => selector.trim()))
      .toEqual(['body.claudian-selection-highlight-active ::highlight(claudian-selection)']);
  });
});
