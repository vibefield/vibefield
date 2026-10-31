# Release notes, written (AU-6)

One file per release that says what is in it by hand: `<X.Y.Z>.txt`, named for the version's core (`0.2.0.txt`), edited
by pull request. The release workflow's sign job reads it (`scripts/release-notes.mjs`), writes the notes INTO
`release-manifest.json` before signing, and the app shows them in Settings → Updates: "What's in VibeField 0.2.0"
before the restart, "What's new" for a day after.

- **A stable refuses to publish without its file.** A beta of the same version (`0.2.0-beta.N`) uses the file when it
  is there; without it, a beta says what a nightly says (the log since the previous beta). A nightly never reads these
  files.
- **The format:**
  - one note per line, at most **8** notes;
  - each note at most **200** characters, on one line;
  - **plain text only**: no Markdown, no HTML, no list markers, no links. The app shows each line as text, exactly as
    written, and never makes a link of it; the one link it shows (the comparison on GitHub) it composes itself;
  - no tabs, control or invisible characters (zero-width, bidi overrides);
  - blank lines and lines starting with `#` are ignored (use them for comments).
- More than 8 notes, a note over 200 characters, or a control or invisible character fails the release before anything
  is signed, naming the line. Markup is not refused: it would show as its own characters (`**bold**` reads as asterisks).

```text
# 0.2.0 — what a person notices
Updates wait for you: VibeField downloads them in the background and installs when you restart or quit.
Settings → Updates says what's in a release before you restart, and what's new after.
Your devices say which version of VibeField each one runs.
```

The shape is `ReleaseNotes` (`kind: "written"`) in `packages/contracts/src/update-policy.ts`; the rule is LC-19 and
EDP §11.1 as amended (AU-D10: no remote markup, signed plain text only).
