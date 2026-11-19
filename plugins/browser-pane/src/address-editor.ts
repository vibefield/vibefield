import type { ObjectDomHost } from "@vibefield/plugin-sdk/desk";

/** Lease the desk's editor in place, keeping native selection, clipboard, caret and IME behavior. */
export function mountAddressEditor({ container, editor }: ObjectDomHost) {
  const sheet = container.ownerDocument.createElement("style");
  sheet.textContent = `
    textarea[data-browser-pane-address] {
      color: var(--vf-text-primary) !important;
      caret-color: var(--vf-text-primary) !important;
      background: var(--vf-chrome-solid) !important;
      font-family: var(--vf-font-sans) !important;
      border-radius: 999px;
      padding-inline: 10px !important;
      white-space: pre !important;
      overflow: hidden !important;
      pointer-events: auto !important;
      outline: 2px solid var(--vf-select) !important;
      outline-offset: 1px;
    }
    textarea[data-desk-editor][data-browser-pane-address]::selection {
      background: var(--vf-select);
      color: var(--vf-state-on-solid);
    }
  `;
  container.appendChild(sheet);
  const attributes: Record<string, string> = {
    "aria-label": "Search or enter address",
    inputmode: "url",
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    wrap: "off",
    rows: "1",
  };
  let saved: Map<string, string | null> | undefined;
  const show = (on: boolean): void => {
    editor.element.toggleAttribute("data-browser-pane-address", on);
    if (on && saved === undefined) {
      saved = new Map(
        Object.keys(attributes).map((key) => [key, editor.element.getAttribute(key)]),
      );
      for (const [key, value] of Object.entries(attributes))
        editor.element.setAttribute(key, value);
    } else if (!on && saved !== undefined) {
      for (const [key, value] of saved) {
        if (value === null) editor.element.removeAttribute(key);
        else editor.element.setAttribute(key, value);
      }
      saved = undefined;
    }
  };
  const pointer = (ev: PointerEvent) => {
    if (saved !== undefined) ev.stopPropagation();
  };
  editor.element.addEventListener("pointerdown", pointer);
  return {
    show,
    dispose() {
      show(false);
      editor.element.removeEventListener("pointerdown", pointer);
      sheet.remove();
    },
  };
}
