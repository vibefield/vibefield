# Security policy

## Reporting a vulnerability

Please report a security problem privately. Don't open a public issue for it.

Use GitHub's private vulnerability reporting: open this repository's **Security** tab and choose
**Report a vulnerability**, or go straight to
<https://github.com/vibefield/vibefield/security/advisories/new>. The report stays private between you and the
maintainers until an advisory is published.

Please include what you can:

- the VibeField version (on the Mac, Settings › Updates shows it), and the Mac or device it runs on, with its
  macOS or iOS version;
- the steps that reproduce the problem;
- what an attacker could do with it, and what they need first (a local account, the same network, a paired device).

## What this policy covers

- VibeField for Mac, as published on this repository's Releases page: the app, its field service (`fieldd`) and its
  native service (`field-native`).
- VibeField for iPhone and iPad, as distributed through the App Store and TestFlight.
- The release pipeline and the update feed: this repository's release workflow, and the signed files it publishes.

A problem in a project VibeField depends on (Electron, Tailscale and the like) belongs to that project first. If it
affects VibeField, please tell us too.

## Fixes

Security fixes ship in a new release on each channel. To get one, update to the newest release of the channel you
use (stable, beta or nightly).
