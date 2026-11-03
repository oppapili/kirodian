import type { ProviderIconSvg, ProviderSvgChild } from '../core/providers/types';

const MCP_ICON_PATHS = [
  'M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z',
  'M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z',
];

export function appendMCPIcon(container: HTMLElement): void {
  container.empty();

  const svg = container.createSvg('svg');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('fill-rule', 'evenodd');
  svg.setAttribute('height', '1em');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '1em');

  for (const pathData of MCP_ICON_PATHS) {
    const path = svg.createSvg('path');
    path.setAttribute('d', pathData);
  }

  container.appendChild(svg);
}

// Official Kiro logo (single-colour mark). The source art is drawn in a 75x100
// viewBox and positioned by a matrix transform, so it is emitted as a composite
// icon: a <g transform> wrapping the path preserves that placement. The path
// fills with currentColor so the mark follows the surrounding text colour.
export const KIRO_PROVIDER_ICON: ProviderIconSvg = {
  kind: 'composite',
  viewBox: '0 0 75 100',
  children: [
    {
      tag: 'g',
      attributes: {
        transform: 'matrix(3.800695,0,0,4.166604,-7.598366,0.001061)',
      },
      children: [
        {
          tag: 'path',
          attributes: {
            d: 'M4.594,6.677C6.67,-2.226 18.746,-2.211 21.16,6.632C21.513,7.929 22.885,14.214 19.487,20.379C17.942,23.176 13.646,25.869 12.497,22.262C8.6,25.477 3.315,24.1 5.789,18.609L5.471,18.752C1.901,20.057 1.608,17.544 2.298,16.239C2.748,15.399 3.025,14.904 3.235,14.342C3.588,13.367 3.693,12.774 3.828,11.844C4.098,10.007 4.105,8.237 4.593,6.677L4.594,6.677ZM12.964,6.687C12.638,6.676 12.329,6.839 12.154,7.115C11.937,7.438 11.824,7.94 11.824,8.577C11.824,9.282 11.974,10.467 12.964,10.467L12.972,10.467C13.729,10.467 14.186,9.762 14.186,8.577C14.186,7.955 14.059,7.452 13.819,7.122C13.625,6.843 13.304,6.68 12.964,6.687ZM17.044,6.687C16.718,6.676 16.409,6.839 16.234,7.115C16.017,7.438 15.904,7.94 15.904,8.577C15.904,9.282 16.054,10.467 17.044,10.467L17.052,10.467C17.809,10.467 18.267,9.762 18.267,8.577C18.267,7.955 18.139,7.452 17.899,7.122C17.705,6.843 17.384,6.68 17.044,6.687Z',
            fill: 'currentColor',
            'fill-rule': 'evenodd',
            'clip-rule': 'evenodd',
          },
        },
      ],
    },
  ],
};


export interface CreateProviderIconSvgOptions {
  className?: string;
  dataProvider?: string;
  height?: number | string;
  parent?: HTMLElement;
  width?: number | string;
}

export function createProviderIconSvg(
  icon: ProviderIconSvg,
  options: CreateProviderIconSvgOptions = {},
): SVGElement {
  const parent = options.parent ?? activeDocument.body;
  const svg = parent.createSvg('svg');
  svg.setAttribute('viewBox', icon.viewBox);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('claudian-provider-icon');

  if (options.width !== undefined) {
    svg.setAttribute('width', String(options.width));
  }
  if (options.height !== undefined) {
    svg.setAttribute('height', String(options.height));
  }
  if (options.className) {
    svg.classList.add(...options.className.split(/\s+/).filter(Boolean));
  }
  if (options.dataProvider) {
    svg.setAttribute('data-provider', options.dataProvider);
  }

  if (icon.kind === 'composite') {
    for (const child of icon.children) {
      svg.appendChild(createProviderSvgChild(child, svg));
    }
    return svg;
  }

  const path = svg.createSvg('path');
  path.setAttribute('d', icon.path);
  path.setAttribute('fill', 'currentColor');
  return svg;
}

function createProviderSvgChild(child: ProviderSvgChild, parent: SVGElement): SVGElement {
  const element = parent.createSvg(child.tag);
  for (const [name, value] of Object.entries(child.attributes)) {
    element.setAttribute(name, value);
  }

  if (child.tag === 'g') {
    for (const nestedChild of child.children) {
      element.appendChild(createProviderSvgChild(nestedChild, element));
    }
  }

  return element;
}
