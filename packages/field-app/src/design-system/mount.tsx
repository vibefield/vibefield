import { createRoot } from "react-dom/client";
import "../tw.css";
import { DesignSystemPage } from "./DesignSystemPage";
import "./design-system.css";

export function mountDesignSystem(container: HTMLElement): void {
  createRoot(container).render(<DesignSystemPage />);
}
