//! Item 345 (PLAN-345-r2): the unix alias's keeper, the twin of `@vibefield/users`' `ensureSocketDir`, run before
//! EVERY bind (and field-native's 60 s re-check).
//!
//! What it holds: a root over the sun_path line gets ONE short alias, `<parent>/vf-<uid>/<scope>` → its run dir, in a
//! folder this uid owns with mode 0700 exactly, under a parent no other account can swap entries in (root's or this
//! process's, and sticky if others may write it). Every check reads what it finds without following a link (the
//! parent excepted: /tmp is itself a link), and a refusal names what it found. There is no fallback.
//!
//! What it does NOT hold: the alias folder is the uid's own, so a same-uid process can replace a link there, exactly
//! as it can replace a socket in the real run dir today. The alias adds no fence against same-uid code and removes
//! none. What answers on a socket is still judged by the bearer tokens, not by the path (EL7).
//!
//! The refusals' words name the alias's own paths and modes, never the data root or the run dir it points at; they go
//! to the log and the class's `Failed` detail, and nothing of them is drawn for a person.

use std::fmt;
use std::io::ErrorKind;
use std::os::unix::fs::{symlink, DirBuilderExt, MetadataExt, PermissionsExt};
use std::path::Path;

/// Why the alias cannot be used. Each names what was found; none has a fallback.
#[derive(Debug, PartialEq, Eq)]
pub enum AliasRefusal {
    /// the alias parent is not a directory, is another account's, or others may write it without the sticky bit
    ParentUnsafe { path: String, why: String },
    /// `<parent>/vf-<uid>` is a symbolic link
    FolderIsLink(String),
    /// `<parent>/vf-<uid>` is neither a directory nor a link
    FolderNotDir(String),
    /// `<parent>/vf-<uid>` belongs to another uid
    FolderNotOurs { path: String, owner: u32, wanted: u32 },
    /// `<parent>/vf-<uid>`'s mode is not exactly 0700
    FolderOpen { path: String, mode: u32 },
    /// something that is not a link sits where the alias belongs
    AliasNotLink(String),
    /// the filesystem said no
    Io(String),
}

impl fmt::Display for AliasRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ParentUnsafe { path, why } => write!(f, "{path} {why}"),
            Self::FolderIsLink(path) => write!(f, "{path} is a link"),
            Self::FolderNotDir(path) => write!(f, "{path} is not a directory"),
            Self::FolderNotOurs {
                path,
                owner,
                wanted,
            } => write!(f, "{path} belongs to uid {owner}, not {wanted}"),
            Self::FolderOpen { path, mode } => {
                let open = if mode & 0o077 != 0 {
                    " (open to others)"
                } else {
                    ""
                };
                write!(f, "{path} has mode 0{mode:o}, not 0700{open}")
            }
            Self::AliasNotLink(path) => write!(f, "{path} is not a link"),
            Self::Io(what) => write!(f, "{what}"),
        }
    }
}

impl std::error::Error for AliasRefusal {}

/// An io failure's words: `io::Error`'s Display carries no path, so the run dir never rides it.
fn io(path: &str, error: &std::io::Error) -> AliasRefusal {
    AliasRefusal::Io(format!("{path}: {error}"))
}

fn own_uid() -> u32 {
    // SAFETY: getuid takes nothing and cannot fail.
    unsafe { libc::getuid() }
}

/// Step 0.5: the parent is a directory owned by root or by this process, and sticky if others may write it.
fn check_parent(parent: &str) -> Result<(), AliasRefusal> {
    // following, as /tmp is a link to /private/tmp
    let found = std::fs::metadata(parent).map_err(|e| io(parent, &e))?;
    let refused = |why: String| AliasRefusal::ParentUnsafe {
        path: parent.to_owned(),
        why,
    };
    if !found.is_dir() {
        return Err(refused("is not a directory".into()));
    }
    if found.uid() != 0 && found.uid() != own_uid() {
        return Err(refused(format!("belongs to uid {}", found.uid())));
    }
    let mode = found.mode() & 0o7777;
    if mode & 0o022 != 0 && mode & 0o1000 == 0 {
        return Err(refused(format!(
            "is writable by others without the sticky bit (mode 0{mode:o})"
        )));
    }
    Ok(())
}

