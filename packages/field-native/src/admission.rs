//! TC-L1f — the machine-wide custody admission ledger (skeleton).
//!
//! **The law (spec §6, normative):** per-vault session caps are subordinate to
//! ONE machine-wide custody budget, `budget = min(configured, kern.tty.ptmx_max
//! − external_headroom)`, admission is atomic across every resident user-pair,
//! and kernel refusal is ALWAYS the final authority. The 511 PTYs this machine
//! has are a SHARED budget — Ghostty and every other terminal draw on the same
//! pool — so the headroom is not politeness, it is the only reason a VibeField
//! at its own cap still leaves the user a terminal to fix it with.
//!
//! **Advisory, and deliberately so.** Nothing here can stop a PTY being made;
//! the kernel decides that. What the ledger buys is a REFUSAL WITH A REASON
//! before the kernel's silent one — TC-D6(e)'s `pty_exhausted` instead of a
//! create that dies as an unclassifiable string (see `resource_pressure`). A
//! ledger that disagrees with the kernel loses, every time, by design.
//!
//! **Liveness, not trust.** A daemon that crashes cannot release its
//! reservation, so every read reaps entries whose pid is gone before it counts
//! anything. Trusting the file's arithmetic would let one crash shrink the
//! machine's budget until someone deleted a JSON file by hand.
//!
//! ## Where the file lives (the ROOT question, answered through the registry)
//!
//! The ledger belongs to the VibeField ROOT and never to a user root — that IS
//! the law: per-vault caps are subordinate to one machine-wide budget, so a
//! per-user ledger would be a budget per vault, which is the thing §6 forbids
//! (`contracts/src/registries.ts` FILES.CUSTODY_ADMISSION_LEDGER says the same).
//!
//! field-native is handed the USER root in `FIELD_NATIVE_DATA_DIR`, so the
//! machine root is derived back out of it — through `registries::layout`, never
//! by respelling a path: `users_file.ts` mints a user root as
//! `join(rootReal, ...LAYOUT.USERS_DIR, String(record.fuid))`, and `fuid` is a
//! positive integer (contracts `users.ts:26`). Stripping exactly that — a
//! numeric leaf under the registry's own `USERS_DIR` segments — inverts the one
//! join that made it. A root that does not match that shape is the CURRENT
//! flat-v1 layout, where the user root and the machine root are the same
//! directory (registries.ts:318-320: UA-1 re-roots the same segments "by
//! changing the ROOT, never the segments"), so it is its own machine root and
//! the ledger still lands in exactly one place per machine.

use crate::registries;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

/// TC-G6's machine-TOTAL envelope, and the `configured` half of §6's formula.
/// One hundred sessions across every user-pair on the machine, not per pair.
pub const DEFAULT_BUDGET: u32 = 100;

/// PTYs reserved for everything that is not VibeField (§6 default, [JAMES]).
/// Ghostty alone is a heavy consumer on this machine; 128 is what keeps a user
/// with a full VibeField from finding they cannot open a terminal at all.
pub const EXTERNAL_HEADROOM: u32 = 128;

/// The §6 formula, pure so it can be tested without a kernel: `min(configured,
/// pool − headroom)`.
///
/// An unreadable pool falls back to `configured` alone rather than to no budget:
/// the configured cap is a number someone chose, and refusing every session
/// because a sysctl did not answer would turn a diagnostic gap into an outage.
/// The caller logs the degradation — an honest state, never a blank.
pub fn budget_for(pool: Option<u32>, configured: u32, headroom: u32) -> u32 {
    match pool {
        Some(pool) => configured.min(pool.saturating_sub(headroom)),
        None => configured,
    }
}

