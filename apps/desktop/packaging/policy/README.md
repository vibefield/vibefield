# Update policy sources (WP12-D5)

One committed source per channel — `nightly.json`, `beta.json`, `stable.json` — edited by pull request. The release
workflow's sign step (`scripts/release-sign.mjs`) stamps `generatedAt`, `expires` (60 days) and `trustRootVersion`,
signs the result with the trust-root's `release` key, and attaches all three to EVERY release, so a kill switch or a
yank for stable rides the next nightly without a stable re-cut (`docs` → `draft/specs/build-wp12-updater.md` D5).

- Change a body only together with a `version` bump: the sign step refuses a changed body at the same version, and any
  version below the last published one.
- `killSwitch: true` stops every update on that channel until a later policy lifts it.
- `yanked` lists versions no client may install or stay offered.
- `requireUserConfirmation: true` forces the person's explicit yes (the silent apply never runs).
- `floors.os` (and `floors.glibc` on Linux) is the oldest host the newest release runs on; an older host is not offered
  the update. Empty until a release raises the floor on purpose (the packaging config sets no `minimumSystemVersion`).

The shape is `UpdatePolicySource` in `packages/contracts/src/update-policy.ts`.