/// What an ensure found: the directory, and whether a link pointing ELSEWHERE was replaced. That never happens in
/// honest use (the scope is the root's own hash, so one root always wants one target); a caller logs it as one
/// `tracing::warn!` naming the alias's path alone.
#[derive(Debug, PartialEq, Eq)]
pub struct Outcome {
    pub dir: String,
    pub replaced: bool,
}

/// The directory to bind in, or why the alias cannot be used: `ensure_outcome`'s answer without the flag. The floor
/// calls `ensure_outcome` and logs a replacement.
pub fn ensure(uid: u32, data_root: &str, parent: &str) -> Result<String, AliasRefusal> {
    ensure_outcome(uid, data_root, parent).map(|outcome| outcome.dir)
}

/// The ensure itself. `uid` is the folder's required owner (the process's own in the product; a test names another
/// to stand for another account's folder). The order is the list in PLAN-345-r2's S2 read, the same in both twins.
pub fn ensure_outcome(uid: u32, data_root: &str, parent: &str) -> Result<Outcome, AliasRefusal> {
    let kept = |dir: String| Outcome {
        dir,
        replaced: false,
    };
    let target = crate::endpoints::native_run_dir_for(data_root);
    let alias = crate::endpoints::unix_socket_dir(uid, data_root, parent);
    if alias == target {
        return Ok(kept(target)); // 0: a root that fits touches nothing
    }
    check_parent(parent)?; // 0.5
    let folder = format!("{parent}/vf-{uid}");
    match std::fs::symlink_metadata(&folder) {
        // 1: made here, so made 0700 whatever the umask; a racing twin's folder is read by step 2
        Err(e) if e.kind() == ErrorKind::NotFound => {
            match std::fs::DirBuilder::new().mode(0o700).create(&folder) {
                Ok(()) => {
                    let private = std::fs::Permissions::from_mode(0o700);
                    std::fs::set_permissions(&folder, private).map_err(|e| io(&folder, &e))?;
                }
                Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
                Err(e) => return Err(io(&folder, &e)),
            }
        }
        Err(e) => return Err(io(&folder, &e)),
        Ok(_) => {}
    }
    // 2: the folder as FOUND is what is trusted; an existing one is never chmodded
    let found = std::fs::symlink_metadata(&folder).map_err(|e| io(&folder, &e))?;
    if found.file_type().is_symlink() {
        return Err(AliasRefusal::FolderIsLink(folder));
    }
    if !found.is_dir() {
        return Err(AliasRefusal::FolderNotDir(folder));
    }
    if found.uid() != uid {
        return Err(AliasRefusal::FolderNotOurs {
            path: folder,
            owner: found.uid(),
            wanted: uid,
        });
    }
    let mode = found.mode() & 0o7777;
    if mode != 0o700 {
        return Err(AliasRefusal::FolderOpen { path: folder, mode });
    }
    for _ in 0..2 {
        // 3
        match std::fs::symlink_metadata(&alias) {
            Err(e) if e.kind() == ErrorKind::NotFound => match symlink(&target, &alias) {
                Ok(()) => return Ok(kept(alias)),
                // a racing twin made it: read it again, once
                Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(io(&alias, &e)),
            },
            Err(e) => return Err(io(&alias, &e)),
            Ok(link) if !link.file_type().is_symlink() => {
                return Err(AliasRefusal::AliasNotLink(alias));
            }
            Ok(_) => {}
        }
        let points_at = match std::fs::read_link(&alias) {
            Ok(points_at) => points_at,
            // removed since the lstat: read it again, once
            Err(e) if e.kind() == ErrorKind::NotFound => continue,
            Err(e) => return Err(io(&alias, &e)),
        };
        if points_at == Path::new(&target) {
            return Ok(kept(alias));
        }
        // A link pointing elsewhere is replaced by a rename from a temp name inside our own 0700 folder. Nothing is
        // unlinked, here or on quit.
        let scope = &alias[folder.len() + 1..];
        for n in 0..8 {
            let temp = format!("{folder}/.{scope}.{}.{n}", std::process::id());
            match symlink(&target, &temp) {
                Ok(()) => {
                    std::fs::rename(&temp, &alias).map_err(|e| io(&alias, &e))?;
                    return Ok(Outcome {
                        dir: alias,
                        replaced: true,
                    });
                }
                Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(io(&temp, &e)),
            }
        }
        return Err(AliasRefusal::Io(format!(
            "{folder}: no free temp name for the alias's replacement"
        )));
    }
    Err(AliasRefusal::Io(format!("{alias} kept changing while it was made")))
}
