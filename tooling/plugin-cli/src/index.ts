// @vibefield/plugin-cli — the authoring kit's front door (plugin-architecture
// spec §5.4 item 2). The bin is the product; these exports exist so the repo's
// own gen pipeline and tests can call the same code the CLI calls, never a
// second implementation of it.

export * from "./activation-check";
export * from "./artifact-check";
export * from "./check";
export * from "./cli";
export * from "./dev-link";
export * from "./docs-command";
export * from "./docs-generate";
export * from "./inspect";
export * from "./manifest-check";
export * from "./pack-command";
export * from "./plugin-dir";
export * from "./refusals";
export * from "./registry-commands";
export * from "./schema-check";
export * from "./verdict";
export * from "./wall";
