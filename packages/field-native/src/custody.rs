//! OB custody (C3, EL7) — the floor's pairing secret, HANDED by the process that spawned it.
//!
//! At `files` (every dev run, test and smoke, and what every floor was until this) the floor makes the D8 pairing
//! secret itself and keeps it in the 0600 `native/pairing`, where fieldd reads it. Every other process of the same
//! user can read it there too, and its holder supersedes fieldd and holds every `native.*` row.
//!
//! At `sealed` nothing secret is on disk. fieldd spawns the floor with `FIELD_NATIVE_CUSTODY=stdin` (a flag, never a
//! secret) and a piped stdin, writes ONE line, a `NativeBootstrap`, and closes it. The floor reads to the first
//! newline, checks the version, and holds the secret where the file's was held (`DaemonState.secret`, and the byte
//! plane's copy). It never makes, reads or removes `native/pairing`. Only where the secret comes from moves: the D8
//! handshake, its vector and `meshdata.sock` are as they were.
//!
//! THE FLAG IS THE SPAWNER'S WORD, NEVER THE DISK'S. With the flag set, a line that is absent, late, too long or not a
//! bootstrap this floor reads is a refusal to boot: `bootstrap` returns the `Refused`, main says it once
//! (`field_native.lifecycle.bootstrap_failed`) and the process exits non-zero. It is never a fall back to the file: a
//! floor that fell back would be downgraded by anyone who could make its line late.
//!
//! NOTHING OF THE LINE IS EVER SAID. A `Refused` carries a reason and no byte of what was read; the parse error's
//! class is kept and its words are dropped, because serde quotes the value it could not read, and a line that almost
//! parses holds a secret. The generated secret type derives `Debug`: nothing here formats it or anything holding it.
//!
//! THE SECRET REACHES NO CHILD. This process's stdin has one reader, the thread below, and no child inherits it: the
//! floor's own children (the cells and the freeway host, `supervised_child.rs`) and truffle's sidecar are each spawned
//! with a piped stdin, stdout and stderr of their own. Nothing of the line is put in an environment or an argv.
//!
//! The read is on a std thread, never the runtime's blocking pool (`leash.rs` has the reason: tokio's stdin is a read
//! the runtime's drop waits for). A floor that gives up at its wait leaves that thread parked on a stdin nobody
//! writes, and the process exits all the same.

use crate::contracts::NativeBootstrap;
use crate::registries::custody as registry;
use serde_json::error::Category;
use std::io::BufRead;
use std::time::Duration;
use tokio::sync::oneshot;

/// What the flag's value asks, as a pure function of it, so the reading has a witness without the process
/// environment (which every test in a binary shares). `stdin` exactly, the registry's one value: unset, empty or
/// anything else is `files`, today's file.
pub fn stdin_requested(value: Option<&str>) -> bool {
    value == Some(registry::STDIN)
}

/// Why a bootstrap line was refused. It names no byte of the line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refused {
    /// stdin ended, or its read failed, before a whole line came (a line ends with its newline)
    Absent,
    /// no whole line within the wait
    Late,
    /// no newline within the bound
    TooLong,
    /// not a `NativeBootstrap`: the parse error's class, never its words
    Unparsed(Category),
    /// a `NativeBootstrap` of a version this floor does not read
    Version,
}

impl Refused {
    /// The refusal's one word, as the log line carries it.
    pub fn reason(self) -> &'static str {
        match self {
            Self::Absent => "bootstrap-absent",
            Self::Late => "bootstrap-late",
            Self::TooLong => "bootstrap-too-long",
            Self::Unparsed(_) => "bootstrap-unparsed",
            Self::Version => "bootstrap-version",
        }
    }
}

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let why = match self {
            Self::Absent => "stdin ended before a whole line came",
            Self::Late => "no line came within the wait",
            Self::TooLong => "the line is longer than the bound",
            Self::Unparsed(Category::Io) => "the line could not be read",
            Self::Unparsed(Category::Syntax | Category::Eof) => "the line is not JSON",
            Self::Unparsed(Category::Data) => "the line is not a bootstrap",
            Self::Version => "the line is of a version this floor does not read",
        };
        write!(
            f,
            "custody: the floor was told its pairing comes on stdin, and {why} ({}); it does not start, and it \
             never falls back to the pairing file",
            self.reason()
        )
    }
}

impl std::error::Error for Refused {}

/// This floor's pairing secret, from the bootstrap line on its own stdin, within the registry's bounds. Called once,
/// at boot, only under the flag: it is stdin's one reader.
pub async fn handed_pairing() -> Result<[u8; 32], Refused> {
    read_bootstrap(
        || std::io::stdin().lock(),
        registry::HANDOFF_MAX_BYTES as usize,
        Duration::from_millis(registry::HANDOFF_WAIT_MS),
    )
    .await
}

/// The pairing secret of the bootstrap line `open`'s reader gives: its first line, which is at most `max_bytes` long
/// with its newline and comes within `wait`. `open` runs on the reading thread, so a reader that cannot cross
/// threads (stdin's lock) never has to. Public for the rows that drive the bounds on a reader of their own.
pub async fn read_bootstrap<R, F>(
    open: F,
    max_bytes: usize,
    wait: Duration,
) -> Result<[u8; 32], Refused>
where
    R: BufRead + 'static,
    F: FnOnce() -> R + Send + 'static,
{
    let (sender, line) = oneshot::channel();
    let started = std::thread::Builder::new()
        .name("field-native-custody".to_owned())
        .spawn(move || {
            // The send fails only when the boot has stopped waiting: the line is then dropped, unread.
            let _ = sender.send(read_line(open(), max_bytes));
        });
    if started.is_err() {
        return Err(Refused::Absent);
    }
    match tokio::time::timeout(wait, line).await {
        Ok(Ok(line)) => parse(&line?),
        // the thread ended without an answer
        Ok(Err(_)) => Err(Refused::Absent),
        Err(_) => Err(Refused::Late),
    }
}

/// The reader's first line, its newline included, read no further than `max_bytes`.
fn read_line(reader: impl BufRead, max_bytes: usize) -> Result<Vec<u8>, Refused> {
    let mut line = Vec::new();
    let read = reader.take(max_bytes as u64).read_until(b'\n', &mut line);
    match read {
        Ok(_) if line.last() == Some(&b'\n') => Ok(line),
        Ok(read) if read >= max_bytes => Err(Refused::TooLong),
        _ => Err(Refused::Absent),
    }
}

fn parse(line: &[u8]) -> Result<[u8; 32], Refused> {
    let bootstrap: NativeBootstrap =
        serde_json::from_slice(line).map_err(|error| Refused::Unparsed(error.classify()))?;
    // The generated twin holds `v` to a whole number above zero; that it is 1 is this floor's to check.
    if bootstrap.v.get() != 1 {
        return Err(Refused::Version);
    }
    // The contract's pattern already holds the secret to 64 lowercase hex characters. The same check again, so the
    // 32 bytes never rest on the generator alone.
    let secret = hex::decode(bootstrap.pairing.as_str()).map_err(no_secret)?;
    secret.try_into().map_err(no_secret)
}

/// A secret of another shape is a line that is no bootstrap, whatever its decoder said of it.
fn no_secret<E>(_: E) -> Refused {
    Refused::Unparsed(Category::Data)
}
