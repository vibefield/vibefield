// Item 345, the seam slice — before a file's rows run, the worker's environment carries the run's own socket alias
// parent (alias-parent-global.ts), which the fieldd a row boots in-process reads; win32 has no aliases.
import { SOCKET_ALIAS_PARENT_ENV } from "@vibefield/contracts";
import { inject } from "vitest";

const parent = inject("socketAliasParent");
if (parent !== "") process.env[SOCKET_ALIAS_PARENT_ENV] = parent;
