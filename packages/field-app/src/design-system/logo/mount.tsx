import { createRoot } from "react-dom/client";
import "@vibefield/design-kit/tokens.css";
import { LogoStudio } from "./LogoStudio";

export function mountLogoStudio(container: HTMLElement): void {
  createRoot(container).render(<LogoStudio />);
}
