import { runFilesHost } from "./main";

// FS-1a — `dist/files-host.cjs`'s entry (scripts/files-host-build.mjs): the
// development runtime runs this bundle as fieldd's files worker. The packaged
// single executable reaches the same `runFilesHost` through bin.ts's role
// argument instead.
runFilesHost();
