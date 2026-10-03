import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { type KeyboardEvent, type ReactElement, useEffect, useId, useRef, useState } from "react";
import { choiceNote, type DeviceChoice } from "./monitor/device-filter";
import { OS_LABEL, OsMark } from "./os-marks";

/**
 * DS-3 — THE DEVICE FILTER: one dropdown chip in the instrument bar, before
 * the profile tabs (`thinking-project-places.md` §6.2, PJ-D23's lean: "a
 * desktop chip (History's dropdown) beside the profile tabs").
 *
 * James's direction for anything that shows devices (2026-09-30): a filter is
 * a DROPDOWN, never a row of text tabs; a CHOICE is the device's mark and its
 * name; "here" is said where it is a fact worth saying (the menu), and the
 * chip at rest reads the choice. The chip IS a bar control — the views'
 * recipe, worn by class — and its menu is the bar's own material (the panel,
 * its hairline, §5's island shadow; `godview.css`).
 *
 * A view: it holds whether its menu is open and nothing else. The choice is
 * the stage's (`GodviewMonitor`), the choices are the board's
 * (`deviceChoices`); the catalog mounts this same component on fixtures.
 */
export interface DeviceFilterChipProps {
  /** every desktop on the board, this one first */
  devices: readonly DeviceChoice[];
  /** the chosen desktop's id, or null for all of them */
  selected: string | null;
  onSelect(id: string | null): void;
  /** told when the menu opens and closes, so the stage can hold the keys
   * while it is open (the find sheet's rule, QL-D2) */
  onOpenChange?(open: boolean): void;
  /** the catalog's: draw the menu open */
  defaultOpen?: boolean;
}

/** The caret every dropdown in the bar wears: the kit's chevron turned down (DESIGN.md §13). */
function Caret(): ReactElement {
  return <FieldGlyph name="chevron" size={10} turn={90} className="vf-device-filter-caret" />;
}

export function DeviceFilterChip({
  devices,
  selected,
  onSelect,
  onOpenChange,
  defaultOpen = false,
}: DeviceFilterChipProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const hostRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const chosen = devices.find((device) => device.id === selected);
  const total = devices.reduce((sum, device) => sum + device.agents, 0);

  // The stage holds the keys while the menu is open, so it must hear the menu
  // go — closed, or gone with the chip itself: the board dropped to one
  // desktop and the chip unmounted with its menu open. Until 2026-10-01 only a
  // close was said, and the stage kept the keys (every pane's fresh-shell
  // launcher hidden) until Godview closed.
  useEffect(() => {
    if (!open || onOpenChange === undefined) return;
    onOpenChange(true);
    return () => onOpenChange(false);
  }, [open, onOpenChange]);

  // A pointer anywhere else puts the menu away, as every dropdown does.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (hostRef.current?.contains(event.target as Node) === true) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  // Opened by a gesture, the menu takes the focus at the current choice.
  const focusOnOpen = useRef(false);
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const current = menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    (current ?? menuRef.current?.querySelector<HTMLButtonElement>("[role=option]"))?.focus();
  }, [open]);

  const close = (): void => {
    setOpen(false);
    chipRef.current?.focus();
  };
  const choose = (id: string | null): void => {
    onSelect(id);
    close();
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const options = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? []),
    ];
    const at = options.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number): void => {
      event.preventDefault();
      options[(to + options.length) % options.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        move(at + 1);
        return;
      case "ArrowUp":
        move(at - 1);
        return;
      case "Home":
        move(0);
        return;
      case "End":
        move(options.length - 1);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      case "Tab":
        setOpen(false);
        return;
    }
  };

  return (
    <span className="vf-device-filter" ref={hostRef}>
      <button
        ref={chipRef}
        type="button"
        className={`vf-godview-bar-control vf-device-filter-chip${open ? " is-on" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...(open ? { "aria-controls": menuId } : {})}
        aria-label={
          chosen === undefined
            ? "Desktops: all desktops"
            : `Desktops: ${chosen.name}${chosen.here ? ", here" : ""}`
        }
        title={chosen === undefined ? "All desktops" : `${chosen.name} · ${OS_LABEL[chosen.os]}`}
        onClick={() => {
          focusOnOpen.current = !open;
          setOpen((current) => !current);
        }}
      >
        {chosen === undefined ? (
          <span>All desktops</span>
        ) : (
          <>
            <OsMark os={chosen.os} size={10} />
            <span>{chosen.name}</span>
          </>
        )}
        <Caret />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="listbox"
          aria-label="Desktops"
          className="vf-device-filter-menu"
          onKeyDown={onMenuKeyDown}
        >
          <button
            type="button"
            role="option"
            aria-selected={selected === null}
            className="vf-device-filter-row"
            data-device=""
            onClick={() => choose(null)}
          >
            <span className="vf-device-filter-slot" aria-hidden="true" />
            <span className="vf-device-filter-name">All desktops</span>
            <em>{`${total} agent${total === 1 ? "" : "s"}`}</em>
          </button>
          {devices.map((device) => (
            <button
              key={device.id}
              type="button"
              role="option"
              aria-selected={selected === device.id}
              className={`vf-device-filter-row${device.state === "live" ? "" : " is-quiet"}`}
              data-device={device.id}
              data-state={device.state}
              title={`${device.name} · ${OS_LABEL[device.os]}`}
              onClick={() => choose(device.id)}
            >
              <OsMark os={device.os} size={11} />
              <span className="vf-device-filter-name">
                {device.name}
                {device.here ? <i>here</i> : null}
              </span>
              <em>{choiceNote(device)}</em>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
