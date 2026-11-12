//! Item 345: the unix alias's keeper, the twin of `@vibefield/users`' `ensureSocketDir`. Before EVERY bind (and
//! field-native's 60 s re-check), make the directory the endpoint law names usable. A root that fits touches
//! nothing. A root over the line gets `<parent>/vf-<uid>` (a directory, ours, no group or other bits) and its link
//! `<scope>` → the real run dir. A link pointing elsewhere is replaced by a rename from a temp name INSIDE that folder.
//! Nothing else is ever removed, and nothing is cleaned on quit (a crash must leave a floor reachable).

#[derive(Debug, PartialEq, Eq)]
pub enum AliasRefusal {
    FolderIsLink(String),
    FolderNotOurs { path: String, owner: u32 },
    FolderOpen { path: String, mode: u32 },
    AliasNotLink(String),
    Io(String),
}

/// The directory to bind in, or why the alias cannot be used. `uid` is the folder's required owner (the process's
/// own in the product; a test names another to stand for another account's folder).
pub fn ensure(uid: u32, data_root: &str, parent: &str) -> Result<String, AliasRefusal> {
    // S1: today's law, no checks, no link
    Ok(crate::endpoints::unix_socket_dir(uid, data_root, parent))
}
