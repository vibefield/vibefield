//! How this daemon puts a secret on disk (EL7). ONE file is in this class since
//! TM-3 deleted MF-2a's mirror-write capability (2026-09-14) — the D8 pairing
//! secret (`pairing.rs`) — and it used to write first and chmod second:
//!
//! ```ignore
//! fs::write(path, bytes)?;              // born at the umask's mode (0644 typically)
//! fs::set_permissions(path, 0o600)?;    // private one syscall later
//! ```
//!
//! Two holes in that one line of daylight. The WINDOW: between the two calls the
//! secret is on disk world-readable, and a same-uid reader (EL7's adversary) or
//! another account on a shared box only has to be looking. The FOLLOW: `write`
//! opens with `O_CREAT|O_TRUNC` and no `O_EXCL`, so a symlink planted at the
//! path is followed — the daemon then writes its secret wherever the link points
//! and chmods THAT file, which is a write primitive handed to whoever planted it.
//!
//! `create_private` closes both: the file is created with `O_EXCL` (never
//! following a link, never truncating something that already exists) and, on
//! unix, born 0600 — the mode is an argument to `open`, so there is no window at
//! all. WIN-D4 holds as it always has: windows has no mode bits to pass, the
//! profile's inherited ACLs carry the other-account boundary, and the same-uid
//! adversary is held out by token discipline rather than by the filesystem.

use std::fs::{File, OpenOptions};
use std::path::Path;

/// Create `path` for writing, PRIVATE from its first byte, refusing to follow a
/// link or to overwrite an existing file. `Err(AlreadyExists)` is the caller's
/// to interpret — for these two files it means another process won the race,
/// and the answer is to read what it wrote rather than to fight for the path.
pub fn create_private(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

// RETIRED 2026-09-14 (TM-3): `harden`, which brought an EXISTING secret file
// back to 0600 on the way in. Its only callers were the mirror-write
// capability's two read-back paths in `config.rs`, and they are deleted with
// the capability. The pairing secret never took this route — it is born 0600
// under `create_private` and read back verbatim — so no file in this daemon is
// re-hardened any more, and none needs to be. Hardening the pairing file on
// read would be a NEW claim (and a new test), not a leftover of this one.

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[cfg(unix)]
    fn mode(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).expect("stat").permissions().mode() & 0o777
    }

    #[cfg(unix)]
    #[test]
    fn a_secret_is_private_from_its_first_byte() {
        // The claim the old write-then-chmod could not make: there is no
        // instant at which the bytes are on disk at a looser mode, because the
        // mode is an argument to open.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("secret");
        let mut file = create_private(&path).expect("create");
        assert_eq!(mode(&path), 0o600, "born private, not chmodded private");
        file.write_all(b"shibboleth").expect("write");
        drop(file);
        assert_eq!(mode(&path), 0o600);
        assert_eq!(std::fs::read_to_string(&path).expect("read"), "shibboleth");
    }

    #[test]
    fn an_existing_file_is_refused_rather_than_truncated() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("secret");
        std::fs::write(&path, "the incumbent").expect("seed");
        let error = create_private(&path).expect_err("must refuse");
        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(
            std::fs::read_to_string(&path).expect("read"),
            "the incumbent",
            "a refused create must not have truncated anything"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_at_the_path_is_never_followed() {
        // The hole this closes: `fs::write` follows a planted link and hands the
        // planter a write primitive — the daemon's own secret, at a path of
        // their choosing, chmodded for good measure.
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("victim");
        std::fs::write(&target, "untouched").expect("seed");
        let link = dir.path().join("secret");
        std::os::unix::fs::symlink(&target, &link).expect("symlink");

        let error = create_private(&link).expect_err("must refuse a link");
        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(
            std::fs::read_to_string(&target).expect("read"),
            "untouched",
            "the link's target must not have been written through"
        );
    }
}
