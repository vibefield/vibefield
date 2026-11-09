import type { ReactElement } from "react";
import type { BloomModel } from "../frame/cards/bloom/bloom-model";
import { CardBloomView } from "../frame/cards/bloom/CardBloomView";

/** A mind map's card let go on a plain shell's pane: four faces, and Live can't land here (OB-D2; §8 "The hand"). */
const MIND_MAP: BloomModel = {
  where: "zsh · Godview",
  hub: "outline",
  onlyFit: null,
  buds: [
    {
      face: "live",
      type: "ref",
      label: "Live",
      verb: "Hand over",
      noun: "the live map",
      lands: false,
      reason: "Nothing in this pane can work on it",
    },
    {
      face: "outline",
      type: "text",
      label: "Outline",
      verb: "Paste",
      noun: "its outline",
      lands: true,
    },
    {
      face: "opml",
      type: "file",
      label: "OPML",
      verb: "Paste",
      noun: "the OPML's path",
      lands: true,
    },
    {
      face: "picture",
      type: "image",
      label: "Picture",
      verb: "Paste",
      noun: "the picture's path",
      lands: true,
    },
  ],
};

const FIELD = { width: 720, height: 440 };
const AT = { x: 360, y: 320 };
const NOTHING = (): void => {};

/** The shipping bloom over a fixture model, standing in its plate and listening to nothing. */
export function CardBloomPlate(): ReactElement {
  return (
    <div
      style={{ position: "relative", height: FIELD.height, overflow: "hidden", borderRadius: 12 }}
    >
      <CardBloomView model={MIND_MAP} at={AT} field={FIELD} choose={NOTHING} still />
    </div>
  );
}
