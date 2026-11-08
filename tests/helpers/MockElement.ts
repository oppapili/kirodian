/** Listener or dispatched payload; the mock passes `{ type, target }` objects, not DOM events. */
type MockEventHandler = (event: object) => void;
type MockEventInit = { type: string; [key: string]: unknown };

export interface MockElement {
  tagName: string;
  children: MockEl[];
  childNodes: MockEl[];
  style: Record<string, string>;
  dataset: Record<string, string>;
  scrollLeft: number;
  scrollTop: number;
  scrollHeight: number;
  innerHTML: string;
  textContent: string;
  className: string;
  classList: {
    add: (cls: string) => void;
    remove: (cls: string) => void;
    contains: (cls: string) => boolean;
    toggle: (cls: string, force?: boolean) => boolean;
  };
  addClass: (cls: string) => MockEl;
  removeClass: (cls: string) => MockEl;
  hasClass: (cls: string) => boolean;
  getClasses: () => string[];
  createDiv: (opts?: { cls?: string; text?: string }) => MockEl;
  createSpan: (opts?: { cls?: string; text?: string }) => MockEl;
  createEl: (tag: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }) => MockEl;
  createSvg: (tag: string, opts?: { cls?: string; attr?: Record<string, string> }) => MockEl;
  appendChild: (child: MockEl) => MockEl;
  replaceChildren: (...children: MockEl[]) => void;
  cloneNode: (deep?: boolean) => MockEl;
  insertBefore: (el: MockEl, ref: MockEl | null) => void;
  firstChild: MockEl | null;
  remove: () => void;
  empty: () => void;
  contains: (node: unknown) => boolean;
  scrollIntoView: () => void;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | undefined | null;
  removeAttribute: (name: string) => void;
  addEventListener: (
    event: string,
    handler: MockEventHandler,
    options?: AddEventListenerOptions | boolean,
  ) => void;
  removeEventListener: (event: string, handler: MockEventHandler) => void;
  dispatchEvent: (eventOrType: string | MockEventInit, extraArg?: object) => void;
  click: () => void;
  getEventListenerCount: (event: string) => number;
  getEventListenerOptions: (event: string) => Array<AddEventListenerOptions | boolean | undefined>;
  querySelector: (selector: string) => MockEl | null;
  querySelectorAll: (selector: string) => MockEl[];
  getBoundingClientRect: () => { top: number; left: number; width: number; height: number; right: number; bottom: number; x: number; y: number; toJSON: () => void };
  setText: (text: string) => void;
  appendText: (text: string) => void;
  setCssProps: (props: Record<string, string>) => void;
  ownerDocument: {
    defaultView: {
      addEventListener: (event: string, handler: MockEventHandler) => void;
      removeEventListener: (event: string, handler: MockEventHandler) => void;
      requestAnimationFrame: (callback: FrameRequestCallback) => number;
      cancelAnimationFrame: (handle: number) => void;
      setTimeout: (callback: () => void, timeout: number) => number;
      clearTimeout: (handle: number) => void;
      setInterval: (callback: () => void, timeout: number) => number;
      clearInterval: (handle: number) => void;
    };
    activeElement?: MockElement | null;
    body?: MockElement;
    addEventListener?: (event: string, handler: MockEventHandler) => void;
    removeEventListener?: (event: string, handler: MockEventHandler) => void;
    createElement: (tagName: string) => MockEl;
    createElementNS: (namespace: string, tagName: string) => MockEl;
    getSelection?: () => Selection | null;
  };
  _classes: Set<string>;
  _classList: Set<string>;
  _attributes: Map<string, string>;
  _eventListeners: Map<string, MockEventHandler[]>;
  _eventListenerOptions: Map<string, Array<AddEventListenerOptions | boolean | undefined>>;
  _children: MockEl[];
  value: string;
  selectionStart: number;
  selectionEnd: number;
  clientHeight: number;
  clientWidth: number;
  offsetHeight: number;
  offsetWidth: number;
  parentElement: MockEl | null;
  focus: () => void;
  blur: () => void;
  select: () => void;
  setAttr: (name: string, value: string) => void;
  toggleClass: (cls: string, force: boolean) => void;
  closest: (selector?: string) => { clientHeight: number };
  getEventListeners: () => Map<string, MockEventHandler[]>;
}

