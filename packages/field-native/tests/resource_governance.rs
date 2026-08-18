//! TC-S0's kill-matrix row: descriptor exhaustion, in BOTH arms.
//!
//! The rehearsal this row exists for: field-native costs `24 + 5N` descriptors
//! at N sessions, so under launchd's 256-fd soft limit it died SILENTLY at
//! session #47. TC-D6(a)'s boot-time raise is the fix, and a fix nobody can
//! watch fail is not evidence — so this row runs the daemon TWICE against the
//! same low inherited limit:
//!
//! * **the sabotage arm** — `FIELD_NATIVE_TEST_NO_RLIMIT=1` holds the daemon at
//!   the limit it inherited, and creates run into a ceiling. This is the row
//!   proving it can fail.
//! * **the real arm** — the same inherited limit, no escape hatch. The boot
//!   raise lifts the soft limit toward the hard one and the daemon sails past
//!   the point where its twin stopped, with health still answering, the
//!   sessions it already had still alive, and its descriptors and threads
//!   returning EXACTLY to base once they end.
//!
//! **The PTY pool is shared with the whole machine** (511 slots on this host,
//! Ghostty included), so the arms run one after the other inside a single test
//! and the real arm stops at a bounded target rather than climbing until
//! something breaks. The ceiling under test is the descriptor limit; drying the
//! machine's PTYs would prove nothing this file claims and would take every
//! other terminal down with it.

#![cfg(unix)]

use field_native::pairing;
use field_native::resource_pressure::{CreateRefusal, PressureClass};
use field_native::rlimit::TEST_NO_RLIMIT_ENV;
use field_native::services::terminal_client::ControlClient;
use serde_json::{json, Value};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::time::timeout;

/// The soft descriptor limit both arms INHERIT — launchd's 256 in miniature.
///
/// Low enough that the measured `24 + 5N` runs out well before the target, and
/// high enough that the daemon still boots, binds its sockets and opens its log
/// segments. If the sabotage arm ever reaches the target, this number has
/// stopped binding and the assertion below says so rather than passing quietly.
const INHERITED_SOFT: u64 = 96;

/// How far the real arm climbs. Bounded on purpose (see the module note): the
/// claim is "past the ceiling that killed the sabotage arm", not "until
/// something breaks".
const TARGET_SESSIONS: usize = 30;

/// A quiet PTY tenant that holds its terminal open until it is killed.
const TENANT: &str = "/bin/cat";

struct NativeProcess {
    child: Option<Child>,
}

