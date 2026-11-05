import { useEffect } from "react";
import { useGodviewLineDoor } from "../frame/line-door";
import { peekHost } from "../host";
import { soundAttentionOf } from "./attention";

/** A pane's element, by the deck's own mark. */
const paneElement = (paneId: string): Element | null =>
  document.querySelector(
    `[data-pane-id="${typeof CSS === "undefined" ? paneId : CSS.escape(paneId)}"]`,
  );

/** SD-2 — tells main this window's attention (`soundAttentionOf`) whenever it changes: the deck's panes, the window
 * gaining or losing the keyboard, a resize, a pane's box changing. Only a change is sent, at most once a frame. Main
 * hears it only from the window in front. A host with no sound door (a browser harness, the catalog) is never asked. */
export function useSoundAttention(): void {
  const door = useGodviewLineDoor();
  useEffect(() => {
    const sound = peekHost()?.sound;
    if (sound === undefined) return;
    let last = "";
    let frame = 0;
    const send = (): void => {
      frame = 0;
      const attention = soundAttentionOf({
        panes: door?.panes ?? [],
        rectOf: (paneId) => paneElement(paneId)?.getBoundingClientRect() ?? null,
        windowWidth: window.innerWidth,
        hasFocus: document.hasFocus(),
        onScreen: door?.onScreen ?? false,
      });
      const said = JSON.stringify(attention);
      if (said === last) return;
      last = said;
      sound.attention(attention);
    };
    const soon = (): void => {
      if (frame === 0) frame = requestAnimationFrame(send);
    };
    soon();
    window.addEventListener("focus", soon);
    window.addEventListener("blur", soon);
    window.addEventListener("resize", soon);
    const boxes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(soon);
    for (const pane of door?.panes ?? []) {
      const element = paneElement(pane.paneId);
      if (element !== null) boxes?.observe(element);
    }
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("focus", soon);
      window.removeEventListener("blur", soon);
      window.removeEventListener("resize", soon);
      boxes?.disconnect();
    };
  }, [door]);
}