/// The machine root, derived from the user root through `registries::layout`.
///
/// Returns the input unchanged for a flat-v1 root — see the module note. The
/// derivation is pure and total on purpose: there is no path on which this
/// answers "I don't know", so the ledger never has to guess a location or
/// silently pick a per-user one.
pub fn machine_root(user_root: &Path) -> PathBuf {
    let leaf_is_fuid = user_root
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.parse::<u64>().is_ok());
    if !leaf_is_fuid {
        return user_root.to_path_buf();
    }
    let Some(mut candidate) = user_root.parent() else {
        return user_root.to_path_buf();
    };
    // Walk the registry's own segments backwards. Reading them from
    // `registries::layout` rather than writing "users" here is what keeps this
    // inverse tied to the join it inverts (UA-D10: one authority, consumers
    // join and never respell).
    for segment in registries::layout::USERS_DIR.iter().rev() {
        if candidate.file_name().and_then(|name| name.to_str()) != Some(*segment) {
            return user_root.to_path_buf();
        }
        let Some(parent) = candidate.parent() else {
            return user_root.to_path_buf();
        };
        candidate = parent;
    }
    candidate.to_path_buf()
}

/// One daemon's claim on the machine's budget. camelCase on the wire, in the
/// idiom every other VibeField-owned JSON file uses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    pid: u32,
    boot_id: String,
    count: u32,
    /// Tolerant reader: fields a later version adds are carried through a
    /// rewrite untouched. A ledger shared between versions must not lose the
    /// newer one's data every time the older one takes the lock.
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LedgerFile {
    #[serde(default = "one")]
    version: u32,
    #[serde(default)]
    entries: Vec<Entry>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

fn one() -> u32 {
    1
}

impl Default for LedgerFile {
    fn default() -> Self {
        Self {
            version: 1,
            entries: Vec::new(),
            extra: Map::new(),
        }
    }
}

/// What an admission attempt decided.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Admission {
    /// Reserved. `held_here` counts this daemon's claim after the reservation.
    Admitted { held_here: u32, machine_total: u32 },
    /// Refused by the machine budget — TC-D6(e)'s `pty_exhausted`, stated
    /// before the kernel's silent version of the same news.
    Refused {
        budget: u32,
        machine_total: u32,
        requested: u32,
    },
}

impl Admission {
    pub fn is_admitted(&self) -> bool {
        matches!(self, Self::Admitted { .. })
    }
}

/// The flock'd ledger. Cheap to hold: it owns a path, not a file handle — the
/// lock is taken per operation and released with it, so a daemon that stalls
/// mid-operation cannot wedge every other pair on the machine for its lifetime.
#[derive(Debug, Clone)]
pub struct AdmissionLedger {
    path: PathBuf,
    budget: u32,
    pid: u32,
    boot_id: String,
}

impl AdmissionLedger {
    /// Resolve the ledger for this daemon, or `None` when this platform has no
    /// honest way to run one (see `pty_pool_max`).
    ///
    /// `data_dir` is the USER root as handed to field-native; the machine root
    /// is derived from it. Nothing is created here — the file appears on the
    /// first reservation, so a daemon that never creates a session leaves no
    /// trace in a directory shared with every other user-pair.
    #[cfg(unix)]
    pub fn resolve(data_dir: &Path, boot_id: &str) -> Option<Self> {
        let pool = pty_pool_max();
        let budget = budget_for(pool, DEFAULT_BUDGET, EXTERNAL_HEADROOM);
        let path = machine_root(data_dir).join(registries::files::CUSTODY_ADMISSION_LEDGER);
        match pool {
            Some(pool) => tracing::info!(
                event = "field_native.admission.ready",
                component = "admission",
                ledger = %path.display(),
                pty_pool = pool,
                headroom = EXTERNAL_HEADROOM,
                configured = DEFAULT_BUDGET,
                budget,
                "The machine-wide custody budget is set"
            ),
            // Honest degradation, named: the configured cap still applies, and
            // the number the machine could actually serve is unknown to us.
            None => tracing::warn!(
                event = "field_native.admission.pool_unknown",
                component = "admission",
                ledger = %path.display(),
                configured = DEFAULT_BUDGET,
                budget,
                "The machine's PTY pool could not be read; the configured cap is the whole budget"
            ),
        }
        Some(Self {
            path,
            budget,
            pid: std::process::id(),
            boot_id: boot_id.to_string(),
        })
    }

