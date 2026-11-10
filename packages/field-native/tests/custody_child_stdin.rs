//! OB custody (C3) — no child is ever given the floor's stdin (CUSTODY-SPEC §2.4, v0.11; the PM, 2026-11-10).
//!
//! Under `FIELD_NATIVE_CUSTODY=stdin` the floor's fd 0 is the pipe its pairing secret came down, and nothing closes
//! or re-points it once the line is read (`custody.rs`). Rust's `Command`, std's and tokio's over it, hands a child
//! its parent's stdin unless the spawn says otherwise. So the rule is kept where a command is made: every command in
//! this crate's `src` names its child's stdin, and names one that is the child's own.
//!
//! These rows read source and run nothing. Their reach, said once:
//! - Every `.rs` file under `src`: the daemon, the two host binaries, and the unit-test modules beside them. A test
//!   module's child could only be given the test runner's stdin; the rule is kept there all the same, so it needs no
//!   notion of which code is a test's, and no spawn is written the other way for the next one to be copied from.
//! - NOT `tests/`: each file there is a process of cargo's, never the floor.
//! - NOT a spawn inside another crate. Two of the floor's children are made that way, and a person read them at the
//!   pins of 2026-11-10 where no row can: the mesh sidecar (truffle-core 0.7.27, `network/tailscale/sidecar.rs`
//!   440-446: a pipe of its own), and a pane's program (ghosttea 0.14.0, `session.rs` 1423-1446, through
//!   portable-pty 0.9.0, `unix.rs` 228-237: the pty's slave). The second is a CELL's child, not the floor's, and a
//!   cell's own stdin is the floor's pipe to it.
//! - NOT what a `pre_exec` does between the fork and the exec. The crate has one (`supervised_child.rs`, `inherit`);
//!   it places a descriptor at 3 and leaves 0 alone.

use std::path::{Path, PathBuf};

/// How this crate makes a command: std's `Command::new` and tokio's are written the same.
const MADE: &str = "Command::new(";

/// How a command is launched. One that is made here and launched past the next command, or in another file, is not
/// followed: it is refused for that.
const LAUNCHED: &[&str] = &[".spawn()", ".output()", ".status()"];

/// A stdin of the child's own: nothing, a pipe to it, or a file opened for it.
const OWN: &[&str] = &["Stdio::null()", "Stdio::piped()", "Stdio::from("];

/// Ways of making a process that the first row cannot follow to a stdin. None is in this crate. One that arrives is
/// read by a person first, and then these rows are taught it.
const UNREAD: &[&str] = &[
    "CommandBuilder",
    "Command::from(",
    "Command as ",
    "posix_spawn",
    "forkpty",
    "fork(",
    "execv",
    ".exec(",
];

const INHERITED: &str = "names no stdin, so its child is given this process's own";
const UNREADABLE: &str = "names a stdin this row cannot read as the child's own";
const UNFOLLOWED: &str = "is launched where this row cannot follow it";

/// Every Rust file under `dir`, in one order every time.
fn rust_files(dir: &Path, found: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("{}: {error}", dir.display()))
        .map(|entry| entry.expect("a directory entry reads").path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            rust_files(&path, found);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            found.push(path);
        }
    }
}

/// A line of code, or nothing where the line is only a comment: a sentence about a spawn is not one.
fn code_of(line: &str) -> &str {
    if line.trim_start().starts_with("//") {
        ""
    } else {
        line
    }
}

/// This crate's sources, each under the path a person would open. A comment line is blanked, never dropped, so
/// every line keeps its number.
fn sources() -> Vec<(String, String)> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    rust_files(&root.join("src"), &mut files);
    let read = |path: PathBuf| {
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let code: Vec<&str> = text.lines().map(code_of).collect();
        let name = path.strip_prefix(root).expect("under the crate");
        (name.display().to_string(), code.join("\n"))
    };
    files.into_iter().map(read).collect()
}

/// The line `at` is on, as an editor counts lines.
fn line_of(code: &str, at: usize) -> usize {
    code[..at].matches('\n').count() + 1
}

/// What the command made at the head of `made` gives its child for stdin, or why that cannot be said. The command's
/// text runs to its launch; a `.stdin(` there must name one of `OWN` where it stands, so one held in a variable is
/// refused with an `inherit`.
fn stdin_of(made: &str) -> Result<&'static str, &'static str> {
    let rest = &made[MADE.len()..];
    let launches = LAUNCHED.iter().filter_map(|launch| rest.find(*launch));
    let Some(end) = launches.min() else {
        return Err(UNFOLLOWED);
    };
    if rest[..end].contains(MADE) {
        return Err(UNFOLLOWED);
    }
    let mut named = Err(INHERITED);
    for set in rest[..end].split(".stdin(").skip(1) {
        let set = set.trim_start().trim_start_matches("std::process::");
        match OWN.iter().find(|own| set.starts_with(**own)) {
            Some(own) => named = Ok(*own),
            None => return Err(UNREADABLE),
        }
    }
    named
}

/// Every command the crate makes: where, and its child's stdin or why that cannot be said.
fn commands() -> Vec<(String, Result<&'static str, &'static str>)> {
    let mut found = Vec::new();
    for (file, code) in sources() {
        for (at, _) in code.match_indices(MADE) {
            let made = format!("{file}:{}", line_of(&code, at));
            found.push((made, stdin_of(&code[at..])));
        }
    }
    found
}

#[test]
fn every_command_the_crate_makes_names_a_stdin_of_its_childs_own() {
    let wanting: Vec<String> = commands()
        .into_iter()
        .filter_map(|(made, stdin)| stdin.err().map(|why| format!("{made} {why}")))
        .collect();
    assert!(
        wanting.is_empty(),
        "a child could be handed the stdin this process was started with:\n{}",
        wanting.join("\n")
    );
}

/// The row above is only as good as its walk. It must have read the floor's one spawner, the supervised child that
/// every cell and host is started as, and found the pipe that child is given.
#[test]
fn the_walk_reads_the_floors_one_spawner_and_finds_its_pipe() {
    let commands = commands();
    let supervised: Vec<_> = commands
        .iter()
        .filter(|(made, _)| made.contains("supervised_child.rs:"))
        .collect();
    assert_eq!(supervised.len(), 1, "{commands:?}");
    assert_eq!(supervised[0].1, Ok("Stdio::piped()"), "{commands:?}");
}

/// A process made another way would pass the first row unread. None is in the crate.
#[test]
fn nothing_in_the_crate_makes_a_process_another_way() {
    let mut unread = Vec::new();
    for (file, code) in sources() {
        for way in UNREAD {
            for (at, _) in code.match_indices(*way) {
                unread.push(format!("{file}:{} {way}", line_of(&code, at)));
            }
        }
    }
    assert!(
        unread.is_empty(),
        "read these by hand, then teach these rows the way they spawn:\n{}",
        unread.join("\n")
    );
}
