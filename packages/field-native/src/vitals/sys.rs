//! VT-1 — what the operating system says of one process: the meter's only door to it.
//!
//! macOS: `proc_pid_rusage` (flavor 4), which answers for any process of the same user without a privilege, and
//! carries the physical footprint, the figure Activity Monitor shows as Memory. Its two CPU times are in Mach
//! absolute-time units, not nanoseconds: on Apple silicon one unit is 125/3 ns, so they are scaled by
//! `mach_timebase_info` (the unit test below holds the scale to `getrusage`). A process's start and name come from
//! `proc_pidinfo(PROC_PIDTBSDINFO)`, read once per process and kept.
//!
//! Linux: `/proc/<pid>/stat` and `statm`, and `io` where it can be read. It has no footprint, so `footprint_bytes`
//! is `None` there and a reader shows the resident size and says so.
//!
//! Elsewhere there is no reading the floor trusts, and the meter says `unavailable` rather than a made-up number.

/// One process at one moment. Counters are cumulative since the process began.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Raw {
    pub started_at_ms: u64,
    pub cpu_user_us: u64,
    pub cpu_system_us: u64,
    pub resident_bytes: u64,
    pub footprint_bytes: Option<u64>,
    pub disk_read_bytes: Option<u64>,
    pub disk_written_bytes: Option<u64>,
    pub wakeups: Option<u64>,
    pub energy_nj: Option<u64>,
}

/// Why this platform has no reading, in the floor's own sentence; `None` where it has one.
pub fn unsupported() -> Option<&'static str> {
    if cfg!(any(target_os = "macos", target_os = "linux")) {
        None
    } else {
        Some("this platform has no per-process reading the floor trusts")
    }
}

#[cfg(target_os = "macos")]
pub use macos::Reader;

#[cfg(target_os = "linux")]
pub use linux::Reader;

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub use none::Reader;

#[cfg(target_os = "macos")]
mod macos {
    use super::Raw;
    use std::collections::HashMap;

    /// What is read once per process and kept: its start on the wall clock. Keyed by pid and held to the
    /// process's Mach start, so a pid the OS reuses is read again. Its name is never kept (`name`).
    struct Known {
        start_abstime: u64,
        started_at_ms: u64,
    }

    /// `mach_timebase_info_data_t`, declared here: the `libc` crate's own binding is deprecated in favour of a
    /// crate this workspace does not carry, and the call is two integers from libSystem.
    #[repr(C)]
    struct Timebase {
        numer: u32,
        denom: u32,
    }

    extern "C" {
        fn mach_timebase_info(info: *mut Timebase) -> libc::c_int;
    }

    pub struct Reader {
        /// Mach absolute-time units to nanoseconds: `numer / denom`.
        numer: u64,
        denom: u64,
        known: HashMap<u32, Known>,
    }

    impl Default for Reader {
        fn default() -> Self {
            Self::new()
        }
    }

    impl Reader {
        pub fn new() -> Self {
            let mut info = Timebase { numer: 0, denom: 0 };
            // SAFETY: `mach_timebase_info` writes one fully-owned struct through this pointer.
            let ok = unsafe { mach_timebase_info(&mut info) } == 0;
            let (numer, denom) = if ok && info.denom != 0 {
                (u64::from(info.numer), u64::from(info.denom))
            } else {
                (1, 1)
            };
            Self {
                numer,
                denom,
                known: HashMap::new(),
            }
        }

        /// Nothing to prepare on macOS: every question is one call.
        pub fn begin(&mut self) {}

        fn abs_to_us(&self, units: u64) -> u64 {
            // u128, so a long-lived process's time cannot overflow before the divide
            (u128::from(units) * u128::from(self.numer) / u128::from(self.denom) / 1_000) as u64
        }

