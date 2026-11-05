import { defineConfig } from "vitest/config";

// a render is 0.1–0.4 s of CPU; a test that renders a family under a loaded host needs more than vitest's 5 s
export default defineConfig({ test: { testTimeout: 60_000 } });
