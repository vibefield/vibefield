import type { ImportSign, RoomImportSign } from "@vibefield/rosetta-room";
import { type ReactElement, useMemo, useState } from "react";
import { HistoryImportSignView } from "../frame/HistoryImportSign";
import { PeekButtonView } from "../frame/PeekView";
import type { UnreadAgents } from "../frame/unread-agents";
import { HistoryRoomView } from "../history/HistoryRoomView";
import { type ImportSignMoment, importSignPorts } from "./history-fixtures";

// History's import sign, in the catalog (IM-1; DESIGN.md §8 "History", the import's sign; docs/UI_SYSTEM.md): the
// SHIPPING room over the room package's own simulated cold import, stood at one moment, hands its sign out as it does
// in the product (R11), and the SHIPPING circle draws it in the head, one head gap left of the shipping search button,
// its panel open. What this adds is only what a host supplies: the figures fieldd measures beside rosetta's status
// (`history-fixtures.ts`). The markup and the CSS are the product's; the words are the room's.

const noop = (): void => undefined;

/** The window's top under History at one moment of the import, the circle's panel open. */
export function HistoryImportSignPlate({
  moment,
  unread,
}: {
  moment: ImportSignMoment;
  /** HD-7 — the agents not in History the panel lists under the ones it reads (the census's rows, a fixture's) */
  unread?: UnreadAgents | undefined;
}): ReactElement {
  const [ports] = useState(() => importSignPorts(moment));
  const [sign, setSign] = useState<ImportSign | null>(null);
  const importSign = useMemo<RoomImportSign>(() => ({ onSign: setSign }), []);
  return (
    <div className="vf-ds-history-plate" data-state={`import-${moment}`}>
      <HistoryRoomView ports={ports} storage={null} keys="mac" importSign={importSign} />
      {sign !== null && (
        <HistoryImportSignView sign={sign} initiallyOpen onOpenSettings={noop} unread={unread} />
      )}
      <PeekButtonView keys="mac" open={false} onPress={noop} />
    </div>
  );
}