        pub fn read(&mut self, pid: u32) -> Option<Raw> {
            // SAFETY: an all-zero `rusage_info_v4` is a valid value of a plain C struct of integers.
            let mut usage: libc::rusage_info_v4 = unsafe { std::mem::zeroed() };
            // SAFETY: flavor 4 writes exactly one `rusage_info_v4` through the pointer, which this frame owns.
            let status = unsafe {
                libc::proc_pid_rusage(
                    pid as libc::c_int,
                    libc::RUSAGE_INFO_V4,
                    (&mut usage as *mut libc::rusage_info_v4).cast(),
                )
            };
            if status != 0 {
                self.known.remove(&pid);
                return None;
            }
            let fresh = self
                .known
                .get(&pid)
                .is_none_or(|known| known.start_abstime != usage.ri_proc_start_abstime);
            if fresh {
                let (started_at_ms, _) = bsd_info(pid)?;
                self.known.insert(
                    pid,
                    Known {
                        start_abstime: usage.ri_proc_start_abstime,
                        started_at_ms,
                    },
                );
            }
            let started_at_ms = self.known.get(&pid)?.started_at_ms;
            Some(Raw {
                started_at_ms,
                cpu_user_us: self.abs_to_us(usage.ri_user_time),
                cpu_system_us: self.abs_to_us(usage.ri_system_time),
                resident_bytes: usage.ri_resident_size,
                footprint_bytes: Some(usage.ri_phys_footprint),
                disk_read_bytes: Some(usage.ri_diskio_bytesread),
                disk_written_bytes: Some(usage.ri_diskio_byteswritten),
                wakeups: Some(
                    usage
                        .ri_pkg_idle_wkups
                        .saturating_add(usage.ri_interrupt_wkups),
                ),
                // 0 on a Mac that bills no energy to a process: no reading, never "none used"
                energy_nj: (usage.ri_billed_energy != 0).then_some(usage.ri_billed_energy),
            })
        }

        /// The name of a process `read` has answered for. Used for the floor's own children alone.
        ///
        /// Read now, never kept: a child is listed from its fork, and until its exec lands it carries its
        /// parent's name. *Corrected 2026-11-24 (VT-2's VITALS row): the name was read once with the start and
        /// kept, so a terminal cell first read inside that window (a debug cell's exec is not short) was named
        /// `field-native` for its whole life and its row said Other.* One call a child a reading.
        pub fn name(&self, pid: u32) -> Option<String> {
            self.known.get(&pid)?;
            bsd_info(pid).map(|(_, name)| name)
        }

        pub fn children(&mut self, pid: u32) -> Vec<u32> {
            const CAPACITY: usize = 1024;
            let mut pids = vec![0 as libc::pid_t; CAPACITY];
            // SAFETY: the buffer's byte length is exactly what is passed; the kernel writes pids into it.
            let returned = unsafe {
                libc::proc_listchildpids(
                    pid as libc::pid_t,
                    pids.as_mut_ptr().cast(),
                    (CAPACITY * std::mem::size_of::<libc::pid_t>()) as libc::c_int,
                )
            };
            if returned <= 0 {
                return Vec::new();
            }
            // The call has answered a count of pids on some releases and a count of bytes on others. The buffer
            // began as zeros and no process has pid 0, so reading up to the larger meaning and dropping zeros is
            // right for both.
            pids.truncate((returned as usize).min(CAPACITY));
            pids.into_iter()
                .filter(|child| *child > 0)
                .map(|child| child as u32)
                .collect()
        }

        /// Forget every process not in `live`, so the kept starts cannot grow without bound.
        pub fn retain(&mut self, live: &std::collections::HashSet<u32>) {
            self.known.retain(|pid, _| live.contains(pid));
        }
    }

    fn bsd_info(pid: u32) -> Option<(u64, String)> {
        // SAFETY: an all-zero `proc_bsdinfo` is a valid value of a plain C struct.
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
        // SAFETY: the kernel writes at most `size` bytes into the struct this frame owns.
        let written = unsafe {
            libc::proc_pidinfo(
                pid as libc::c_int,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            )
        };
        if written != size {
            return None;
        }
        let started_at_ms = info
            .pbi_start_tvsec
            .saturating_mul(1_000)
            .saturating_add(info.pbi_start_tvusec / 1_000);
        // `pbi_name` holds the longer name (32 bytes); `pbi_comm` (16) is the fallback when it is empty.
        let name = c_chars(&info.pbi_name);
        let name = if name.is_empty() {
            c_chars(&info.pbi_comm)
        } else {
            name
        };
        Some((started_at_ms, name))
    }