    /// Windows has no `kern.tty.ptmx_max`, no `/proc/sys/kernel/pty/max`, and no
    /// `flock` — ConPTY pseudoconsoles are bounded by the same pool every other
    /// kernel object is, with nothing to read a ceiling from. A budget invented
    /// without a pool to measure it against would be a number pretending to be a
    /// law, so the ledger is honestly absent here and the kernel stays the only
    /// authority. WIN-side admission needs its own evidence first.
    #[cfg(not(unix))]
    pub fn resolve(_data_dir: &Path, _boot_id: &str) -> Option<Self> {
        None
    }

    /// A ledger at an explicit path and budget.
    ///
    /// Production resolves both from the machine (`resolve`); this is the door
    /// for tests, and for the day §6's `configured` half becomes a setting
    /// rather than a constant. It deliberately does NOT consult the PTY pool:
    /// a caller naming a budget has already made that decision.
    pub fn at(path: PathBuf, budget: u32, boot_id: &str) -> Self {
        Self {
            path,
            budget,
            pid: std::process::id(),
            boot_id: boot_id.to_string(),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn budget(&self) -> u32 {
        self.budget
    }

    /// Try to reserve `count` PTYs. Atomic across every process on the machine:
    /// the read, the decision and the write all happen under one exclusive
    /// flock, so two daemons at the boundary cannot both be told yes.
    pub fn try_reserve(&self, count: u32) -> Result<Admission> {
        self.with_locked_ledger(|ledger, held_here| {
            let machine_total: u32 = ledger.entries.iter().map(|entry| entry.count).sum();
            if machine_total.saturating_add(count) > self.budget {
                return Ok(Admission::Refused {
                    budget: self.budget,
                    machine_total,
                    requested: count,
                });
            }
            let held_here = held_here + count;
            Ok(Admission::Admitted {
                held_here,
                machine_total: machine_total + count,
            })
        })
    }

    /// Give `count` back. Called on session end AND on create failure — a
    /// reservation the kernel then refused is a reservation that never became a
    /// PTY, and holding it would shrink the machine's budget by every failure.
    pub fn release(&self, count: u32) -> Result<u32> {
        self.with_locked_ledger(|_, held_here| Ok(held_here.saturating_sub(count)))
    }

    /// Reconcile this daemon's entry to the count it actually holds.
    ///
    /// The self-healing half, and the reason a missed release cannot leak
    /// budget for a LIVE daemon the way a crash cannot leak it for a dead one:
    /// the inventory is truth (spec §10.5), so the ledger is periodically told
    /// what truth is rather than trusted to have counted every event.
    pub fn publish(&self, count: u32) -> Result<u32> {
        self.with_locked_ledger(|_, _| Ok(count))
    }

    /// What the machine holds right now, after reaping the dead. Read-only —
    /// it still takes the lock, because a count read from a half-written file
    /// is not a count.
    pub fn machine_total(&self) -> Result<u32> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&self.path)
            .with_context(|| format!("open {}", self.path.display()))?;
        let _guard = FileLock::exclusive(&file)?;
        let ledger = read_ledger(&self.path)?;
        Ok(reap(ledger).entries.iter().map(|entry| entry.count).sum())
    }

    /// The one read-modify-write path: lock, read, reap, hand the caller this
    /// daemon's current count, write back whatever it decided, unlock.
    ///
    /// The lock is held across the whole of it — that is the atomicity the law
    /// asks for. The closure returns the outcome AND (for the mutating callers)
    /// the new count for this daemon's entry; `try_reserve` maps its own
    /// refusal onto "leave the count alone", so a refused admission writes
    /// nothing but still costs one reap.
    fn with_locked_ledger<T, F>(&self, decide: F) -> Result<T>
    where
        F: FnOnce(&LedgerFile, u32) -> Result<T>,
        T: LedgerOutcome,
    {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&self.path)
            .with_context(|| format!("open {}", self.path.display()))?;
        let _guard = FileLock::exclusive(&file)?;

