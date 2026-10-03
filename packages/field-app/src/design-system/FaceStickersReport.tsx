import { FieldIcon } from "@vibefield/design-kit/icons";
import { UiIconButton } from "@vibefield/design-kit/primitives";
import { type ReactElement, useEffect, useState } from "react";
import { FaceStickersSection } from "./sections/FaceStickersSection";

export function FaceStickersReport({ archiveUrl }: { archiveUrl: string }): ReactElement {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  return (
    <div className="fc-report">
      <a className="fc-skip" href="#fc-atlas">
        Skip to the 48 faces
      </a>
      <header className="fc-report-bar">
        <a href="#face-stickers" className="fc-report-brand">
          <FieldIcon name="brand-mark" size={38} />
          <span>
            VIBEFIELD <b>/ FACE CLUB</b>
          </span>
        </a>
        <nav aria-label="Face Club sections">
          <a href="#fc-atlas">THE DECK</a>
          <a href="#fc-scale">SIZE PROOF</a>
          <UiIconButton
            aria-label={dark ? "Switch to light wall" : "Switch to dark wall"}
            onClick={() => setDark(!dark)}
          >
            <FieldIcon name={dark ? "sun" : "moon"} size={22} />
          </UiIconButton>
        </nav>
      </header>
      <main>
        <FaceStickersSection standalone archiveUrl={archiveUrl} />
      </main>
    </div>
  );
}
