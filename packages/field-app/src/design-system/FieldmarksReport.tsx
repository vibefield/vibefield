import { FieldIcon } from "@vibefield/design-kit/icons";
import { type ReactElement, useEffect, useState } from "react";
import { IconsSection } from "./sections/IconsSection";
export function FieldmarksReport({ archiveUrl }: { archiveUrl: string }): ReactElement {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  return (
    <div className="ah-report">
      <a className="ah-skip" href="#vf-marks-atlas">
        Skip to the sticker sheet
      </a>
      <header className="ah-report-bar">
        <a href="#fieldmarks" className="ah-report-brand">
          <FieldIcon name="brand-mark" size={44} />
          <span>
            VIBEFIELD <b>/ AFTER HOURS</b>
          </span>
        </a>
        <nav aria-label="Sticker sheet sections">
          <a href="#vf-marks-persona-title">ALTER EGOS</a>
          <a href="#vf-marks-atlas">THE WHOLE PACK ↗</a>
          <button
            type="button"
            onClick={() => setDark((v) => !v)}
            aria-label={dark ? "Switch to light wall" : "Switch to dark wall"}
          >
            <FieldIcon name={dark ? "sun" : "moon"} size={22} />
          </button>
        </nav>
      </header>
      <main>
        <IconsSection standalone archiveUrl={archiveUrl} />
      </main>
    </div>
  );
}
