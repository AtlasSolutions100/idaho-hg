import '@testing-library/jest-dom/vitest';

// jsdom lacks pointer-capture and scroll APIs that Radix UI primitives use.
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

// jsdom lacks ResizeObserver, which Radix UI tabs/sliders observe with.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom doesn't implement matchMedia, which some UI components consult.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Node 24+ defines its own `localStorage` global, which is undefined unless
// the process was started with --localstorage-file. On globalThis it shadows
// the one jsdom installs, so `window.localStorage` reads back undefined and
// any component that stores something throws. Give the tests a plain
// in-memory Storage when that happens.
if (typeof window !== 'undefined' && !window.localStorage) {
  const makeStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (key: string) => map.get(String(key)) ?? null,
      key: (index: number) => [...map.keys()][index] ?? null,
      removeItem: (key: string) => void map.delete(String(key)),
      setItem: (key: string, value: string) => void map.set(String(key), String(value)),
    } as Storage;
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: makeStorage(),
  });
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: makeStorage(),
  });
}
