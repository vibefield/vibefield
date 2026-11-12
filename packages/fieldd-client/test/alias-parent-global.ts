// Item 345, the seam slice — client.test.ts boots fieldd in-process (`bootstrap` from @vibefield/fieldd), so the run
// gives the socket alias a parent of its own (`/tmp/vfa-XXXXXX`, shared with fieldd's suite through
// scripts/run-alias-parent.mjs); `alias-parent-env.ts` puts it in each worker's environment, and the teardown removes
// it and fails the run, in counts alone, if the run left a link in the account's `/tmp/vf-<uid>/`.
import type { TestProject } from "vitest/node";
import { setupRunAliasParent } from "../../../scripts/run-alias-parent.mjs";

declare module "vitest" {
  export interface ProvidedContext {
    /** Item 345: the run's own socket alias parent ("" on win32, whose endpoints are pipes). */
    socketAliasParent: string;
  }
}

export function setup(project: TestProject): () => void {
  return setupRunAliasParent(
    (parent) => project.provide("socketAliasParent", parent),
    "fieldd-client run",
  );
}
