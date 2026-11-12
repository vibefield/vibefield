// Item 345, the seam slice — before a file's rows run, every worker's environment carries the run's own socket alias
// parent (made by global-setup.ts): fieldd booted in-process reads it through boot-env's `socketAliasParent`, and every
// field-native or fieldd a row spawns with `...process.env` (or `runAliasParentEnv()`) inherits it. So no row leaves a
// link in the account's `/tmp/vf-<uid>/`; the global setup's witness counts them. win32 has no aliases.
import { SOCKET_ALIAS_PARENT_ENV } from "@vibefield/contracts";
import { inject } from "vitest";

const parent = inject("socketAliasParent");
if (parent !== "") process.env[SOCKET_ALIAS_PARENT_ENV] = parent;
