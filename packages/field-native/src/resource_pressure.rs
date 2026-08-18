//! TC-D6(b)/(e) — telling one refusal from another, and saying so honestly.
//!
//! Two jobs live here, and they are deliberately separate from the units that
//! use them: CLASSIFYING a create refusal (fd exhaustion is not a missing
//! shell, and a user reading "failed to spawn PTY command" learns neither), and
//! GAUGING descriptor pressure so the terminal unit can report `degraded`
//! before the kernel starts refusing rather than after.
//!
//! ## What is classifiable today, and what is not (the honest boundary)
//!
//! field-native does not own the product create path. `fieldd` dials ghosttea's
//! control socket directly (`packages/fieldd/src/terminal-service.ts`), the
//! service spawns the PTY in-process, and a failure comes back as a wire string
//! — `ResponseBody::Error { message: error.to_string() }` (ghosttea 0.9.3
//! service.rs:2960-2965). `anyhow`'s `to_string()` renders the TOP context only,
//! never the chain, and that single choice decides what any reader downstream
//! can know:
//!
//! - **openpty refusals keep their errno.** portable-pty 0.9.0 unix.rs:46 bails
//!   with `"failed to openpty: {:?}"` of `io::Error::last_os_error()`, and
//!   ghosttea propagates it with a bare `?` (session.rs:1167), so the debug form
//!   — `Os { code: 24, … }` — survives to the wire intact. `classify_wire_message`
//!   reads that code, which is why fd exhaustion IS diagnosable.
//! - **spawn refusals do not.** ghosttea contexts the spawn with
//!   `.context("failed to spawn PTY command")` (session.rs:1179-1182), so
//!   `to_string()` yields exactly that phrase and the errno underneath — ENOENT
//!   for a missing shell, EMFILE for descriptors — is GONE before it reaches any
//!   socket. This is the literal sentence TC-D6(b) names, and no reader can undo
//!   it from outside the process. Closing it needs upstream (`{error:#}`, or a
//!   structured code on the error response) or the create seam moving in-tree.
//!
//! So the ENOENT arm is answered where it still CAN be: `terminal_client`
//! pre-flights the executable before the request, on this side of the
//! flattening. The kernel stays the final authority — a pre-flight that passes
//! changes nothing, and the service's own refusal is still what decides.
//!
//! ## Which state name goes on which refusal
//!
//! `pty_exhausted` is emitted by the ADMISSION LEDGER (`crate::admission`),
//! which knows the machine-wide PTY budget, and deliberately NOT by an errno
//! guess here. macOS's `openpty` refusal when the 511-slot `kern.tty.ptmx_max`
//! pool dries is not something this repo has observed — drying a pool shared
//! with every other terminal on the machine is not a test anyone may run — and a
//! mapping nobody has seen fail is a guess wearing a classifier's clothes. What
//! IS proven is EMFILE under a low `RLIMIT_NOFILE`, which is what this maps.

use std::io;

/// TC-D6(e) resource-pressure states. **The spelling authority is
/// `packages/contracts/src/registries.ts`'s `RESOURCE_PRESSURE_STATES` in
/// `contracts/src/mgmt.ts`** — these strings are a contract shared with the
/// readers that match on them, not a local label, and they reach a
/// `UnitHealth.detail` and an `UnavailableDetails.state` unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PressureClass {
    /// Descriptors are the scarce resource: EMFILE (this process) or ENFILE
    /// (the machine's file table).
    FdPressure,
    /// The machine-wide PTY budget is spent. Emitted by the admission ledger,
    /// which is the only thing that knows the budget.
    PtyExhausted,
}

impl PressureClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FdPressure => "fd_pressure",
            Self::PtyExhausted => "pty_exhausted",
        }
    }
}