        let mut ledger = reap(read_ledger(&self.path)?);
        let mine = ledger
            .entries
            .iter()
            .position(|entry| entry.pid == self.pid && entry.boot_id == self.boot_id);
        let held_here = mine.map_or(0, |index| ledger.entries[index].count);

        let outcome = decide(&ledger, held_here)?;
        let Some(new_count) = outcome.new_count(held_here) else {
            return Ok(outcome);
        };
        match mine {
            Some(index) if new_count == 0 => {
                ledger.entries.remove(index);
            }
            Some(index) => ledger.entries[index].count = new_count,
            None if new_count > 0 => ledger.entries.push(Entry {
                pid: self.pid,
                boot_id: self.boot_id.clone(),
                count: new_count,
                extra: Map::new(),
            }),
            None => {}
        }
        write_ledger(&self.path, &ledger)?;
        Ok(outcome)
    }
}

/// How an operation's result decides what to write. Keeps the write policy with
/// the outcome type instead of in a boolean argument nobody can read at the call
/// site.
trait LedgerOutcome {
    /// This daemon's new count, or `None` to write nothing.
    fn new_count(&self, held_here: u32) -> Option<u32>;
}

impl LedgerOutcome for Admission {
    fn new_count(&self, _held_here: u32) -> Option<u32> {
        match self {
            Self::Admitted { held_here, .. } => Some(*held_here),
            // A refusal changed nothing, so it writes nothing — but the reap it
            // rode in on is already discarded with the lock, which is fine: the
            // next mutating call reaps again.
            Self::Refused { .. } => None,
        }
    }
}

impl LedgerOutcome for u32 {
    fn new_count(&self, _held_here: u32) -> Option<u32> {
        Some(*self)
    }
}

/// Drop every entry whose owning process is gone. A crashed daemon cannot
/// release, and an unreaped entry would shrink the machine's budget forever.
fn reap(mut ledger: LedgerFile) -> LedgerFile {
    ledger
        .entries
        .retain(|entry| crate::logging::pid_is_alive(entry.pid));
    ledger
}

/// Tolerant reader: a ledger that will not parse is treated as an empty one
/// rather than as a fatal error. The alternative is a daemon that refuses to
/// serve because a file it shares with other versions of itself has a shape it
/// does not recognise — and the kernel is still the final authority underneath.
fn read_ledger(path: &Path) -> Result<LedgerFile> {
    let body = match std::fs::read_to_string(path) {
        Ok(body) => body,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LedgerFile::default())
        }
        Err(error) => return Err(error).with_context(|| format!("read {}", path.display())),
    };
    if body.trim().is_empty() {
        return Ok(LedgerFile::default());
    }
    match serde_json::from_str(&body) {
        Ok(ledger) => Ok(ledger),
        Err(error) => {
            tracing::warn!(
                event = "field_native.admission.unreadable",
                component = "admission",
                ledger = %path.display(),
                error = %error,
                "The admission ledger could not be parsed and is being rebuilt from live entries"
            );
            Ok(LedgerFile::default())
        }
    }
}

/// Written in place under the lock rather than through a temp-file rename: the
/// rename would swap the inode out from under every other process's flock and
/// turn one exclusive lock into two processes locking different files.
fn write_ledger(path: &Path, ledger: &LedgerFile) -> Result<()> {
    use std::io::{Seek, SeekFrom, Write};

    let body = serde_json::to_vec_pretty(ledger).context("serialize the admission ledger")?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .with_context(|| format!("open {} for write", path.display()))?;
    file.set_len(0)
        .with_context(|| format!("truncate {}", path.display()))?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&body)
        .with_context(|| format!("write {}", path.display()))?;
    file.flush()?;
    Ok(())
}

/// An exclusive `flock` released on drop. Advisory locking is exactly what §6
/// asks for — every VibeField daemon takes it, and nothing outside VibeField is
/// counting PTYs anyway.
#[cfg(unix)]
struct FileLock<'a>(&'a std::fs::File);

