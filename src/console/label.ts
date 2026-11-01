/**
 * A text label that is cut off with "…" when it doesn't fit, and shows the
 * full text as a hover tooltip while it's cut off.
 */
export function createLabel(text: string, tag: "div" | "span" = "div") {
  const el = document.createElement(tag);
  el.className = "cc-label";
  el.textContent = text;
  // Decide on hover rather than once at creation, so the tooltip tracks the
  // current layout (e.g. after a resize).
  el.addEventListener("pointerenter", () => {
    el.title = el.scrollWidth > el.clientWidth ? text : "";
  });
  return el;
}