/// What one create refusal MEANS, once classified.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreateRefusal {
    /// RESOURCE_EXHAUSTED class: a resource ceiling, not a caller mistake.
    /// Retryable once something frees up, and the named class is what a health
    /// surface and a UI both key on.
    ResourceExhausted {
        class: PressureClass,
        message: String,
    },
    /// NOT_FOUND class: the thing asked for does not exist. Retrying is
    /// pointless; the caller has to change what it asked for.
    NotFound { message: String },
    /// Everything else, carried through verbatim. A tolerant reader does not
    /// invent a class for a refusal it does not recognise — and, per the module
    /// note, the flattened spawn refusal genuinely lands here.
    Unclassified { message: String },
}

impl CreateRefusal {
    /// The pressure class this refusal should put on the unit's health, if any.
    pub fn pressure(&self) -> Option<PressureClass> {
        match self {
            Self::ResourceExhausted { class, .. } => Some(*class),
            _ => None,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Self::ResourceExhausted { message, .. }
            | Self::NotFound { message }
            | Self::Unclassified { message } => message,
        }
    }
}

/// The proven errno map. EMFILE is this process's descriptor limit; ENFILE is
/// the machine's file table — different scopes, same honest answer to the user,
/// and the same lever (TC-D6(a)'s raise) covers the first.
pub fn classify_errno(code: i32) -> Option<PressureClass> {
    #[cfg(unix)]
    {
        if code == libc::EMFILE || code == libc::ENFILE {
            return Some(PressureClass::FdPressure);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = code;
    }
    None
}

/// Is this errno a missing path? Kept beside the pressure map so the two
/// answers to "why did the create fail" stay in one place.
pub fn is_not_found(code: i32) -> bool {
    #[cfg(unix)]
    {
        code == libc::ENOENT
    }
    #[cfg(not(unix))]
    {
        let _ = code;
        false
    }
}

/// Classify an `io::Error` this process raised itself — the in-process path,
/// where the errno is still attached and nothing has been stringified.
pub fn classify_io_error(error: &io::Error) -> Option<PressureClass> {
    error.raw_os_error().and_then(classify_errno)
}

/// Classify a refusal that crossed the control wire.
///
/// Best-effort BY CONSTRUCTION, and the module note says why: the errno is
/// present for openpty refusals and absent for spawn refusals, so this reads the
/// debug form portable-pty emits (`Os { code: 24, … }`) and answers
/// `Unclassified` for anything else rather than guessing from prose. Matching on
/// English message text would be the guess — the code is the fact.
pub fn classify_wire_message(message: &str) -> CreateRefusal {
    let Some(code) = os_error_code(message) else {
        return CreateRefusal::Unclassified {
            message: message.to_string(),
        };
    };
    if let Some(class) = classify_errno(code) {
        return CreateRefusal::ResourceExhausted {
            class,
            message: format!(
                "the terminal floor is out of file descriptors ({}); no new session can be \
                 created until sessions end: {message}",
                class.as_str()
            ),
        };
    }
    if is_not_found(code) {
        return CreateRefusal::NotFound {
            message: message.to_string(),
        };
    }
    CreateRefusal::Unclassified {
        message: message.to_string(),
    }
}

/// Pull `N` out of an `io::Error` debug rendering (`Os { code: N, kind: …`).
/// Deliberately anchored on `Os {` so a session id or a path that happens to
/// contain "code:" cannot be read as an errno.
fn os_error_code(message: &str) -> Option<i32> {
    let rest = message.split("Os {").nth(1)?;
    let digits = rest.split("code:").nth(1)?.trim_start();
    let end = digits
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(digits.len());
    digits[..end].parse().ok()
}

/// The high-water mark: past 80% of the soft limit the terminal unit reports
/// `degraded`. Chosen against the measured cost — at 5 fds per session, 20%
/// headroom on a raised 8192 is ~327 sessions of slack, so this fires as a
/// warning long before it fires as a refusal.
pub const HIGH_WATER_PERCENT: u64 = 80;
/// Recovery is a LOWER mark than the alarm on purpose: with one threshold a
/// daemon hovering at the boundary would publish a health transition per
/// sample, and a health surface that flaps is one nobody reads.
pub const LOW_WATER_PERCENT: u64 = 70;

/// The hysteresis state machine for descriptor pressure. Holds one bool, and
/// answers only when the answer CHANGES — a caller can sample as often as it
/// likes without waking a subscriber.
#[derive(Debug, Default)]
pub struct FdPressureGauge {
    under_pressure: bool,
}

impl FdPressureGauge {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn under_pressure(&self) -> bool {
        self.under_pressure
    }

    /// Observe one sample. `Some(true)` = pressure just began, `Some(false)` =
    /// it just cleared, `None` = no transition to report.
    ///
    /// An unknown limit (`0`) reports nothing rather than dividing by it: a
    /// daemon that cannot read its own limit knows nothing about pressure, and
    /// claiming either state would be an invention.
    pub fn observe(&mut self, open: u64, limit: u64) -> Option<bool> {
        if limit == 0 {
            return None;
        }
        // Integer arithmetic on purpose: a percentage of a descriptor count is
        // exact, and a float threshold would put the transition point on
        // rounding rather than on the number the comment states.
        let high = limit.saturating_mul(HIGH_WATER_PERCENT) / 100;
        let low = limit.saturating_mul(LOW_WATER_PERCENT) / 100;
        match (self.under_pressure, open) {
            (false, open) if open >= high => {
                self.under_pressure = true;
                Some(true)
            }
            (true, open) if open <= low => {
                self.under_pressure = false;
                Some(false)
            }
            _ => None,
        }
    }

    /// Force the gauge into pressure because the kernel just refused a create.
    /// A refusal is stronger evidence than any sample — the sampler runs on an
    /// interval and the refusal happened NOW — so this reports a transition
    /// whenever it changes the state, and the next sample below the low-water
    /// mark clears it through the ordinary path.
    pub fn refused(&mut self) -> Option<bool> {
        (!std::mem::replace(&mut self.under_pressure, true)).then_some(true)
    }
}

/// How many descriptors this process currently holds.
///
/// `/dev/fd` on macOS and `/proc/self/fd` on Linux both enumerate exactly the
/// calling process's open descriptors, which is the number the limit applies to.
/// Reading the directory costs one descriptor of its own; that is included
/// rather than corrected for, because the sample is compared against a
/// percentage and being one high is the safe direction to be wrong in.
#[cfg(unix)]
pub fn open_fd_count() -> Option<u64> {
    #[cfg(target_os = "macos")]
    const FD_DIR: &str = "/dev/fd";
    #[cfg(not(target_os = "macos"))]
    const FD_DIR: &str = "/proc/self/fd";

    let entries = std::fs::read_dir(FD_DIR).ok()?;
    Some(entries.filter(|entry| entry.is_ok()).count() as u64)
}

/// The current soft descriptor limit — the ceiling the sample is measured
/// against, re-read per sample rather than cached, because TC-D6(a)'s raise and
/// any operator change both move it under a running daemon.
#[cfg(unix)]
pub fn soft_fd_limit() -> Option<u64> {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: `getrlimit` writes one fully-owned `rlimit` through this pointer.
    (unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) } == 0).then_some(limit.rlim_cur)
}

