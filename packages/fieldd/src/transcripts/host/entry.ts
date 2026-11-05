import { runTranscriptHost } from "./main";

// TH-1 — `dist/transcript-host.cjs`'s entry (scripts/transcript-host-build.mjs): the development runtime runs this
// bundle as fieldd's transcript worker. The packaged single executable reaches the same `runTranscriptHost` through
// bin.ts's role argument instead.
runTranscriptHost();