impl NativeProcess {
    /// Spawn the real binary with a LOW soft descriptor limit imposed on the
    /// child — the inherited-limit condition, reproduced without touching this
    /// test process (whose limit its sibling tests are also using).
    fn spawn(data_dir: &Path, log_root: &Path, sabotage: bool) -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_field-native"));
        command
            .env("FIELD_NATIVE_DATA_DIR", data_dir)
            .env("FIELD_LOG_DIR", log_root)
            .env("FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE", "1")
            .env_remove("FIELD_NATIVE_MESH")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if sabotage {
            command.env(TEST_NO_RLIMIT_ENV, "1");
        } else {
            command.env_remove(TEST_NO_RLIMIT_ENV);
        }
        // SAFETY: runs in the forked child before exec. `getrlimit`/`setrlimit`
        // are async-signal-safe, allocate nothing, and touch only this child's
        // own limits. Only the SOFT half is lowered — leaving the hard limit
        // alone is what gives the real arm something to raise back to, which is
        // exactly the production shape under launchd.
        unsafe {
            command.pre_exec(|| {
                let mut limit = libc::rlimit {
                    rlim_cur: 0,
                    rlim_max: 0,
                };
                if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                limit.rlim_cur = (INHERITED_SOFT as libc::rlim_t).min(limit.rlim_max);
                if libc::setrlimit(libc::RLIMIT_NOFILE, &limit) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let child = command.spawn().expect("spawn field-native");
        Self { child: Some(child) }
    }

    fn id(&self) -> u32 {
        self.child.as_ref().expect("child available").id()
    }

    fn is_running(&mut self) -> bool {
        self.child
            .as_mut()
            .expect("child available")
            .try_wait()
            .expect("query child")
            .is_none()
    }

    async fn terminate(mut self) {
        if self.child.is_none() {
            return;
        }
        // SAFETY: this pid belongs to the child this fixture retains.
        unsafe { libc::kill(self.id() as libc::pid_t, libc::SIGTERM) };
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.is_running() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for NativeProcess {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

struct MgmtClient {
    reader: tokio::io::Lines<BufReader<tokio::net::unix::OwnedReadHalf>>,
    writer: tokio::net::unix::OwnedWriteHalf,
}

impl MgmtClient {
    async fn connect(path: &Path) -> Self {
        let stream = UnixStream::connect(path).await.expect("connect mgmt");
        let (read, write) = stream.into_split();
        Self {
            reader: BufReader::new(read).lines(),
            writer: write,
        }
    }

    async fn request(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.writer
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "method": method,
                        "params": params,
                    })
                )
                .as_bytes(),
            )
            .await
            .expect("write mgmt");
        loop {
            let line = timeout(Duration::from_secs(10), self.reader.next_line())
                .await
                .expect("mgmt response timeout")
                .expect("mgmt response read")
                .expect("mgmt connection closed");
            let value: Value = serde_json::from_str(&line).expect("mgmt response json");
            // Notifications share this socket with responses; correlate rather
            // than assuming the next line is the answer.
            if value.get("id").and_then(Value::as_u64) == Some(id) {
                return value;
            }
        }
    }

    async fn hello(&mut self, data_dir: &Path) -> Value {
        let secret_hex = std::fs::read_to_string(data_dir.join("native/pairing"))
            .expect("read the pairing secret");
        let secret = hex::decode(secret_hex.trim()).expect("decode the pairing secret");
        let boot_id = "fieldd-resource-governance".to_string();
        let timestamp = pairing::now_epoch_secs();
        let mac = pairing::compute_mac(&secret, &boot_id, timestamp);
        let response = self
            .request(
                1,
                "native.lifecycle.hello",
                json!({
                    "contractsVersion": "0.1.0",
                    "minCompatible": "0.1.0",
                    "clientKind": "fieldd",
                    "credential": {"bootId": boot_id, "ts": timestamp, "mac": mac},
                }),
            )
            .await;
        response["result"].clone()
    }
}

/// macOS reports another process's open descriptors and thread count through
/// `proc_pidinfo` — the same pair the `24 + 5N` / `13 + 3N` measurements were
/// taken with. These are the LEAK DETECTORS: a session that ends must give back
/// exactly what it took.
#[cfg(target_os = "macos")]
fn open_fds(pid: u32) -> Option<usize> {
    let entry = std::mem::size_of::<libc::proc_fdinfo>();
    // The sizing call answers how much room the kernel MIGHT need — it reports
    // the process's fd TABLE, whose high-water mark never shrinks. Reading it as
    // a count is a leak detector that reports a leak for every process that was
    // ever busy: this row's first draft "found" 5 descriptors per session
    // retained forever, and the retention was entirely in the measurement.
    // Only the second call's return value counts what is actually open.
    // SAFETY: a null buffer with a zero length is the documented sizing form.
    let sized = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDLISTFDS,
            0,
            std::ptr::null_mut(),
            0,
        )
    };
    if sized <= 0 {
        return None;
    }
    let mut buffer: Vec<libc::proc_fdinfo> =
        vec![unsafe { std::mem::zeroed() }; sized as usize / entry];
    // SAFETY: `buffer` is live and exactly `sized` bytes long.
    let written = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDLISTFDS,
            0,
            buffer.as_mut_ptr().cast(),
            sized,
        )
    };
    (written > 0).then_some(written as usize / entry)
}

#[cfg(target_os = "macos")]
fn thread_count(pid: u32) -> Option<usize> {
    let mut info: libc::proc_taskinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_taskinfo>() as libc::c_int;
    // SAFETY: `info` is live, fully owned, and exactly `size` bytes.
    let written = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDTASKINFO,
            0,
            (&mut info as *mut libc::proc_taskinfo).cast(),
            size,
        )
    };
    (written == size).then_some(info.pti_threadnum as usize)
}