/// Windows bounds handles by pool rather than by a per-process descriptor limit
/// there is any way to sample, so the gauge has no honest input to read. The
/// unit reports no fd-pressure state there rather than a made-up one — the
/// admission ledger's PTY budget is the portable half of TC-D6(e).
#[cfg(not(unix))]
pub fn open_fd_count() -> Option<u64> {
    None
}

#[cfg(not(unix))]
pub fn soft_fd_limit() -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The contract spellings, asserted as literals. These strings cross a
    /// seam — a reader matches on them — so a rename must break a test here and
    /// not a dashboard in production.
    #[test]
    fn the_state_names_are_the_contract_spellings() {
        assert_eq!(PressureClass::FdPressure.as_str(), "fd_pressure");
        assert_eq!(PressureClass::PtyExhausted.as_str(), "pty_exhausted");
    }

    /// Synthetic errors, never a dried resource: the classifier's whole input is
    /// an errno, so an `io::Error::from_raw_os_error` exercises it exactly as a
    /// real refusal would — and drying the machine's descriptor or PTY pools to
    /// prove it would take every other process on a shared machine down with it.
    #[test]
    fn fd_exhaustion_is_told_apart_from_a_missing_shell() {
        #[cfg(unix)]
        {
            let emfile = io::Error::from_raw_os_error(libc::EMFILE);
            assert_eq!(
                classify_io_error(&emfile),
                Some(PressureClass::FdPressure),
                "EMFILE is this process's own descriptor ceiling"
            );
            let enfile = io::Error::from_raw_os_error(libc::ENFILE);
            assert_eq!(
                classify_io_error(&enfile),
                Some(PressureClass::FdPressure),
                "ENFILE is the machine's file table — a different scope, the same honest answer"
            );
            let enoent = io::Error::from_raw_os_error(libc::ENOENT);
            assert_eq!(
                classify_io_error(&enoent),
                None,
                "a missing shell is not resource pressure, and treating it as one would send a \
                 user hunting for a leak that is not there"
            );
            assert!(is_not_found(libc::ENOENT));
            assert!(!is_not_found(libc::EMFILE));
        }
    }

    /// The wire form portable-pty actually produces, byte for byte from
    /// unix.rs:46 (`bail!("failed to openpty: {:?}", …)`) as ghosttea's
    /// `to_string()` hands it over. Unix-gated: `classify_errno` maps through
    /// THIS platform's table, and 24 is only EMFILE where libc says so.
    #[cfg(unix)]
    #[test]
    fn an_openpty_refusal_keeps_its_errno_across_the_wire_on_unix() {
        let refusal = classify_wire_message(
            "terminal control error: failed to openpty: Os { code: 24, kind: Uncategorized, \
             message: \"Too many open files\" }",
        );
        let CreateRefusal::ResourceExhausted { class, message } = &refusal else {
            panic!("EMFILE from openpty is a resource refusal, got {refusal:?}");
        };
        assert_eq!(*class, PressureClass::FdPressure);
        assert!(
            message.contains("fd_pressure"),
            "the refusal names the state a reader keys on: {message}"
        );
        assert!(
            message.contains("out of file descriptors"),
            "and says it in words a person can act on: {message}"
        );
    }

    /// The win32 dual: 24 is a UNIX errno, not a fact of this platform, and
    /// the classifier refuses to pretend. What ConPTY exhaustion actually
    /// renders on the wire is UNMEASURED — until a WIN-rung probe pins it,
    /// Unclassified is the honest answer, and this row is what keeps a future
    /// "just match the string" shortcut from shipping as a guess.
    #[cfg(not(unix))]
    #[test]
    fn a_unix_errno_shape_is_not_pretended_into_pressure() {
        let refusal = classify_wire_message(
            "terminal control error: failed to openpty: Os { code: 24, kind: Uncategorized, \
             message: \"Too many open files\" }",
        );
        assert!(
            matches!(refusal, CreateRefusal::Unclassified { .. }),
            "a unix errno classified on win32 would be a guess dressed as a fact: {refusal:?}"
        );
    }

    /// The named upstream limit, pinned as a test so it cannot quietly stop
    /// being true: ghosttea flattens the spawn error to its top context, so this
    /// message carries no errno and this classifier must not pretend otherwise.
    /// When upstream renders the chain, this test is what fails and tells the
    /// next person the boundary moved.
    #[test]
    fn the_flattened_spawn_refusal_is_honestly_unclassified() {
        let refusal = classify_wire_message("terminal control error: failed to spawn PTY command");
        assert_eq!(
            refusal,
            CreateRefusal::Unclassified {
                message: "terminal control error: failed to spawn PTY command".into()
            },
            "ghosttea 0.9.3 renders only the top context (service.rs:2960-2965), so ENOENT and \
             EMFILE are indistinguishable HERE — the pre-flight in terminal_client is what \
             answers the missing-shell half on this side of the flattening"
        );
        assert_eq!(refusal.pressure(), None);
    }

    /// A number that is not an errno must not become one.
    #[test]
    fn only_a_real_os_code_is_read_as_one() {
        assert_eq!(os_error_code("no code here"), None);
        assert_eq!(
            os_error_code("session code: 24 was refused"),
            None,
            "the anchor is `Os {{`, so prose carrying `code:` is not an errno"
        );
        assert_eq!(os_error_code("Os { code: 2, kind: NotFound }"), Some(2));
    }

    /// What the extracted code MEANS is platform-tabled: 2 is ENOENT where
    /// libc says so, and NotFound classification follows only there.
    #[cfg(unix)]
    #[test]
    fn an_extracted_enoent_classifies_not_found() {
        assert_eq!(
            classify_wire_message("Os { code: 2, kind: NotFound, message: \"No such file\" }"),
            CreateRefusal::NotFound {
                message: "Os { code: 2, kind: NotFound, message: \"No such file\" }".into()
            }
        );
    }

    /// The same digits on win32 stay Unclassified — `is_not_found` reads the
    /// LOCAL platform's table, and this platform has no claim on unix errnos.
    #[cfg(not(unix))]
    #[test]
    fn an_extracted_enoent_stays_unclassified_here() {
        assert!(matches!(
            classify_wire_message("Os { code: 2, kind: NotFound, message: \"No such file\" }"),
            CreateRefusal::Unclassified { .. }
        ));
    }

    /// Both directions, and the flap the two thresholds exist to prevent.
    #[test]
    fn descriptor_pressure_arrives_late_and_leaves_later() {
        let mut gauge = FdPressureGauge::new();
        assert_eq!(gauge.observe(100, 1000), None, "10% is not pressure");
        assert_eq!(
            gauge.observe(799, 1000),
            None,
            "79.9% is still under the mark"
        );
        assert_eq!(gauge.observe(800, 1000), Some(true), "80% is the mark");
        assert_eq!(
            gauge.observe(900, 1000),
            None,
            "already degraded — a worse sample is not a new transition"
        );
        assert_eq!(
            gauge.observe(750, 1000),
            None,
            "75% is below the alarm and above recovery: the hysteresis band, where a \
             single-threshold gauge would flap"
        );
        assert_eq!(gauge.observe(700, 1000), Some(false), "70% clears it");
        assert!(!gauge.under_pressure());
        assert_eq!(gauge.observe(700, 1000), None, "and stays cleared");
    }

    #[test]
    fn a_refusal_degrades_immediately_and_the_sampler_still_clears_it() {
        let mut gauge = FdPressureGauge::new();
        assert_eq!(
            gauge.refused(),
            Some(true),
            "a kernel refusal is news the interval sampler has not caught up with yet"
        );
        assert_eq!(gauge.refused(), None, "and saying it twice is not news");
        assert_eq!(
            gauge.observe(900, 1000),
            None,
            "a sample still above the mark leaves the refusal's state standing"
        );
        assert_eq!(
            gauge.observe(10, 1000),
            Some(false),
            "recovery runs through the ordinary path — health must come back on its own"
        );
    }

    #[test]
    fn an_unreadable_limit_claims_nothing() {
        let mut gauge = FdPressureGauge::new();
        assert_eq!(
            gauge.observe(500, 0),
            None,
            "a daemon that cannot read its limit knows nothing about pressure"
        );
        assert!(!gauge.under_pressure());
    }

    /// The sampler's own inputs, on the host running the test: both must answer,
    /// and the count must be under the limit or the process could not be running.
    #[cfg(unix)]
    #[test]
    fn this_process_can_read_its_own_descriptor_pressure() {
        let open = open_fd_count().expect("this platform enumerates its own descriptors");
        let limit = soft_fd_limit().expect("this platform reports RLIMIT_NOFILE");
        assert!(open > 0, "a running test process holds at least stdio");
        assert!(
            limit > 0,
            "a soft limit of zero would forbid the read above"
        );
        assert!(
            open < limit,
            "{open} descriptors against a {limit} limit — a process past its own limit could \
             not have opened the directory this counted"
        );
    }
}
