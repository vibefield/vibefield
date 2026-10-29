//! CP-1a — the kernel's word about who dialed the floor's door (`thinking-roled-agents.md` §16; CP-D1: identity from
//! the process, never from a token). Everything here is read from the kernel, and nothing from what a caller says:
//!
//! - **The caller's pid.** macOS keeps two on a local socket. tokio's `peer_cred()` asks for `LOCAL_PEEREPID`
//!   (tokio-1.53.3 `ucred.rs:297,315`), the EFFECTIVE pid, which a socket delegated to act for another process
//!   (`SO_DELEGATED`) reports in place of its holder's. `LOCAL_PEERPID` is the holder's. The door names the caller by
//!   the holder and reads both, so the door refuses a delegated socket rather than naming whom it claims to be (the
//!   CO lead's brief, 2026-10-29). Linux's `SO_PEERCRED` names the connecting process and has no delegation, so there
//!   the two are one reading.
//! - **The caller's uid** (`getpeereid`, `SO_PEERCRED`), held to the floor's own.
//! - **Each process's start and parent,** for the reuse guard and the walk (`walk.rs`): macOS
//!   `proc_pidinfo(PROC_PIDTBSDINFO)`, Linux `/proc/<pid>/stat` read against `/proc/stat`'s `btime`. A start is
//!   compared at whole seconds (`sameStartSecond`, contracts): Linux's boot time is one, and `ps` truncates to one.

/// What the kernel says about a door's caller at accept.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PeerFacts {
    /// the process that holds the socket
    pub pid: u32,
    /// the process the socket acts for; differs from `pid` only for a delegated socket (macOS)
    pub effective_pid: u32,
    pub uid: u32,
}

/// What the kernel says about one process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessFacts {
    pub parent: u32,
    /// Unix milliseconds. macOS keeps microseconds and Linux clock ticks after a whole-second boot time, so two
    /// readings agree at the second (`NATIVE_DOOR.START_RESOLUTION_MS`) and are never compared finer.
    pub started_at_ms: u64,
}

/// The process table as the walk reads it: the kernel in production, a fixed tree in its rows.
pub trait ProcessTable {
    /// `None` once the process is gone, or when the kernel will not say.
    fn process(&self, pid: u32) -> Option<ProcessFacts>;
}

/// The running kernel's table.
pub struct Kernel;

impl ProcessTable for Kernel {
    fn process(&self, pid: u32) -> Option<ProcessFacts> {
        process_facts(pid)
    }
}

/// This process's uid, the one a door's caller must share.
#[cfg(unix)]
pub fn own_uid() -> u32 {
    // SAFETY: getuid takes nothing and cannot fail.
    unsafe { libc::getuid() }
}

#[cfg(unix)]
pub fn peer_facts(stream: &tokio::net::UnixStream) -> std::io::Result<PeerFacts> {
    let cred = stream.peer_cred()?;
    let effective_pid = cred
        .pid()
        .and_then(|pid| u32::try_from(pid).ok())
        .filter(|pid| *pid > 0)
        .ok_or_else(|| std::io::Error::other("the kernel named no peer process"))?;
    Ok(PeerFacts {
        pid: holder_pid(stream, effective_pid)?,
        effective_pid,
        uid: cred.uid(),
    })
}

#[cfg(target_os = "macos")]
fn holder_pid(stream: &tokio::net::UnixStream, _effective: u32) -> std::io::Result<u32> {
    use std::os::fd::AsRawFd;
    let mut pid: libc::pid_t = 0;
    let mut len = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    // SAFETY: `pid` and `len` are live locals of the sizes passed, and the kernel writes at most `len` bytes into
    // `pid`. The descriptor is borrowed from a stream that outlives the call.
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_LOCAL,
            libc::LOCAL_PEERPID,
            (&mut pid as *mut libc::pid_t).cast(),
            &mut len,
        )
    };
    if rc != 0 {
        return Err(std::io::Error::last_os_error());
    }
    u32::try_from(pid)
        .ok()
        .filter(|pid| *pid > 0)
        .ok_or_else(|| std::io::Error::other("LOCAL_PEERPID named no process"))
}

/// `SO_PEERCRED` names the connecting process and has no delegation: the holder IS the one reading.
#[cfg(all(unix, not(target_os = "macos")))]
fn holder_pid(_stream: &tokio::net::UnixStream, effective: u32) -> std::io::Result<u32> {
    Ok(effective)
}