#[cfg(unix)]
impl<'a> FileLock<'a> {
    fn exclusive(file: &'a std::fs::File) -> Result<Self> {
        use std::os::unix::io::AsRawFd;
        // SAFETY: the fd is owned by `file`, which outlives this guard.
        let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
        anyhow::ensure!(
            result == 0,
            "lock the admission ledger: {}",
            std::io::Error::last_os_error()
        );
        Ok(Self(file))
    }
}

#[cfg(unix)]
impl Drop for FileLock<'_> {
    fn drop(&mut self) {
        use std::os::unix::io::AsRawFd;
        // SAFETY: the fd is still owned by the file this guard borrows.
        unsafe { libc::flock(self.0.as_raw_fd(), libc::LOCK_UN) };
    }
}

/// Unreachable on win32 — `resolve` answers `None` there, so no ledger exists
/// to lock. It is written as a refusal rather than a silent success because the
/// one thing that must never happen is a ledger that believes it is exclusive
/// while nothing is enforcing it.
#[cfg(not(unix))]
struct FileLock<'a>(#[allow(dead_code)] &'a std::fs::File);

#[cfg(not(unix))]
impl<'a> FileLock<'a> {
    fn exclusive(_file: &'a std::fs::File) -> Result<Self> {
        anyhow::bail!("this platform has no advisory file locking for the admission ledger")
    }
}

