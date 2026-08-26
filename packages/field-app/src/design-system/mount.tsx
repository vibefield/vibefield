import { createRoot } from "react-dom/client";
import "../tw.css";
import { DesignSystemPage } from "./DesignSystemPage";
import type { DesignSystemStudioController } from "./studio-controller";
import "./design-system.css";

export function mountDesignSystem(
  container: HTMLElement,
  options: { studio?: DesignSystemStudioController } = {},
): void {
  createRoot(container).render(
    <DesignSystemPage {...(options.studio === undefined ? {} : { studio: options.studio })} />,
  );
}

export type { DesignSystemStudioController, DesignSystemStudioState } from "./studio-controller";