/** A mock element that also passes where production code asks for an `HTMLElement`. */
export type MockEl = MockElement & HTMLElement;

const CLASS_DISPLAY: Record<string, string> = {
  'claudian-context-meter': 'flex',
  'claudian-mcp-selector': 'flex',
  'claudian-mode-selector': 'flex',
  'claudian-permission-toggle': 'flex',
  'claudian-service-tier-toggle': 'flex',
  'claudian-tab-content': 'flex',
  'claudian-thinking-budget': 'flex',
  'claudian-thinking-effort': 'flex',
};

const DISPLAY_CLASSES = new Set([
  'claudian-hidden',
  'claudian-visible-flex',
  ...Object.keys(CLASS_DISPLAY),
]);

export function createMockEl(tag = 'div'): MockEl {
  const children: MockEl[] = [];
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const eventListeners = new Map<string, MockEventHandler[]>();
  const eventListenerOptions = new Map<
    string,
    Array<AddEventListenerOptions | boolean | undefined>
  >();
  const dataset: Record<string, string> = {};
  const style: Record<string, string> = {};
  let textContent = '';

  const resolveDisplay = (): string | null => {
    if (classes.has('claudian-hidden')) return 'none';
    if (classes.has('claudian-visible-flex')) return 'flex';

    for (const [cls, display] of Object.entries(CLASS_DISPLAY)) {
      if (classes.has(cls)) return display;
    }

    return null;
  };

  const syncDisplay = () => {
    const display = resolveDisplay();
    if (display === null) {
      style.display = '';
      return;
    }
    style.display = display;
  };

  const updateClass = (cls: string, enabled: boolean) => {
    if (enabled) {
      classes.add(cls);
    } else {
      classes.delete(cls);
    }
    if (DISPLAY_CLASSES.has(cls)) {
      syncDisplay();
    }
  };

  const defaultView = {
    // Attribute observation is exercised with real DOM fixtures, not MockElement.
    MutationObserver: class { observe() {} disconnect() {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (callback: FrameRequestCallback): number => {
      const requestFrame =
        (globalThis as { window?: Window }).window?.requestAnimationFrame
        ?? (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame;
      if (typeof requestFrame === 'function') {
        return requestFrame(callback);
      }
      return globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number;
    },
    cancelAnimationFrame: (handle: number): void => {
      const cancelFrame =
        (globalThis as { window?: Window }).window?.cancelAnimationFrame
        ?? (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame;
      if (typeof cancelFrame === 'function') {
        cancelFrame(handle);
        return;
      }
      globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    setTimeout: (callback: () => void, timeout: number): number =>
      globalThis.setTimeout(callback, timeout) as unknown as number,
    clearTimeout: (handle: number): void => {
      globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    setInterval: (callback: () => void, timeout: number): number =>
      globalThis.setInterval(callback, timeout) as unknown as number,
    clearInterval: (handle: number): void => {
      globalThis.clearInterval(handle as unknown as ReturnType<typeof setInterval>);
    },
  };

  // Tests replace the global document with partial fakes, so only the members they provide exist.
  const currentDocument = () =>
    (globalThis as { document?: unknown }).document as Partial<MockElement['ownerDocument']> | undefined;
  const ownerDocument = {
    defaultView,
    get activeElement() {
      return currentDocument()?.activeElement ?? null;
    },
    get body() {
      return currentDocument()?.body;
    },
    addEventListener(event: string, handler: MockEventHandler) {
      currentDocument()?.addEventListener?.(event, handler);
    },
    removeEventListener(event: string, handler: MockEventHandler) {
      currentDocument()?.removeEventListener?.(event, handler);
    },
    createElement: (tagName: string) => currentDocument()?.createElement?.(tagName) ?? createMockEl(tagName),
    createElementNS: (namespace: string, tagName: string) =>
      currentDocument()?.createElementNS?.(namespace, tagName) ?? createMockEl(tagName),
    getSelection: () => currentDocument()?.getSelection?.() ?? null,
  };

  const element: MockElement = {
    tagName: tag.toUpperCase(),
    children,
    // These mocks only hold element children, so childNodes mirrors children for DOM APIs
    // (e.g. Array.from(el.childNodes)) that the real elements expose.
    get childNodes() {
      return children;
    },
    style,
    dataset,
    scrollLeft: 0,
    scrollTop: 0,
    scrollHeight: 0,
    innerHTML: '',

    get textContent() {
      return textContent;
    },
    set textContent(value: string) {
      textContent = value;
    },

    get className() {
      return Array.from(classes).join(' ');
    },
    set className(value: string) {
      classes.clear();
      if (value) {
        value.split(' ').filter(Boolean).forEach(c => classes.add(c));
      }
      syncDisplay();
    },

    classList: {
      add: (cls: string) => updateClass(cls, true),
      remove: (cls: string) => updateClass(cls, false),
      contains: (cls: string) => classes.has(cls),
      toggle: (cls: string, force?: boolean) => {
        if (force === undefined) {
          if (classes.has(cls)) {
            updateClass(cls, false);
            return false;
          }
          updateClass(cls, true);
          return true;
        }
        updateClass(cls, force);
        return force;
      },
    },

    addClass(cls: string) {
      cls.split(/\s+/).filter(Boolean).forEach(c => updateClass(c, true));
      return element as MockEl;
    },
    removeClass(cls: string) {
      cls.split(/\s+/).filter(Boolean).forEach(c => updateClass(c, false));
      return element as MockEl;
    },
    hasClass: (cls: string) => classes.has(cls),
    getClasses: () => Array.from(classes),

    createDiv(opts?: { cls?: string; text?: string }) {
      const child = createMockEl('div');
      if (opts?.cls) child.addClass(opts.cls);
      if (opts?.text) child.textContent = opts.text;
      children.push(child);
      return child;
    },
    createSpan(opts?: { cls?: string; text?: string }) {
      const child = createMockEl('span');
      if (opts?.cls) child.addClass(opts.cls);
      if (opts?.text) child.textContent = opts.text;
      children.push(child);
      return child;
    },
    createEl(tagName: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }) {
      const child = createMockEl(tagName);
      if (opts?.cls) child.addClass(opts.cls);
      if (opts?.text) child.textContent = opts.text;
      if (opts?.attr) {
        for (const [name, value] of Object.entries(opts.attr)) {
          child.setAttribute(name, value);
        }
      }
      children.push(child);
      return child;
    },
    createSvg(tagName: string, opts?: { cls?: string; attr?: Record<string, string> }) {
      const child = createMockEl(tagName);
      if (opts?.cls) child.addClass(opts.cls);
      if (opts?.attr) {
        for (const [name, value] of Object.entries(opts.attr)) {
          child.setAttribute(name, value);
        }
      }
      children.push(child);
      return child;
    },

    appendChild(child: MockEl) {
      const existingIndex = children.indexOf(child);
      if (existingIndex >= 0) children.splice(existingIndex, 1);
      children.push(child);
      return child;
    },
    replaceChildren(...replacementChildren: MockEl[]) {
      children.length = 0;
      for (const child of replacementChildren) children.push(child);
    },
    cloneNode(deep = false) {
      const clone = createMockEl(tag);
      clone.className = element.className;
      clone.innerHTML = element.innerHTML;
      clone.textContent = textContent;
      clone.scrollLeft = element.scrollLeft;
      clone.scrollTop = element.scrollTop;
      clone.scrollHeight = element.scrollHeight;
      clone.value = element.value;
      Object.assign(clone.style, style);
      Object.assign(clone.dataset, dataset);
      for (const [name, value] of attributes) clone.setAttribute(name, value);
      if (deep) {
        for (const child of children) clone.appendChild(child.cloneNode(true));
      }
      return clone;
    },
    insertBefore(el: MockEl, _ref: MockEl | null) { children.unshift(el); },
    get firstChild() { return children[0] || null; },
    remove() {},
    empty() {
      children.length = 0;
      element.innerHTML = '';
      textContent = '';
    },
    contains(node: unknown) {
      if (node === element) return true;
      return children.some(child => child.contains(node));
    },
    scrollIntoView() {},
    focus() {
      const handlers = eventListeners.get('focus') || [];
      handlers.forEach(h => h({ type: 'focus', target: element }));
    },
    blur() {
      const handlers = eventListeners.get('blur') || [];
      handlers.forEach(h => h({ type: 'blur', target: element }));
    },
    select() {},

    setAttribute(name: string, value: string) {
      if (name === 'class') {
        element.className = value;
      } else {
        attributes.set(name, value);
      }
      if (name.startsWith('data-')) {
        dataset[name.slice(5).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())] = value;
      }
    },
    getAttribute(name: string) {
      if (name === 'class') return element.className;
      return attributes.get(name) ?? null;
    },
    removeAttribute(name: string) {
      if (name === 'class') {
        element.className = '';
      } else {
        attributes.delete(name);
      }
      if (name.startsWith('data-')) {
        delete dataset[name.slice(5).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())];
      }
    },

    addEventListener(
      event: string,
      handler: MockEventHandler,
      options?: AddEventListenerOptions | boolean,
    ) {
      if (!eventListeners.has(event)) eventListeners.set(event, []);
      eventListeners.get(event)!.push(handler);
      if (!eventListenerOptions.has(event)) eventListenerOptions.set(event, []);
      eventListenerOptions.get(event)!.push(options);
    },
    removeEventListener(event: string, handler: MockEventHandler) {
      const handlers = eventListeners.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
      }
    },
    dispatchEvent(eventOrType: string | MockEventInit, extraArg?: object) {
      if (typeof eventOrType === 'string') {
        const handlers = eventListeners.get(eventOrType) || [];
        handlers.forEach(h => h(extraArg ?? {}));
      } else {
        const handlers = eventListeners.get(eventOrType.type) || [];
        handlers.forEach(h => h(eventOrType));
      }
    },
    click() {
      const handlers = eventListeners.get('click') || [];
      handlers.forEach(h => h({ type: 'click', target: element, stopPropagation: () => {} }));
    },
    getEventListenerCount(event: string) {
      return eventListeners.get(event)?.length ?? 0;
    },
    getEventListenerOptions(event: string) {
      return eventListenerOptions.get(event) ?? [];
    },

    querySelector(selector: string) {
      const simpleClassSelector = selector.match(/^([a-z][\w-]*)?\.([\w-]+)$/i);
      const tagName = simpleClassSelector?.[1]?.toUpperCase();
      const cls = simpleClassSelector?.[2] ?? selector.replace('.', '');
      const find = (el: MockEl): MockEl | null => {
        if ((!tagName || el.tagName === tagName) && el.hasClass(cls)) return el;
        for (const child of el.children) {
          const found = find(child);
          if (found) return found;
        }
        return null;
      };
      return find(element as MockEl);
    },
    querySelectorAll(selector: string) {
      const simpleClassSelector = selector.match(/^([a-z][\w-]*)?\.([\w-]+)$/i);
      const tagName = simpleClassSelector?.[1]?.toUpperCase();
      const cls = simpleClassSelector?.[2] ?? selector.replace('.', '');
      const results: MockEl[] = [];
      const collect = (el: MockEl) => {
        if ((!tagName || el.tagName === tagName) && el.hasClass(cls)) results.push(el);
        for (const child of el.children) collect(child);
      };
      for (const child of children) collect(child);
      return results;
    },

    getBoundingClientRect() {
      return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
    },

    setText(text: string) { textContent = text; },
    appendText(text: string) { textContent += text; },
    setCssProps(props: Record<string, string>) {
      for (const [name, value] of Object.entries(props)) {
        style[name] = value;
      }
    },
    setAttr(name: string, value: string) { element.setAttribute(name, value); },
    toggleClass(cls: string, force: boolean) {
      updateClass(cls, force);
    },
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    clientHeight: 0,
    clientWidth: 0,
    offsetHeight: 0,
    offsetWidth: 0,
    parentElement: null,
    closest() { return { clientHeight: 600 }; },
    getEventListeners() { return eventListeners; },
    ownerDocument,

    _classes: classes,
    _classList: classes,
    _attributes: attributes,
    _eventListeners: eventListeners,
    _eventListenerOptions: eventListenerOptions,
    _children: children,
  };

  return element as MockEl;
}