/// The machine's PTY ceiling, per platform.
///
/// macOS: `kern.tty.ptmx_max` (511 on this host, the shared 511 the spec cites).
/// Linux: `/proc/sys/kernel/pty/max`.
#[cfg(target_os = "macos")]
pub fn pty_pool_max() -> Option<u32> {
    let mut value: libc::c_int = 0;
    let mut size = std::mem::size_of::<libc::c_int>();
    let name = c"kern.tty.ptmx_max";
    // SAFETY: `name` is a NUL-terminated literal, and the output pointer/size
    // pair describes the `c_int` above; no input buffer is supplied.
    let result = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            (&mut value as *mut libc::c_int).cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    (result == 0 && value > 0).then_some(value as u32)
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn pty_pool_max() -> Option<u32> {
    std::fs::read_to_string("/proc/sys/kernel/pty/max")
        .ok()?
        .trim()
        .parse()
        .ok()
}

#[cfg(not(unix))]
pub fn pty_pool_max() -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn ledger_in(dir: &Path) -> AdmissionLedger {
        AdmissionLedger::at(
            dir.join(registries::files::CUSTODY_ADMISSION_LEDGER),
            10,
            "boot-under-test",
        )
    }

    /// §6's formula, including the shape this machine is actually in: a 511-PTY
    /// pool with 128 reserved leaves 383, so the configured 100 is the binding
    /// half — which is the point of `min`, and the reason a bigger machine does
    /// not silently raise VibeField's own cap.
    #[test]
    fn the_budget_is_the_smaller_of_the_cap_and_what_the_machine_can_spare() {
        assert_eq!(
            budget_for(Some(511), DEFAULT_BUDGET, EXTERNAL_HEADROOM),
            100,
            "511 − 128 = 383, so the configured 100 binds on this host"
        );
        assert_eq!(
            budget_for(Some(200), DEFAULT_BUDGET, EXTERNAL_HEADROOM),
            72,
            "a small pool binds instead, and the headroom comes off the top"
        );
        assert_eq!(
            budget_for(Some(64), DEFAULT_BUDGET, EXTERNAL_HEADROOM),
            0,
            "a pool smaller than the headroom admits nothing — the headroom is for the user's \
             own terminal, and taking it would be VibeField deciding it matters more"
        );
        assert_eq!(
            budget_for(None, DEFAULT_BUDGET, EXTERNAL_HEADROOM),
            DEFAULT_BUDGET,
            "an unreadable pool degrades to the configured cap, never to a refusal of everything"
        );
    }

    /// The ROOT question, answered both ways. The UA-1 shape must strip back to
    /// the machine root; the current flat-v1 shape must be left alone — and a
    /// path that merely LOOKS user-shaped must not be mistaken for one.
    #[test]
    fn the_machine_root_inverts_the_join_that_made_the_user_root() {
        let root = Path::new("/Users/someone/Library/Application Support/VibeField");
        let user_root = root.join(registries::layout::USERS_DIR[0]).join("7");
        assert_eq!(
            machine_root(&user_root),
            root,
            "users/<fuid> is exactly what users-file.ts joined on, so it is what comes off"
        );
        assert_eq!(
            machine_root(root),
            root,
            "a flat-v1 root is its own machine root (registries.ts:318-320)"
        );
        assert_eq!(
            machine_root(&root.join("native")),
            root.join("native"),
            "a non-numeric leaf is not an fuid — fuid is a positive integer (users.ts:26)"
        );
        assert_eq!(
            machine_root(&root.join("docs").join("7")),
            root.join("docs").join("7"),
            "a numeric leaf under some OTHER directory is not a user root, and stripping it \
             would put the machine's ledger somewhere no other pair would look"
        );
    }

    /// The flock'd rows are unix-only DELIBERATELY: on win32 `resolve` answers
    /// `None` (no pool reader, no ledger) and `FileLock::exclusive` refuses
    /// rather than pretend exclusivity. The design the win32 gate witnesses is
    /// that ABSENCE (`this_platform_reports_no_pool_and_resolve_declines`
    /// below), never unix behavior the platform does not have. Found the hard
    /// way: these ran platform-blind and were the box gate's first ten reds.
    #[cfg(unix)]
    #[test]
    fn reserve_and_release_return_exactly_what_was_taken() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ledger = ledger_in(dir.path());

        assert_eq!(
            ledger.try_reserve(3).expect("reserve"),
            Admission::Admitted {
                held_here: 3,
                machine_total: 3
            }
        );
        assert_eq!(
            ledger.try_reserve(2).expect("reserve"),
            Admission::Admitted {
                held_here: 5,
                machine_total: 5
            }
        );
        assert_eq!(ledger.machine_total().expect("total"), 5);

        assert_eq!(ledger.release(2).expect("release"), 3);
        assert_eq!(ledger.machine_total().expect("total"), 3);
        assert_eq!(ledger.release(3).expect("release"), 0);
        assert_eq!(
            ledger.machine_total().expect("total"),
            0,
            "an emptied claim leaves no entry behind to be reaped later"
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_budget_refuses_before_the_kernel_has_to() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ledger = ledger_in(dir.path());
        assert!(ledger.try_reserve(10).expect("reserve").is_admitted());

        let refused = ledger.try_reserve(1).expect("the attempt itself succeeds");
        assert_eq!(
            refused,
            Admission::Refused {
                budget: 10,
                machine_total: 10,
                requested: 1
            },
            "a refusal is an answer with a reason, not an error"
        );
        assert_eq!(
            ledger.machine_total().expect("total"),
            10,
            "and a refused reservation must not have taken any budget"
        );
        assert!(
            ledger.release(1).is_ok(),
            "releasing after a refusal is the create-failure path"
        );
        assert!(ledger.try_reserve(1).expect("reserve").is_admitted());
    }

    /// The crash case: an entry whose daemon is gone must not hold budget. The
    /// dead pid is a real one this test reaped itself, so the liveness probe is
    /// exercised rather than mocked.
    #[cfg(unix)]
    #[test]
    fn a_dead_daemons_entry_never_holds_budget() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ledger = ledger_in(dir.path());

        let dead = std::process::Command::new(if cfg!(windows) { "cmd" } else { "true" })
            .spawn()
            .expect("spawn a process that exits at once");
        let dead_pid = dead.id();
        let mut dead = dead;
        dead.wait().expect("reap the child");

        let stale = LedgerFile {
            version: 1,
            entries: vec![
                Entry {
                    pid: dead_pid,
                    boot_id: "a boot that ended".into(),
                    count: 9,
                    extra: Map::new(),
                },
                Entry {
                    pid: std::process::id(),
                    boot_id: "another live pair".into(),
                    count: 1,
                    extra: Map::new(),
                },
            ],
            extra: Map::new(),
        };
        write_ledger(ledger.path(), &stale).expect("write a stale ledger");

        assert_eq!(
            ledger.machine_total().expect("total"),
            1,
            "the dead daemon's 9 are reaped; the live pair's 1 is not"
        );
        assert!(
            ledger.try_reserve(9).expect("reserve").is_admitted(),
            "and the reaped budget is available again — a crash must not shrink the machine"
        );
    }

    /// Unknown fields survive a rewrite. A ledger shared between versions must
    /// not lose the newer one's data whenever the older one takes the lock.
    #[cfg(unix)]
    #[test]
    fn a_rewrite_carries_through_fields_this_version_does_not_know() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ledger = ledger_in(dir.path());
        std::fs::write(
            ledger.path(),
            serde_json::to_vec_pretty(&serde_json::json!({
                "version": 1,
                "somethingLater": {"kept": true},
                "entries": [{
                    "pid": std::process::id(),
                    "bootId": "another live pair",
                    "count": 1,
                    "vaultId": "v-42"
                }],
            }))
            .expect("serialize"),
        )
        .expect("seed the ledger");

        assert!(ledger.try_reserve(1).expect("reserve").is_admitted());

        let rewritten: Value =
            serde_json::from_str(&std::fs::read_to_string(ledger.path()).expect("read"))
                .expect("parse");
        assert_eq!(rewritten["somethingLater"]["kept"], Value::Bool(true));
        assert_eq!(
            rewritten["entries"][0]["vaultId"],
            Value::String("v-42".into()),
            "an entry's unknown fields belong to whoever wrote them"
        );
    }

    /// A ledger with a shape this version cannot read is rebuilt rather than
    /// fatal — the kernel is still underneath, and refusing to serve over a
    /// malformed JSON file would be the daemon choosing an outage.
    #[cfg(unix)]
    #[test]
    fn an_unreadable_ledger_is_rebuilt_instead_of_fatal() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ledger = ledger_in(dir.path());
        std::fs::write(ledger.path(), b"{not json at all").expect("seed garbage");
        assert!(ledger.try_reserve(1).expect("reserve").is_admitted());
        assert_eq!(ledger.machine_total().expect("total"), 1);
    }

    /// `publish` is the self-healing half: whatever the events said, the
    /// inventory is truth and the ledger is told so.
    #[cfg(unix)]
    #[test]
    fn publishing_the_observed_count_corrects_a_drifted_entry() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ledger = ledger_in(dir.path());
        assert!(ledger.try_reserve(5).expect("reserve").is_admitted());
        assert_eq!(ledger.publish(2).expect("publish"), 2);
        assert_eq!(
            ledger.machine_total().expect("total"),
            2,
            "a missed release cannot leak budget for a daemon that is still alive to correct it"
        );
        assert_eq!(ledger.publish(0).expect("publish"), 0);
        assert_eq!(ledger.machine_total().expect("total"), 0);
    }

    /// The pool reader on the host actually running the test. Not asserted
    /// against a constant — 511 is this machine's number, not every machine's —
    /// but it must answer, and the answer must be a plausible pool.
    #[cfg(unix)]
    #[test]
    fn this_platform_reports_its_pty_pool() {
        let pool = pty_pool_max().expect("a unix host publishes its PTY ceiling");
        assert!(
            pool >= 16,
            "a pool of {pool} would not run a terminal at all; the reader is wrong, not the host"
        );
    }

    /// The win32 half of the platform contract: no pool reader exists, so the
    /// pool is honestly absent and `resolve` declines to build a ledger at all
    /// — admission stays with the kernel until a measured ConPTY-pool probe
    /// gives this platform a vocabulary (a WIN rung; never a guess here).
    #[cfg(not(unix))]
    #[test]
    fn this_platform_reports_no_pool_and_resolve_declines() {
        assert_eq!(pty_pool_max(), None);
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(
            AdmissionLedger::resolve(dir.path(), "boot-under-test").is_none(),
            "no pool means no ledger — the honest absence, never a lock that lies"
        );
    }
}
