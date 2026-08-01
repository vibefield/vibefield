import "@vibecook/ghosttea-electron/bridge-entry";

// The ghosttea bridge's utilityProcess entry, re-exported ONLY so esbuild has a
// file to bundle (its CLI takes paths, not package specifiers). The build emits
// this as ESM at dist/testing/bridge-entry.js, which runSpikeGodview forks.
//
// Bundled rather than copied, and staged rather than forked in place, for the
// reason the reference app records: the entry's imports include
// @vibecook/ghosttea-client, a PRIVATE transitive dependency of
// ghosttea-electron under pnpm. A copy would strand those bare specifiers; a
// bundle inlines them and leaves one self-contained module with no opinion
// about where it sits on disk.
