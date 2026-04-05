import "@testing-library/jest-dom/vitest";

// jsdom does not implement scrollTo
Element.prototype.scrollTo = Element.prototype.scrollTo || function () {};