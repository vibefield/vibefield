// Shared catalog harness chrome: the section frame, the specimen card, the
// brand mark, and the catalog's own icon set. Harness-only UI — production
// components never import from here.
import type { ReactElement, ReactNode } from "react";

export type IconName =
  | "arrow-left"
  | "canvas"
  | "chevron"
  | "close"
  | "command"
  | "document"
  | "folder"
  | "layers"
  | "plus"
  | "settings"
  | "sparkles";

export function BrandMark(): ReactElement {
  return (
    <span className="vf-ds-brand-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function Section({
  id,
  index,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className="vf-ds-section vf-ds-anchor">
      <header className="vf-ds-section-head">
        <span>{index}</span>
        <div>
          <p>{eyebrow}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="vf-ds-section-body">{children}</div>
    </section>
  );
}

export function Specimen({
  title,
  source,
  children,
  bleed = false,
  darkStage = false,
}: {
  title: string;
  source: string;
  children: ReactNode;
  bleed?: boolean;
  darkStage?: boolean;
}): ReactElement {
  return (
    <article
      className={`vf-ds-specimen ${bleed ? "is-bleed" : ""} ${darkStage ? "is-dark-stage" : ""}`}
    >
      <header>
        <span>{title}</span>
        <code>{source}</code>
      </header>
      <div className="vf-ds-specimen-body">{children}</div>
    </article>
  );
}

export function Icon({ name }: { name: IconName }): ReactElement {
  let paths: ReactNode;
  if (name === "arrow-left") paths = <path d="m15 18-6-6 6-6" />;
  else if (name === "canvas") {
    paths = (
      <>
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />
      </>
    );
  } else if (name === "chevron") paths = <path d="m9 7 5 5-5 5" />;
  else if (name === "close") paths = <path d="m7 7 10 10M17 7 7 17" />;
  else if (name === "command") {
    paths = (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m7 10 3 2.5L7 15M12.5 15H17" />
      </>
    );
  } else if (name === "document") {
    paths = (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h5M9 12h6M9 16h6" />
      </>
    );
  } else if (name === "folder") paths = <path d="M3 7.5h7l2-2h9v13H3z" />;
  else if (name === "layers") {
    paths = (
      <>
        <path d="m12 3 9 5-9 5-9-5z" />
        <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
      </>
    );
  } else if (name === "plus") paths = <path d="M12 5v14M5 12h14" />;
  else if (name === "settings") {
    paths = (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
      </>
    );
  } else {
    paths = (
      <>
        <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" />
        <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
      </>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}
