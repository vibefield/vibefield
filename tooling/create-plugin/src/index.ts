// @vibefield/create-plugin — the §5.4 item 3 scaffolder. The bin is the
// product; these exports exist so the repo's own tests can call the same code
// the CLI calls, never a second implementation of it.
//
// What this package does NOT do is as deliberate as what it does: it consumes
// plugin-build (the manifest emit) and NAMES plugin-cli's commands, but depends
// on neither the checker nor the playground. The scaffolder's job ends when a
// correct plugin exists on disk; proving it correct is `pnpm plugin check`'s job,
// and rendering it is `pnpm playground`'s.

export * from "./cli";
export * from "./plan";
export * from "./refusals";
export * from "./scaffold";
export * from "./template";
export * from "./verdict";
export * from "./workspace";