/// Linux could read `/proc/<pid>/fd` and `/proc/<pid>/status`, but this row has
/// only ever been rehearsed on macOS and a leak detector nobody has watched
/// catch a leak is not one. The arms above still run; the exact-return
/// assertions are macOS-only and say so rather than being quietly skipped.
#[cfg(not(target_os = "macos"))]
fn open_fds(_pid: u32) -> Option<usize> {
    None
}

#[cfg(not(target_os = "macos"))]
fn thread_count(_pid: u32) -> Option<usize> {
    None
}

fn short_tempdir() -> tempfile::TempDir {
    let dir = tempfile::Builder::new()
        .prefix("vfrg")
        .tempdir_in("/tmp")
        .expect("tempdir under /tmp");
    let probe = dir.path().join("data/native/run/termctl.sock");
    assert!(
        probe.as_os_str().len() < 100,
        "socket path would risk sun_path truncation: {}",
        probe.display()
    );
    dir
}

fn tenant_options() -> Value {
    json!({
        "executable": TENANT,
        "args": [],
        "cols": 80,
        "rows": 24,
        "persistence": "keep-until-exit",
        "environment": {"mode": "clean", "variables": {}},
    })
}

async fn wait_for_native(data_dir: &Path, process: &mut NativeProcess) -> PathBuf {
    let socket = data_dir.join("native/run/mgmt.sock");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        assert!(
            process.is_running(),
            "field-native exited before binding mgmt"
        );
        if socket.exists()
            && data_dir.join("native/pairing").exists()
            && UnixStream::connect(&socket).await.is_ok()
        {
            return socket;
        }
        assert!(Instant::now() < deadline, "field-native did not bind mgmt");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// What one arm did.
struct Arm {
    /// Sessions created before anything refused.
    created: usize,
    /// The first refusal, if there was one.
    refusal: Option<CreateRefusal>,
    /// The daemon was still answering mgmt after the trouble.
    health_answered: bool,
    /// What the terminal unit said about itself on that health surface.
    terminal_detail: String,
    /// Descriptors and threads at rest, before and after the sessions.
    fds: (Option<usize>, Option<usize>),
    threads: (Option<usize>, Option<usize>),
    /// Sessions the floor still listed after the trouble.
    survivors: usize,
}

async fn run_arm(root: &Path, sabotage: bool, cap: usize) -> Arm {
    let data_dir = root.join("data");
    let log_root = root.join("logs");
    let mut process = NativeProcess::spawn(&data_dir, &log_root, sabotage);
    let socket = wait_for_native(&data_dir, &mut process).await;
    let pid = process.id();

    let mut mgmt = MgmtClient::connect(&socket).await;
    // TC-S2: the hello omits `terminal` until the CELL's own hello lands
    // (fresh names, real spawn, font discovery) — the absence the contract
    // always allowed is now a real window. The product reads the routes
    // subscription; this harness polls the hello the same bounded way.
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    let (control_socket, token) = loop {
        let ack = mgmt.hello(&data_dir).await;
        if let (Some(control), Some(token)) = (
            ack["terminal"]["controlSocket"].as_str(),
            ack["terminal"]["authToken"].as_str(),
        ) {
            break (control.to_string(), token.to_string());
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the terminal cell never announced endpoints: {ack}"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
        // One hello per connection is the mgmt law — retry on a fresh dial,
        // and the loop leaves the LAST (helloed) connection bound for the rest
        // of the arm.
        mgmt = MgmtClient::connect(&socket).await;
    };

    let (client, _events) = ControlClient::connect(&control_socket, &token)
        .await
        .expect("dial the terminal control socket");

    // The baseline is taken with this client ALREADY connected and the floor
    // settled: the inventory pump dials its own control connection once the
    // service starts serving, and a baseline taken before either would count
    // the harness's own descriptors as a leak at the end.
    tokio::time::sleep(Duration::from_millis(500)).await;
    let fds_before = open_fds(pid);
    let threads_before = thread_count(pid);

    let mut created = Vec::new();
    let mut refusal = None;
    for _ in 0..cap {
        match client.create_session_classified(tenant_options()).await {
            Ok(session) => created.push(session.id),
            Err(error) => {
                refusal = Some(error);
                break;
            }
        }
    }

    // The floor must still ANSWER after refusing — a ceiling is a refusal, not
    // a death. This is the half the rehearsal failed: the daemon simply stopped.
    //
    // Polled to a deadline rather than sampled once, because the fd sampler
    // publishes on its own interval: this waits for a STATE (the terminal unit
    // naming its pressure) and gives up on the clock only to bound the test.
    let mut request_id = 2;
    let mut health_answered = false;
    let mut terminal_detail = String::new();
    let deadline = Instant::now() + Duration::from_secs(12);
    loop {
        request_id += 1;
        let response = timeout(
            Duration::from_secs(10),
            mgmt.request(request_id, "native.lifecycle.health.subscribe", json!({})),
        )
        .await;
        if let Ok(response) = response {
            let snapshot = &response["result"]["snapshot"];
            if snapshot["state"].is_string() {
                health_answered = true;
                terminal_detail = snapshot["units"]
                    .as_array()
                    .and_then(|units| units.iter().find(|unit| unit["unit"] == "terminal"))
                    .and_then(|unit| unit["detail"].as_str())
                    .unwrap_or_default()
                    .to_string();
            }
        }
        // Wait for a snapshot worth asserting on. BOTH arms wait for the floor
        // to be SERVING: font discovery keeps the unit honestly `starting` for
        // a few hundred ms after boot, and "no pressure here" asserted against
        // that snapshot would pass for a reason that has nothing to do with
        // pressure. The arm that was MEANT to hit a ceiling then goes on waiting
        // for the state that says so.
        let settled = terminal_detail.starts_with("serving")
            && (!sabotage || terminal_detail.contains(PressureClass::FdPressure.as_str()));
        if settled || Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    // And the sessions it already had must still be alive: refusing the next
    // one must never cost the ones already running.
    let survivors = client
        .list_sessions()
        .await
        .map(|sessions| sessions.len())
        .unwrap_or(0);

    for id in &created {
        client
            .terminate(id, "user")
            .await
            .expect("a session this floor created is a session it can end");
    }
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if client
            .list_sessions()
            .await
            .is_ok_and(|sessions| sessions.is_empty())
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    // Wait for the STATE, not for a guess at how long teardown takes: upstream
    // reaps each exit on its own thread and closes what it held after the child
    // is gone, so a fixed sleep would either be flaky on a loaded host or hide
    // the very leak this is watching for. A real leak never converges, and the
    // assertion below still fails with the numbers.
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        // Descriptors are the deterministic signal, so they set the pace; the
        // thread count is only ever asserted as a ceiling (see the assertions),
        // and waiting for it to match exactly would burn the whole budget every
        // run on tokio's blocking-pool keep-alive.
        if open_fds(pid) == fds_before && thread_count(pid) <= threads_before {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let fds_after = open_fds(pid);
    let threads_after = thread_count(pid);

    drop(client);
    process.terminate().await;

    Arm {
        created: created.len(),
        refusal,
        health_answered,
        terminal_detail,
        fds: (fds_before, fds_after),
        threads: (threads_before, threads_after),
        survivors,
    }
}

/// The row itself. One test, two arms, run in sequence so at most one arm's
/// worth of PTYs is ever outstanding on a machine that shares them.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fd_exhaustion_refuses_honestly_and_the_boot_raise_carries_the_floor_past_it() {
    let sabotage_dir = short_tempdir();
    let sabotage = run_arm(sabotage_dir.path(), true, TARGET_SESSIONS).await;

    assert!(
        sabotage.created < TARGET_SESSIONS,
        "the sabotage arm reached {} sessions against an inherited soft limit of \
         {INHERITED_SOFT} — the limit has stopped binding, so this row can no longer fail and \
         proves nothing. Lower INHERITED_SOFT until it does.",
        sabotage.created
    );
    let refusal = sabotage
        .refusal
        .as_ref()
        .expect("a bound arm stops for a reason, and the reason is the evidence");
    // The whole of TC-D6(b) in one assertion: whatever else it is, the refusal
    // must not be silence. If the classifier could name it, it must name
    // descriptors — nothing else was made scarce here.
    if let Some(class) = refusal.pressure() {
        assert_eq!(
            class,
            PressureClass::FdPressure,
            "descriptors were the only resource this arm took away: {}",
            refusal.message()
        );
        assert!(
            refusal
                .message()
                .contains(PressureClass::FdPressure.as_str()),
            "and the message carries the contract spelling a reader keys on: {}",
            refusal.message()
        );
    }

    // TC-D6(e), proven in the production daemon rather than in a unit test: a
    // floor at its descriptor ceiling is DEGRADED and names the contract state.
    // The only writer that could have produced this is the unit's own periodic
    // sampler — the client that got refused lives in this test process, not in
    // the daemon — so this is the sampler working end to end.
    assert!(
        sabotage.health_answered,
        "the sabotage arm must still answer mgmt at its ceiling; a daemon that stops answering \
         is the rehearsed silent death, not a refusal"
    );
    assert!(
        sabotage
            .terminal_detail
            .contains(PressureClass::FdPressure.as_str()),
        "a floor out of descriptors must say so on its health surface, in the contract \
         spelling. The terminal unit said: {:?}",
        sabotage.terminal_detail
    );

    let real_dir = short_tempdir();
    let real = run_arm(real_dir.path(), false, TARGET_SESSIONS).await;

    assert_eq!(
        real.created,
        TARGET_SESSIONS,
        "the boot raise is what carries the floor past the ceiling its twin stopped at \
         ({} sessions); this arm reached {} of {TARGET_SESSIONS}{}",
        sabotage.created,
        real.created,
        real.refusal
            .as_ref()
            .map(|refusal| format!(" and was refused: {}", refusal.message()))
            .unwrap_or_default()
    );
    assert!(
        real.created > sabotage.created,
        "the two arms differ ONLY in the boot-time raise, so the raise is the whole difference"
    );
    assert!(
        real.health_answered,
        "a floor at its ceiling must still answer health — the rehearsed failure was that it \
         stopped answering at all"
    );
    assert!(
        !real
            .terminal_detail
            .contains(PressureClass::FdPressure.as_str()),
        "and a floor with room must NOT claim pressure: a state that is always on is not a \
         state. The terminal unit said: {:?}",
        real.terminal_detail
    );
    assert_eq!(
        real.survivors, TARGET_SESSIONS,
        "every session created must still be alive; refusing the next one may never cost the \
         ones already running"
    );

    // The leak detectors. Exact return, not "close enough": a per-session
    // descriptor or thread that is not given back is what turns a long-lived
    // daemon into the rehearsal all over again.
    if let (Some(before), Some(after)) = real.fds {
        assert_eq!(
            after, before,
            "{TARGET_SESSIONS} sessions came and went; descriptors must return exactly \
             ({before} → {after})"
        );
    }
    // Threads are asserted as a CEILING rather than an equality, and the reason
    // is measured, not defensive: tokio's blocking pool retires idle workers on
    // its own keep-alive, so a baseline taken while font discovery's worker is
    // still warm legitimately reads one HIGHER than the daemon's steady state
    // (14 → 13 here). Growth is the leak; shrinkage is the pool doing its job,
    // and demanding equality would make this row fail for the pool's timing
    // instead of for a leak.
    if let (Some(before), Some(after)) = real.threads {
        assert!(
            after <= before,
            "{TARGET_SESSIONS} sessions came and went; threads must never grow across them \
             ({before} → {after}) — at the measured 3 threads per session, even one session's \
             worth left behind shows up here"
        );
    }
}

/// TC-L1f closure row 10, the skeleton: admission is atomic ACROSS PROCESSES.
///
/// Two processes race the same ledger with a budget smaller than their combined
/// ask; exactly the budget may be admitted, no more. A ledger that read, decided
/// and wrote without holding the lock across all three would over-admit here,
/// which is the whole failure this row exists to catch.
#[test]
fn the_admission_ledger_is_atomic_across_processes() {
    use field_native::admission::{Admission, AdmissionLedger};

    const BUDGET: u32 = 12;
    const HELPERS: u32 = 6;
    const EACH: u32 = 4;
    /// The helper's verdict line, tagged so the libtest banner sharing its
    /// stdout cannot be read as a count.
    const VERDICT_TAG: &str = "vf-admitted:";

    // The helper role, taken by re-running THIS test binary. A spawned copy of
    // the real ledger code in a real second process is the only thing that
    // proves a lock between processes; two threads would share one and prove
    // nothing about `flock`.
    //
    // Every helper stays ALIVE, blocked on stdin, until the parent has read all
    // six verdicts. That is not test choreography for its own sake — the
    // ledger reclaims a dead process's budget on purpose (liveness, not trust),
    // so helpers allowed to exit as they finished would free budget for the
    // ones still starting and the row would measure staggered starts instead of
    // contention. It caught exactly that when written the other way.
    if let Ok(dir) = std::env::var("VF_ADMISSION_HELPER_DIR") {
        use std::io::{BufRead, Write};

        let ledger = AdmissionLedger::at(
            PathBuf::from(dir).join("custody-admission.v1.json"),
            BUDGET,
            &format!("helper-{}", std::process::id()),
        );
        let mut admitted = 0;
        for _ in 0..EACH {
            if matches!(
                ledger.try_reserve(1).expect("reserve"),
                Admission::Admitted { .. }
            ) {
                admitted += 1;
            }
        }
        // Tagged, because the child is still a libtest binary and prints its
        // own "running 1 test" banner down the same pipe.
        let mut stdout = std::io::stdout();
        writeln!(stdout, "{VERDICT_TAG}{admitted}").expect("report the verdict");
        stdout.flush().expect("flush the verdict");
        // Park until the parent closes stdin, holding the reservation.
        let mut sink = String::new();
        let _ = std::io::stdin().lock().read_line(&mut sink);
        std::process::exit(0);
    }

    let dir = tempfile::tempdir().expect("tempdir");
    let exe = std::env::current_exe().expect("this test binary");
    let mut children: Vec<Child> = (0..HELPERS)
        .map(|_| {
            Command::new(&exe)
                .args([
                    "--exact",
                    "the_admission_ledger_is_atomic_across_processes",
                    "--nocapture",
                ])
                .env("VF_ADMISSION_HELPER_DIR", dir.path())
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn a contending helper")
        })
        .collect();

    // Read every verdict BEFORE releasing anyone: at this point all six are
    // alive and every admitted reservation is still held.
    let admitted: u32 = children
        .iter_mut()
        .map(|child| {
            use std::io::{BufRead, BufReader};
            let stdout = child.stdout.take().expect("helper stdout");
            BufReader::new(stdout)
                .lines()
                .map_while(Result::ok)
                .find_map(|line| line.strip_prefix(VERDICT_TAG).map(str::to_owned))
                .expect("a helper reported its verdict before parking")
                .trim()
                .parse::<u32>()
                .expect("a helper verdict")
        })
        .sum();

    assert_eq!(
        admitted,
        BUDGET,
        "{HELPERS} processes asked for {} between them against a budget of {BUDGET}: exactly \
         the budget may be admitted, and every refusal past it is the lock doing its job",
        HELPERS * EACH
    );

    let ledger = AdmissionLedger::at(
        dir.path().join("custody-admission.v1.json"),
        BUDGET,
        "the-observer",
    );
    assert_eq!(
        ledger.machine_total().expect("total"),
        BUDGET,
        "the file agrees with the helpers' own arithmetic while they still hold it"
    );

    // Release them, and the budget must come back — through liveness alone, as
    // it would after a crash: no helper releases anything before it exits.
    for child in &mut children {
        drop(child.stdin.take());
    }
    for child in &mut children {
        child.wait().expect("await helper");
    }
    assert_eq!(
        ledger.machine_total().expect("total"),
        0,
        "every helper has exited without releasing, so reaping is the only thing that can \
         give a crashed pair's budget back — and it must"
    );
}
