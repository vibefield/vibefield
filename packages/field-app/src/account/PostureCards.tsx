import { uiLabelClass } from "@vibefield/design-kit";
import type { ReactElement } from "react";
import { POSTURE_CHOICES, type SyncPosture } from "./posture";

/** The sync posture's two cards, one face wherever they are asked (TS-6):
 * Settings → Devices' New projects writes a choice as it is made; the sync
 * question (`frame/SyncQuestionView.tsx`) holds it until its act. The words are
 * `POSTURE_CHOICES`, verbatim (DESIGN.md §9: a name survives its flow). */
export function PostureCards({
  value,
  locked,
  name,
  onChoose,
}: {
  value: SyncPosture;
  /** no live preferences, or a write in flight: the cards cannot be chosen */
  locked: boolean;
  /** the radio group's name, one per surface */
  name: string;
  onChoose: (value: SyncPosture) => void;
}): ReactElement {
  return (
    <div role="radiogroup" aria-label="Sync posture" className="grid gap-2 sm:grid-cols-2">
      {POSTURE_CHOICES.map((card) => {
        const selected = value === card.value;
        return (
          <label
            key={card.value}
            className={`rounded-[14px] border p-3 text-left transition-[background-color,border-color,transform] focus-within:ring-2 focus-within:ring-black/15 dark:focus-within:ring-white/20 ${
              selected
                ? "border-black/25 bg-black/[0.04] dark:border-white/30 dark:bg-white/[0.08]"
                : "border-black/10 hover:bg-black/[0.02] dark:border-white/10 dark:hover:bg-white/[0.04]"
            } ${locked ? "cursor-not-allowed opacity-45" : "cursor-pointer active:scale-[0.99]"}`}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={selected}
              disabled={locked}
              onChange={() => onChoose(card.value)}
            />
            <div className="text-[13px] font-medium leading-5 text-black/80 dark:text-white/80">
              {card.title}
            </div>
            <div className={`mt-0.5 ${uiLabelClass}`}>{card.description}</div>
          </label>
        );
      })}
    </div>
  );
}
