import "@vibecook/ghosttea-electron/bridge-entry";

// The ghosttea bridge's utilityProcess entry, re-exported ONLY so esbuild has a
// file to bundle (its CLI takes paths, not package specifiers). The build emits
// this as ESM at dist/main/bridge-entry.mjs, which terminal-backend.ts forks.
//
// Bundled rather than copied, and staged rather than forked in place, for the
// reason the reference app records (GT-0 finding 3): the entry's imports include
// @vibecook/ghosttea-client, a PRIVATE transitive dependency of
// ghosttea-electron under pnpm. A copy would strand those bare specifiers; a
// bundle inlines them and leaves one self-contained module with no opinion
// about where it sits on disk.
//
// `.mjs`, not `.js`: the packaged app.asar's manifest deliberately omits `type`
// (scripts/stage-package.mjs), so a `.js` ESM bundle would be parsed as CJS
// there and die at the first `import`. The extension is the only thing that
// pins the module system across both trees.
