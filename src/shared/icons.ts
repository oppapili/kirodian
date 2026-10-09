import type { ProviderIconSvg, ProviderSvgChild } from '../core/providers/types';

export const MCP_ICON_SVG = `<svg fill="currentColor" fill-rule="evenodd" height="1em" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><title>MCP</title><path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z"></path><path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z"></path></svg>`;

export const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

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

  const title = svg.createSvg('title');
  title.textContent = 'MCP';

  for (const pathData of MCP_ICON_PATHS) {
    const path = svg.createSvg('path');
    path.setAttribute('d', pathData);
  }

  container.appendChild(svg);
}

export const CLAUDE_PROVIDER_ICON: ProviderIconSvg = {
  viewBox: '0 -.01 39.5 39.53',
  path: 'm7.75 26.27 7.77-4.36.13-.38-.13-.21h-.38l-1.3-.08-4.44-.12-3.85-.16-3.73-.2-.94-.2-.88-1.16.09-.58.79-.53 1.13.1 2.5.17 3.75.26 2.72.16 4.03.42h.64l.09-.26-.22-.16-.17-.16-3.88-2.63-4.2-2.78-2.2-1.6-1.19-.81-.6-.76-.26-1.66 1.08-1.19 1.45.1.37.1 1.47 1.13 3.14 2.43 4.1 3.02.6.5.24-.17.03-.12-.27-.45-2.23-4.03-2.38-4.1-1.06-1.7-.28-1.02c-.1-.42-.17-.77-.17-1.2l1.23-1.67.68-.22 1.64.22.69.6 1.02 2.33 1.65 3.67 2.56 4.99.75 1.48.4 1.37.15.42h.26v-.24l.21-2.81.39-3.45.38-4.44.13-1.25.62-1.5 1.23-.81.96.46.79 1.13-.11.73-.47 3.05-.92 4.78-.6 3.2h.35l.4-.4 1.62-2.15 2.72-3.4 1.2-1.35 1.4-1.49.9-.71h1.7l1.25 1.86-.56 1.92-1.75 2.22-1.45 1.88-2.08 2.8-1.3 2.24.12.18.31-.03 4.7-1 2.54-.46 3.03-.52 1.37.64.15.65-.54 1.33-3.24.8-3.8.76-5.66 1.34-.07.05.08.1 2.55.24 1.09.06h2.67l4.97.37 1.3.86.78 1.05-.13.8-2 1.02-2.7-.64-6.3-1.5-2.16-.54h-.3v.18l1.8 1.76 3.3 2.98 4.13 3.84.21.95-.53.75-.56-.08-3.63-2.73-1.4-1.23-3.17-2.67h-.21v.28l.73 1.07 3.86 5.8.2 1.78-.28.58-1 .35-1.1-.2-2.26-3.17-2.33-3.57-1.88-3.2-.23.13-1.11 11.95-.52.61-1.2.46-1-.76-.53-1.23.53-2.43.64-3.17.52-2.52.47-3.13.28-1.04-.02-.07-.23.03-2.36 3.24-3.59 4.85-2.84 3.04-.68.27-1.18-.61.11-1.09.66-.97 3.93-5 2.37-3.1 1.53-1.79-.01-.26h-.09l-10.44 6.78-1.86.24-.8-.75.1-1.23.38-.4 3.14-2.16z',
};

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