#[cfg(target_os = "macos")]
pub fn process_facts(pid: u32) -> Option<ProcessFacts> {
    let pid = i32::try_from(pid).ok()?;
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    // SAFETY: the buffer is exactly `size` bytes, and the kernel writes at most that many and returns how many.
    let got = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    if got != size {
        return None;
    }
    // SAFETY: the kernel filled all `size` bytes (checked above), and the struct is plain integers and arrays.
    let info = unsafe { info.assume_init() };
    Some(ProcessFacts {
        parent: info.pbi_ppid,
        started_at_ms: info.pbi_start_tvsec * 1_000 + info.pbi_start_tvusec / 1_000,
    })
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn process_facts(pid: u32) -> Option<ProcessFacts> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let (parent, ticks) = parse_proc_stat(&stat)?;
    let boot_s = std::fs::read_to_string("/proc/stat")
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix("btime ")?.trim().parse::<u64>().ok())?;
    // SAFETY: sysconf takes a constant name and cannot fail in a way that writes memory.
    let hz = u64::try_from(unsafe { libc::sysconf(libc::_SC_CLK_TCK) })
        .ok()
        .filter(|hz| *hz > 0)?;
    Some(ProcessFacts {
        parent,
        started_at_ms: boot_s * 1_000 + ticks * 1_000 / hz,
    })
}

#[cfg(not(unix))]
pub fn process_facts(_pid: u32) -> Option<ProcessFacts> {
    None
}

/// `/proc/<pid>/stat`'s parent (field 4) and start in clock ticks after boot (field 22). The command (field 2) is
/// parenthesised and may itself hold spaces and parentheses, so the fields resume after the LAST `)`.
#[cfg(any(test, all(unix, not(target_os = "macos"))))]
fn parse_proc_stat(stat: &str) -> Option<(u32, u64)> {
    let rest = stat.get(stat.rfind(')')? + 1..)?;
    let fields: Vec<&str> = rest.split_whitespace().collect();
    // fields[0] is field 3 (the state)
    Some((fields.get(1)?.parse().ok()?, fields.get(19)?.parse().ok()?))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    #[tokio::test]
    async fn a_connection_is_named_by_the_process_that_holds_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("door.sock");
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        let client = tokio::net::UnixStream::connect(&path).await.unwrap();
        let (server, _) = listener.accept().await.unwrap();
        let facts = peer_facts(&server).unwrap();
        assert_eq!(facts.pid, std::process::id());
        // a plain process's socket acts for itself: the holder and the effective pid agree
        assert_eq!(facts.effective_pid, facts.pid);
        assert_eq!(facts.uid, own_uid());
        drop(client);
    }

    #[test]
    fn a_child_is_known_by_its_parent_and_a_start_after_ours() {
        let before = now_ms();
        let mut child = std::process::Command::new("sleep")
            .arg("5")
            .spawn()
            .unwrap();
        let facts = process_facts(child.id());
        let after = now_ms();
        child.kill().unwrap();
        child.wait().unwrap();
        let facts = facts.expect("a live child has facts");
        assert_eq!(facts.parent, std::process::id());
        let own = process_facts(std::process::id()).expect("this process has facts");
        assert!(own.started_at_ms <= facts.started_at_ms);
        // at the start's resolution: a whole second either side of the spawn
        assert!(
            facts.started_at_ms + 1_000 >= before,
            "{facts:?} before {before}"
        );
        assert!(
            facts.started_at_ms <= after + 1_000,
            "{facts:?} after {after}"
        );
    }

    #[test]
    fn a_process_that_is_gone_has_no_facts() {
        let mut child = std::process::Command::new("true").spawn().unwrap();
        let pid = child.id();
        child.wait().unwrap();
        // reaped: until the system hands the pid on, the kernel knows no such process
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while process_facts(pid).is_some() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(process_facts(pid).is_none());
        assert!(process_facts(u32::MAX).is_none());
    }

    #[test]
    fn proc_stat_reads_past_a_command_that_holds_spaces_and_parentheses() {
        let stat =
            "4242 (a (b) c) S 4100 4242 4100 0 -1 4194560 120 0 0 0 1 2 0 0 20 0 1 0 987654 \
                    1000000 100 18446744073709551615";
        assert_eq!(parse_proc_stat(stat), Some((4100, 987654)));
        assert_eq!(parse_proc_stat("4242 (cut short) S 4100"), None);
    }
}