    fn c_chars(raw: &[libc::c_char]) -> String {
        let bytes: Vec<u8> = raw
            .iter()
            .take_while(|byte| **byte != 0)
            .map(|byte| *byte as u8)
            .collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::Raw;
    use std::collections::HashMap;

    pub struct Reader {
        ticks_per_second: u64,
        page_bytes: u64,
        boot_ms: u64,
        names: HashMap<u32, String>,
        /// parent → children, built at most once per reading from one walk of `/proc`
        table: Option<HashMap<u32, Vec<u32>>>,
    }

    impl Default for Reader {
        fn default() -> Self {
            Self::new()
        }
    }

    /// `/proc/<pid>/stat`: the name is in parentheses and may itself hold spaces and parentheses, so the fields
    /// are read after the LAST `)`.
    struct Stat {
        name: String,
        ppid: u32,
        user_ticks: u64,
        system_ticks: u64,
        start_ticks: u64,
    }

    fn stat(pid: u32) -> Option<Stat> {
        let text = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let open = text.find('(')?;
        let close = text.rfind(')')?;
        let name = text.get(open + 1..close)?.to_owned();
        let rest: Vec<&str> = text.get(close + 1..)?.split_whitespace().collect();
        // after the name: state(0) ppid(1) … utime(11) stime(12) … starttime(19)
        Some(Stat {
            name,
            ppid: rest.get(1)?.parse().ok()?,
            user_ticks: rest.get(11)?.parse().ok()?,
            system_ticks: rest.get(12)?.parse().ok()?,
            start_ticks: rest.get(19)?.parse().ok()?,
        })
    }

    impl Reader {
        pub fn new() -> Self {
            // SAFETY: `sysconf` reads a system constant and has no preconditions.
            let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
            // SAFETY: as above.
            let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
            let boot_ms = std::fs::read_to_string("/proc/stat")
                .ok()
                .and_then(|text| {
                    text.lines()
                        .find_map(|line| line.strip_prefix("btime "))
                        .and_then(|seconds| seconds.trim().parse::<u64>().ok())
                })
                .map_or(0, |seconds| seconds.saturating_mul(1_000));
            Self {
                ticks_per_second: if ticks > 0 { ticks as u64 } else { 100 },
                page_bytes: if page > 0 { page as u64 } else { 4_096 },
                boot_ms,
                names: HashMap::new(),
                table: None,
            }
        }

        /// A reading's parent table is the reading's own: dropped here, rebuilt when first asked.
        pub fn begin(&mut self) {
            self.table = None;
        }

        fn ticks_to_us(&self, ticks: u64) -> u64 {
            (u128::from(ticks) * 1_000_000 / u128::from(self.ticks_per_second)) as u64
        }

        pub fn read(&mut self, pid: u32) -> Option<Raw> {
            let stat = stat(pid)?;
            let resident_pages = std::fs::read_to_string(format!("/proc/{pid}/statm"))
                .ok()?
                .split_whitespace()
                .nth(1)?
                .parse::<u64>()
                .ok()?;
            // `io` is readable for one's own processes on most kernels; where it is not, the figure is absent
            let io = std::fs::read_to_string(format!("/proc/{pid}/io")).ok();
            let io_field = |name: &str| {
                io.as_deref().and_then(|text| {
                    text.lines()
                        .find_map(|line| line.strip_prefix(name))
                        .and_then(|value| value.trim().parse::<u64>().ok())
                })
            };
            self.names.insert(pid, stat.name);
            Some(Raw {
                started_at_ms: self.boot_ms.saturating_add(
                    (u128::from(stat.start_ticks) * 1_000 / u128::from(self.ticks_per_second))
                        as u64,
                ),
                cpu_user_us: self.ticks_to_us(stat.user_ticks),
                cpu_system_us: self.ticks_to_us(stat.system_ticks),
                resident_bytes: resident_pages.saturating_mul(self.page_bytes),
                footprint_bytes: None,
                disk_read_bytes: io_field("read_bytes:"),
                disk_written_bytes: io_field("write_bytes:"),
                wakeups: None,
                energy_nj: None,
            })
        }

        pub fn name(&self, pid: u32) -> Option<String> {
            self.names.get(&pid).cloned()
        }

        pub fn children(&mut self, pid: u32) -> Vec<u32> {
            let table = self.table.get_or_insert_with(|| {
                let mut table: HashMap<u32, Vec<u32>> = HashMap::new();
                let Ok(entries) = std::fs::read_dir("/proc") else {
                    return table;
                };
                for entry in entries.flatten() {
                    let Some(child) = entry
                        .file_name()
                        .to_str()
                        .and_then(|name| name.parse::<u32>().ok())
                    else {
                        continue;
                    };
                    if let Some(stat) = stat(child) {
                        table.entry(stat.ppid).or_default().push(child);
                    }
                }
                table
            });
            table.get(&pid).cloned().unwrap_or_default()
        }

        pub fn retain(&mut self, live: &std::collections::HashSet<u32>) {
            self.names.retain(|pid, _| live.contains(pid));
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod none {
    use super::Raw;

    #[derive(Default)]
    pub struct Reader;

    impl Reader {
        pub fn new() -> Self {
            Self
        }
        pub fn begin(&mut self) {}
        pub fn read(&mut self, _pid: u32) -> Option<Raw> {
            None
        }
        pub fn name(&self, _pid: u32) -> Option<String> {
            None
        }
        pub fn children(&mut self, _pid: u32) -> Vec<u32> {
            Vec::new()
        }
        pub fn retain(&mut self, _live: &std::collections::HashSet<u32>) {}
    }
}

#[cfg(all(test, unix, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use super::*;

    fn own_cpu_us() -> u64 {
        // SAFETY: an all-zero `rusage` is a valid value; `getrusage` fills the one this frame owns.
        let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
        // SAFETY: as above.
        assert_eq!(unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) }, 0);
        let micros = |time: libc::timeval| time.tv_sec as u64 * 1_000_000 + time.tv_usec as u64;
        micros(usage.ru_utime) + micros(usage.ru_stime)
    }

    /// The scale is the claim: the meter's CPU time for this process agrees with `getrusage`'s, which is in
    /// microseconds by definition. Read on an Apple silicon Mac without the timebase, the two differ by 41.67×.
    #[test]
    fn cpu_time_is_in_microseconds() {
        let mut reader = Reader::new();
        let pid = std::process::id();
        // Burn enough CPU that a wrong unit cannot hide in the noise. The burn is counted in CPU time, never wall
        // time: a busy Mac gives a low-priority test a fraction of a core, and the claim is about the unit.
        let began = own_cpu_us();
        let mut sink = 0u64;
        while own_cpu_us() - began < 300_000 {
            for _ in 0..1_000_000 {
                sink = sink.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
            }
            std::hint::black_box(sink);
        }
        let truth = own_cpu_us();
        let raw = reader.read(pid).expect("this process is readable");
        let metered = raw.cpu_user_us + raw.cpu_system_us;
        assert!(truth >= 300_000, "the burn used {truth} µs of CPU");
        let ratio = metered as f64 / truth as f64;
        assert!(
            (0.8..1.25).contains(&ratio),
            "the meter read {metered} µs where getrusage read {truth} µs (ratio {ratio:.2})"
        );
    }

    #[test]
    fn a_process_reads_its_own_start_memory_and_name() {
        let mut reader = Reader::new();
        let pid = std::process::id();
        let raw = reader.read(pid).expect("this process is readable");
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        assert!(raw.started_at_ms <= now_ms, "it began in the past");
        assert!(
            now_ms - raw.started_at_ms < 3_600_000,
            "and within the hour"
        );
        assert!(
            raw.resident_bytes > 1 << 20,
            "a test binary holds over a megabyte"
        );
        if cfg!(target_os = "macos") {
            assert!(raw.footprint_bytes.is_some_and(|bytes| bytes > 1 << 20));
        }
        assert!(reader.name(pid).is_some_and(|name| !name.is_empty()));
        // the same process read again is the same process
        let again = reader.read(pid).expect("still readable");
        assert_eq!(again.started_at_ms, raw.started_at_ms);
    }

    /// VT-2's VITALS row found it (2026-11-24): a child is listed from its fork and named by its exec, so a name
    /// read once and kept can be its parent's for good. A process that execs AFTER its first reading stands in
    /// for the fork window, which is too short to hold open in a test.
    #[cfg(unix)]
    #[test]
    fn a_name_follows_the_process_through_an_exec() {
        let mut child = std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 1; exec sleep 20"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("sh starts");
        let pid = child.id();
        let mut reader = Reader::new();
        let before = reader.read(pid).expect("the shell is readable");
        let first = reader.name(pid).expect("the shell has a name");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        let mut last = first.clone();
        while last != "sleep" && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let again = reader.read(pid).expect("still readable");
            assert_eq!(
                again.started_at_ms, before.started_at_ms,
                "the same process"
            );
            last = reader.name(pid).expect("still named");
        }
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(first, "sh", "read before its exec, it is the shell");
        assert_eq!(last, "sleep", "read after, it is what it became");
    }

    #[test]
    fn a_child_is_listed_under_its_parent_and_a_gone_pid_reads_nothing() {
        let mut reader = Reader::new();
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .stdin(std::process::Stdio::null())
            .spawn()
            .expect("sleep starts");
        reader.begin();
        let children = reader.children(std::process::id());
        assert!(
            children.contains(&child.id()),
            "{} is among {children:?}",
            child.id()
        );
        assert!(reader.read(child.id()).is_some());
        child.kill().expect("the child is killed");
        child.wait().expect("and reaped");
        reader.begin();
        assert!(
            reader.read(child.id()).is_none(),
            "a reaped pid has no reading"
        );
    }
}
