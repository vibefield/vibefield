//! Item 345 (PLAN-345-r2) — R2: the socket alias's rows, one for one with `@vibefield/users`'
//! test/socket-alias.test.ts. Every alias lives under a test's own temp parent, never the real `/tmp/vf-<uid>`.
//! RED at S1: all but "fits" (the stub makes nothing and refuses nothing). The two-spellings row is green at S1 and
//! guards the no-fold scope from S2 on (VF-PM 10:54:44Z).
#![cfg(unix)]

use field_native::endpoints::{native_run_dir_for, socket_alias_for};
use field_native::socket_alias::{ensure, ensure_outcome, AliasRefusal};
use std::os::unix::fs::{symlink, DirBuilderExt, MetadataExt, PermissionsExt};
use std::os::unix::net::UnixListener;
use std::path::Path;

/// This process's uid, read off a directory it just made (no `unsafe` for `getuid`).
fn own_uid() -> u32 {
    let probe = tempfile::tempdir().expect("tempdir");
    std::fs::metadata(probe.path()).expect("stat").uid()
}

fn utf8(path: &Path) -> &str {
    path.to_str().expect("a UTF-8 temp path")
}

/// A root whose worst real path is far over 103, so it takes the alias.
fn long_root(base: &Path) -> String {
    utf8(&base.join("x".repeat(80))).to_owned()
}

fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .expect("read_dir")
        .map(|entry| entry.expect("entry").file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn private_dir(path: &Path) {
    std::fs::DirBuilder::new().mode(0o700).create(path).expect("mkdir 0700");
}

#[test]
fn a_root_over_the_line_gets_a_0700_folder_of_ours_and_a_link_to_its_run_dir() {
    let uid = own_uid();
    let (base, parent) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let root = long_root(base.path());
    let dir = ensure(uid, &root, utf8(parent.path())).expect("usable");
    assert_eq!(dir, socket_alias_for(uid, &root, utf8(parent.path())));
    let folder =
        std::fs::symlink_metadata(parent.path().join(format!("vf-{uid}"))).expect("folder");
    assert!(folder.is_dir() && !folder.file_type().is_symlink());
    assert_eq!(folder.mode() & 0o777, 0o700);
    assert!(std::fs::symlink_metadata(&dir).expect("alias").file_type().is_symlink());
    assert_eq!(utf8(&std::fs::read_link(&dir).expect("readlink")), native_run_dir_for(&root));
}

#[test]
fn a_root_that_fits_returns_its_real_run_dir_and_makes_nothing() {
    let parent = tempfile::tempdir().unwrap();
    let dir = ensure(own_uid(), "/tmp/fits", utf8(parent.path())).expect("usable");
    assert_eq!(dir, native_run_dir_for("/tmp/fits"));
    assert!(entries(parent.path()).is_empty());
}

#[test]
fn refuses_a_folder_that_is_a_link() {
    let uid = own_uid();
    let (base, parent, elsewhere) =
        (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    symlink(elsewhere.path(), parent.path().join(format!("vf-{uid}"))).expect("symlink");
    let refusal = ensure(uid, &long_root(base.path()), utf8(parent.path())).expect_err("refused");
    assert!(matches!(refusal, AliasRefusal::FolderIsLink(_)), "{refusal:?}");
}

#[test]
fn refuses_a_folder_another_uid_owns() {
    // the seam names a uid that is not the folder's: the test cannot chown without root
    let uid = own_uid();
    let (base, parent) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    private_dir(&parent.path().join(format!("vf-{}", uid + 1)));
    let refusal =
        ensure(uid + 1, &long_root(base.path()), utf8(parent.path())).expect_err("refused");
    assert!(
        matches!(refusal, AliasRefusal::FolderNotOurs { owner, .. } if owner == uid),
        "{refusal:?}"
    );
}

#[test]
fn refuses_a_folder_open_to_group_or_others() {
    let uid = own_uid();
    let (base, parent) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let folder = parent.path().join(format!("vf-{uid}"));
    std::fs::create_dir(&folder).expect("mkdir");
    std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    let refusal = ensure(uid, &long_root(base.path()), utf8(parent.path())).expect_err("refused");
    assert!(
        matches!(refusal, AliasRefusal::FolderOpen { mode, .. } if mode & 0o077 != 0),
        "{refusal:?}"
    );
}

#[test]
fn refuses_a_file_where_the_alias_belongs() {
    let uid = own_uid();
    let (base, parent) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let root = long_root(base.path());
    private_dir(&parent.path().join(format!("vf-{uid}")));
    std::fs::write(socket_alias_for(uid, &root, utf8(parent.path())), "not a link").expect("write");
    let refusal = ensure(uid, &root, utf8(parent.path())).expect_err("refused");
    assert!(matches!(refusal, AliasRefusal::AliasNotLink(_)), "{refusal:?}");
}

// S2's three rows (VF-PM 12:06Z): the parent's own safety, a non-directory in the folder's place, a socket in the
// alias's place.

#[test]
fn refuses_a_parent_others_may_write_without_the_sticky_bit() {
    let (base, parent) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let open = std::fs::Permissions::from_mode(0o777);
    std::fs::set_permissions(parent.path(), open).expect("chmod");
    let refusal =
        ensure(own_uid(), &long_root(base.path()), utf8(parent.path())).expect_err("refused");
    assert!(
        matches!(&refusal, AliasRefusal::ParentUnsafe { why, .. } if why.contains("sticky")),
        "{refusal:?}"
    );
}

#[test]
fn refuses_a_file_where_the_folder_belongs() {
    let uid = own_uid();
    let (base, parent) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    std::fs::write(parent.path().join(format!("vf-{uid}")), "not a folder").expect("write");
    let refusal = ensure(uid, &long_root(base.path()), utf8(parent.path())).expect_err("refused");
    assert!(matches!(refusal, AliasRefusal::FolderNotDir(_)), "{refusal:?}");
}

#[test]
fn refuses_a_socket_where_the_alias_belongs() {
    let uid = own_uid();
    let (base, parent) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let root = long_root(base.path());
    private_dir(&parent.path().join(format!("vf-{uid}")));
    let alias = socket_alias_for(uid, &root, utf8(parent.path()));
    let _listener = UnixListener::bind(&alias).expect("bind a socket in the alias's place");
    let refusal = ensure(uid, &root, utf8(parent.path())).expect_err("refused");
    assert!(matches!(refusal, AliasRefusal::AliasNotLink(_)), "{refusal:?}");
}

#[test]
fn replaces_an_alias_pointing_elsewhere_by_a_rename_inside_our_folder_removing_nothing_else() {
    let uid = own_uid();
    let (base, parent, elsewhere) =
        (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let root = long_root(base.path());
    let folder = parent.path().join(format!("vf-{uid}"));
    private_dir(&folder);
    std::fs::write(folder.join("neighbour"), "stays").expect("write");
    let alias = socket_alias_for(uid, &root, utf8(parent.path()));
    symlink(elsewhere.path(), &alias).expect("symlink");
    ensure(uid, &root, utf8(parent.path())).expect("usable");
    assert_eq!(utf8(&std::fs::read_link(&alias).expect("readlink")), native_run_dir_for(&root));
    let scope = alias.rsplit('/').next().expect("scope").to_owned();
    let mut want = vec!["neighbour".to_owned(), scope];
    want.sort();
    assert_eq!(entries(&folder), want);
    assert_eq!(entries(parent.path()), vec![format!("vf-{uid}")]);
}

#[test]
fn says_when_it_replaced_a_link_pointing_elsewhere_and_not_when_it_made_or_kept_its_own() {
    let uid = own_uid();
    let (base, parent, elsewhere) =
        (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let root = long_root(base.path());
    let alias = socket_alias_for(uid, &root, utf8(parent.path()));
    let made = ensure_outcome(uid, &root, utf8(parent.path())).expect("usable");
    assert_eq!((made.dir.as_str(), made.replaced), (alias.as_str(), false));
    assert!(!ensure_outcome(uid, &root, utf8(parent.path())).expect("usable").replaced);
    let moved = parent.path().join(format!("vf-{uid}")).join("moved");
    symlink(elsewhere.path(), &moved).expect("symlink");
    std::fs::rename(&moved, &alias).expect("rename over the alias");
    let again = ensure_outcome(uid, &root, utf8(parent.path())).expect("usable");
    assert_eq!((again.dir.as_str(), again.replaced), (alias.as_str(), true));
}

#[test]
fn two_spellings_of_one_root_reach_the_same_socket_through_two_links() {
    let (base, parent) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let lower = base.path().join("x".repeat(80));
    std::fs::create_dir_all(lower.join("native").join("run")).expect("mkdir");
    let upper = base.path().join("X".repeat(80));
    // Meaningful only where the volume folds case (APFS's default): there `upper` names the same folder.
    if !upper.join("native").join("run").exists() {
        return;
    }
    let uid = own_uid();
    let a = ensure(uid, utf8(&lower), utf8(parent.path())).expect("usable");
    let b = ensure(uid, utf8(&upper), utf8(parent.path())).expect("usable");
    assert_ne!(a, b);
    // the same directory by identity, not spelling (a canonical path may keep the case it is given)
    let (at_a, at_b) = (std::fs::metadata(&a).expect("a"), std::fs::metadata(&b).expect("b"));
    assert_eq!((at_a.dev(), at_a.ino()), (at_b.dev(), at_b.ino()));
}

#[test]
fn is_idempotent_a_second_ensure_keeps_the_same_link() {
    let uid = own_uid();
    let (base, parent) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let root = long_root(base.path());
    let first = ensure(uid, &root, utf8(parent.path())).expect("usable");
    assert_eq!(first, socket_alias_for(uid, &root, utf8(parent.path())));
    let inode = std::fs::symlink_metadata(&first).expect("alias").ino();
    assert_eq!(ensure(uid, &root, utf8(parent.path())).expect("usable"), first);
    assert_eq!(std::fs::symlink_metadata(&first).expect("alias").ino(), inode);
}
