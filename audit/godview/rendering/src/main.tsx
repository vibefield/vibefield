import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Harness } from "./Harness";
import "./harness.css";
import "../../../../packages/design-kit/src/tokens.css";
import "../../../../packages/field-app/src/godview/godview.css";
import "../.pin/puppeteer/packages/views/src/styles/views.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing root");
createRoot(root).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
