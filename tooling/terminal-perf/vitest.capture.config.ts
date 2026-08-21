import { defineConfig } from "vitest/config";

// The real-cell capture. Serial and long-budgeted: it spawns field-native, boots
// fieldd in-process, and births one real pty session per corpus entry. It is
// vitest-hosted only because `@vibefield/fieldd` exports raw TypeScript
// (`packages/fieldd/package.json` -> `"." : "./src/index.ts"`), so a plain Node
// script could not import `bootstrap` without a second build step; nothing about
// it is a test, and it is never part of `pnpm test` or `pnpm verify`.
export default defineConfig({
  test: {
    include: ["capture/**/*.capture.ts"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 900_000,
    hookTimeout: 300_000,
  },
});
