import '@testing-library/jest-dom';

// jsdom has no ResizeObserver; useContainerWidth treats the absence as
// "no measure yet" (wide), so components render their table/inline modes in
// tests unless a force prop says otherwise. The stub keeps direct
// constructions from throwing.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
