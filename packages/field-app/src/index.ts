// @vibefield/field-app — the browser-compatible renderer spine (ESR §5.4).
// No Electron, no Node built-ins (wall R1); hosts adapt through FieldHost.
export type { FieldHost } from "./host";
export type {
  RendererLogFields,
  RendererLogger,
  RendererLoggerBindings,
} from "./logging";
export { mountFieldApp } from "./mount";
