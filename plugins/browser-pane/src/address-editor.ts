import type { ObjectDomHost } from "@vibefield/plugin-sdk/desk";

/** ICE's shared editor is transparent: most kinds paint its text themselves. The address is the editor's own text,
 * selection and caret, visible only for this lease, over the capsule (PT-3 ruling 8). No second input is created. */
export function mountAddressEditor({ container, editor }: ObjectDomHost) {
  const sheet = container.ownerDocument.createElement("style");
  sheet.textContent = `
    textarea[data-browser-pane-address] {
      color: var(--vf-text-primary) !important;
      caret-color: var(--vf-text-primary) !important;
      background: var(--vf-chrome-solid) !important;
      font-family: var(--vf-font-sans) !important;
      border-radius: var(--vf-radius-control);
      padding-inline: var(--vf-radius-control) !important;
    }
    textarea[data-desk-editor][data-browser-pane-address]::selection {
      background: var(--vf-select);
      color: var(--vf-state-on-solid);
    }
  `;
  container.appendChild(sheet);
  const show = (on: boolean): void => {
    editor.element.toggleAttribute("data-browser-pane-address", on);
  };
  return {
    show,
    dispose() {
      show(false);
      sheet.remove();
    },
  };
}
