//! Item 198 — a failed accept loses that one connection (the kernel's choice on macOS), never the listener.
//!
//! The door, the management listener and the MeshData bridge each ended on their FIRST failed accept (a `break`),
//! so one transient EMFILE stopped that listener for the floor's life while its unit still read Up: no new door, no
//! fieldd that could re-adopt the floor, no byte plane to attach. The connection whose accept failed is not the
//! listener's to keep: XNU takes it off the queue before it allocates the descriptor, and closes it when that fails
//! (`accept_nocancel`, "Don't put this back on the socket like we used to … Drop the socket."); Linux leaves it
//! queued. So the claim is about the NEXT connection.
//!
//! This row runs the REAL binary at a soft descriptor limit of 64 with the boot raise skipped
//! (`FIELD_NATIVE_TEST_NO_RLIMIT`):
//! 1. Doors ONE at a time, each taken by the floor before the next, until the floor's own count reads 64.
//! 2. While the count reads 64, one TRIGGER connection per listener (door, mgmt, meshdata): its failed accept is the
//!    run. The count is read again after; a ceiling not held on either side fails the row as proving nothing. What
//!    became of each trigger (closed by the kernel, or still waiting) is printed as data, never asserted.
//! 3. The doors close. Then ONE FRESH connection per listener, each timed for up to 30 s: the door's as a door the
//!    floor opens that was not open before (its census wait included), mgmt's as any answer to a request before
//!    hello (so the kept connection is never superseded), the bridge's as HELLO_OK. The verdict asks ≤ 5 s of each,
//!    and that the door and mesh-bridge units read degraded during the run and up after.
//!
//! A connect made after the ceiling (a trigger or a fresh connection) that fails is that leg's OUTCOME, never the
//! row's end: a refused one means no listener is bound at the path, which is the bug's own symptom when a loop that
//! owned its listener ended and dropped it. The row goes on, so a red prints every leg by name.
//!
//! It prints the real times; the floor's descriptors, counted through the product's own gauge
//! (`resource_pressure::open_fd_count_for`) every 100 ms, at each change; and each listener's failed and recovered
//! accepts from the floor's own log, under the retired names and the new ones, so a leg whose accept never failed
//! is visible as such. On any failure the floor is terminated and its root KEPT, its path printed; on a pass the
//! root goes with the row.
#![cfg(unix)]

#[path = "support/native_child.rs"]
mod native_child;

use field_native::pairing;
use field_native::resource_pressure::open_fd_count_for;
use field_native::services::mesh_bridge::{encode_frame, FrameReader, FRAME_HELLO, FRAME_HELLO_OK};
use native_child::{wait_for_native, NativeProcess};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::time::{sleep, timeout, timeout_at, Instant};

/// The soft descriptor limit the floor inherits. Its own boot holds descriptors of its own (24 at rest, TC-D6's
/// measure), so its count reads 64 before the door reaches its MAX_OPEN of 64.
const SOFT_LIMIT: u64 = 64;

/// The most doors the fill opens: the door's MAX_OPEN.
const MOST_DOORS: usize = 64;

/// What the verdict asks of each fresh connection once the doors close.
const SERVED_WITHIN: Duration = Duration::from_secs(5);

/// How long each fresh connection is watched, so a slow serve is timed rather than only missed.
const WATCHED_FOR: Duration = Duration::from_secs(30);

/// How often the floor's descriptors are counted, and how often the kept connection looks again.
const SAMPLE_EVERY: Duration = Duration::from_millis(100);

/// The three listeners by the `component` their accepts log under.
const LISTENERS: [&str; 3] = ["door", "mgmt", "mesh_bridge"];

/// The floor's descriptor count by milliseconds since its spawn, kept only where it changes.
type Samples = Arc<Mutex<Vec<(u128, Option<u64>)>>>;

/// fieldd's management connection, as far as this row needs one.
struct Mgmt {
    reader: tokio::io::Lines<BufReader<tokio::net::unix::OwnedReadHalf>>,
    writer: tokio::net::unix::OwnedWriteHalf,
    next_id: u64,
}

impl Mgmt {
    fn over(stream: UnixStream) -> Self {
        let (read, write) = stream.into_split();
        Self {
            reader: BufReader::new(read).lines(),
            writer: write,
            next_id: 1,
        }
    }

    /// One request and its answer (a result or an error), or `None` when none comes within `within`.
    async fn call(&mut self, method: &str, params: Value, within: Duration) -> Option<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let request = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let line = format!("{request}\n");
        self.writer.write_all(line.as_bytes()).await.ok()?;
        let deadline = Instant::now() + within;
        loop {
            let line = timeout_at(deadline, self.reader.next_line())
                .await
                .ok()?
                .ok()??;
            let value: Value = serde_json::from_str(&line).ok()?;
            // notifications share the socket with answers: correlate by id
            if value.get("id").and_then(Value::as_u64) == Some(id) {
                return Some(value);
            }
        }
    }

    /// Pairs as fieldd does, and says whether the floor answered.
    async fn paired(&mut self, data_dir: &Path, boot_id: &str) -> bool {
        let params = json!({
            "contractsVersion": "0.1.0",
            "minCompatible": "0.1.0",
            "clientKind": "fieldd",
            "credential": credential(data_dir, boot_id),
        });
        let answer = self
            .call("native.lifecycle.hello", params, SERVED_WITHIN)
            .await;
        answer.is_some_and(|answer| answer.get("result").is_some())
    }

    /// What `unit` reads on the floor's health now.
    async fn unit_state(&mut self, unit: &str) -> Option<String> {
        let method = "native.lifecycle.health.subscribe";
        let health = self.call(method, json!({}), Duration::from_secs(2)).await?;
        let units = health["result"]["snapshot"]["units"].as_array()?;
        let found = units.iter().find(|u| u["unit"] == unit)?;
        found["state"].as_str().map(str::to_owned)
    }

    /// Polls the floor's health until `unit` reads `want`, for up to two seconds.
    async fn unit_reads(&mut self, unit: &str, want: &str) -> bool {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if self.unit_state(unit).await.as_deref() == Some(want) {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            sleep(SAMPLE_EVERY).await;
        }
    }

    /// The doors open now, by their connection ids.
    async fn open_doors(&mut self) -> Option<BTreeSet<String>> {
        let method = "native.door.subscribe";
        let answer = self.call(method, json!({}), Duration::from_secs(2)).await?;
        let doors = answer["result"]["snapshot"]["doors"].as_array()?;
        let ids = doors.iter().filter_map(|door| door["connId"].as_str());
        Some(ids.map(str::to_owned).collect())
    }

    /// From the release until `until`: when a door not open before it opens, and when the door and mesh-bridge
    /// units first read up, each as the time since `released`.
    async fn after_release(
        &mut self,
        before: &BTreeSet<String>,
        released: Instant,
        until: Instant,
    ) -> (Option<Duration>, Option<Duration>, Option<Duration>) {
        let (mut door, mut door_up, mut bridge_up) = (None, None, None);
        while Instant::now() < until && (door.is_none() || door_up.is_none() || bridge_up.is_none())
        {
            if door.is_none() {
                let open = self.open_doors().await.unwrap_or_default();
                if open.iter().any(|id| !before.contains(id)) {
                    door = Some(released.elapsed());
                }
            }
            if door_up.is_none() && self.unit_state("door").await.as_deref() == Some("up") {
                door_up = Some(released.elapsed());
            }
            if bridge_up.is_none() && self.unit_state("mesh-bridge").await.as_deref() == Some("up")
            {
                bridge_up = Some(released.elapsed());
            }
            sleep(SAMPLE_EVERY).await;
        }
        (door, door_up, bridge_up)
    }
}

/// A fresh paired credential, MAC'd with the floor's own secret.
fn credential(data_dir: &Path, boot_id: &str) -> Value {
    let secret_hex =
        std::fs::read_to_string(data_dir.join("native/pairing")).expect("read the pairing secret");
    let secret = hex::decode(secret_hex.trim()).expect("decode the pairing secret");
    let ts = pairing::now_epoch_secs();
    json!({"bootId": boot_id, "ts": ts, "mac": pairing::compute_mac(&secret, boot_id, ts)})
}

/// When the MeshData bridge answers a paired HELLO on `stream` with HELLO_OK, as the time since `released`.
async fn bridge_served(
    stream: &mut UnixStream,
    data_dir: &Path,
    released: Instant,
    until: Instant,
) -> Option<Duration> {
    let credential = credential(data_dir, "fieldd-accept-pressure");
    let hello = encode_frame(FRAME_HELLO, 0, credential.to_string().as_bytes()).unwrap();
    stream.write_all(&hello).await.ok()?;
    let mut reader = FrameReader::default();
    let mut buf = vec![0u8; 4096];
    loop {
        let n = match timeout_at(until, stream.read(&mut buf)).await {
            Ok(Ok(n)) if n > 0 => n,
            _ => return None,
        };
        let frames = reader.push(&buf[..n]).ok()?;
        if let Some(frame) = frames.first() {
            return (frame.kind == FRAME_HELLO_OK).then(|| released.elapsed());
        }
    }
}

/// When the management listener answers anything on `probe`, as the time since `released`. The request goes before
/// any hello, so the answer is UNAUTHORIZED and the kept connection is never superseded; any answer means the
/// listener took the connection.
async fn mgmt_served(probe: &mut Mgmt, released: Instant) -> Option<Duration> {
    let answer = probe
        .call("native.lifecycle.ping", json!({}), WATCHED_FOR)
        .await;
    answer.map(|_| released.elapsed())
}

/// Dials `path` after the ceiling. A failed connect is the leg's outcome, never the row's end: a refused one means
/// no listener is bound at the path (the loop that owned it has ended and dropped it).
async fn dial(path: &Path) -> Result<UnixStream, String> {
    UnixStream::connect(path)
        .await
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::ConnectionRefused => {
                "refused at connect (no listener bound)".to_owned()
            }
            _ => format!("its connect failed ({error})"),
        })
}

/// What became of a trigger connection while the floor's accepts failed: closed (EOF or reset; macOS drops a
/// connection whose accept fails for a descriptor), still waiting (Linux keeps it queued, or it was taken), or
/// refused at its connect.
async fn fate(dialed: &mut Result<UnixStream, String>) -> String {
    let stream = match dialed {
        Ok(stream) => stream,
        Err(failed) => return failed.clone(),
    };
    let mut buf = [0u8; 64];
    let seen = match timeout(Duration::from_millis(200), stream.read(&mut buf)).await {
        Ok(Ok(0)) | Ok(Err(_)) => "closed",
        Ok(Ok(_)) => "answered",
        Err(_) => "waiting",
    };
    seen.to_owned()
}

/// Each listener's failed and recovered accepts in the floor's own log, under the retired name
/// (`field_native.<listener>.accept_failed`) and the new ones (`field_native.local_ipc.accept_failing` and
/// `accept_recovered`, by `component`).
fn logged_accepts(log_root: &Path) -> String {
    let log = std::fs::read_to_string(log_root.join("system/field-native.ndjson"));
    let Ok(log) = log else {
        return "unread".to_owned();
    };
    let records: Vec<Value> = log
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let count = |event: &str, component: Option<&str>| {
        let matches = |record: &&Value| {
            record["event"] == event
                && component.is_none_or(|component| record["component"] == component)
        };
        records.iter().filter(matches).count()
    };
    let lines = LISTENERS.map(|listener| {
        format!(
            "{listener}: accept_failed {}, accept_failing {}, accept_recovered {}",
            count(
                format!("field_native.{listener}.accept_failed").as_str(),
                None
            ),
            count("field_native.local_ipc.accept_failing", Some(listener)),
            count("field_native.local_ipc.accept_recovered", Some(listener)),
        )
    });
    lines.join("; ")
}

/// Counts the floor's descriptors every `SAMPLE_EVERY` from `start`, keeping each change.
fn sample(pid: u32, start: Instant) -> (Samples, tokio::task::JoinHandle<()>) {
    let samples: Samples = Arc::new(Mutex::new(Vec::new()));
    let writer = samples.clone();
    let task = tokio::spawn(async move {
        let mut last = None;
        loop {
            let count = open_fd_count_for(pid);
            if last != Some(count) {
                writer
                    .lock()
                    .unwrap()
                    .push((start.elapsed().as_millis(), count));
                last = Some(count);
            }
            sleep(SAMPLE_EVERY).await;
        }
    });
    (samples, task)
}

/// Opens doors one at a time until the floor's count reads the limit, each waited on until the floor has taken it.
/// Returns the doors, how many the floor took, and whether the count read the limit.
async fn fill(pid: u32, door_sock: &Path) -> (Vec<UnixStream>, usize, bool) {
    let mut doors = Vec::new();
    let mut taken = 0;
    while doors.len() < MOST_DOORS {
        let before = open_fd_count_for(pid);
        if before >= Some(SOFT_LIMIT) {
            return (doors, taken, true);
        }
        let door = UnixStream::connect(door_sock).await;
        doors.push(door.expect("connect a door"));
        let deadline = Instant::now() + Duration::from_secs(1);
        while open_fd_count_for(pid) <= before && Instant::now() < deadline {
            sleep(Duration::from_millis(5)).await;
        }
        if open_fd_count_for(pid) > before {
            taken += 1;
        }
    }
    let reached = open_fd_count_for(pid) >= Some(SOFT_LIMIT);
    (doors, taken, reached)
}

fn shown(at: Option<Duration>) -> String {
    at.map_or_else(
        || format!("not within {} s", WATCHED_FOR.as_secs()),
        |at| format!("{} ms", at.as_millis()),
    )
}

/// A fresh connection's outcome for the verdict line: its failed connect, or when it was served.
fn fresh<T>(dialed: &Result<T, String>, at: Option<Duration>) -> String {
    match dialed {
        Err(failed) => failed.clone(),
        Ok(_) => format!("served {}", shown(at)),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_accept_ends_no_listener_and_its_unit_reads_degraded_while_it_retries() {
    let root = tempfile::Builder::new()
        .prefix("vfla")
        .tempdir_in("/tmp")
        .expect("tempdir under /tmp");
    let data_dir = root.path().join("data");
    let log_root = root.path().join("logs");
    let spawned = Instant::now();
    let mut floor = NativeProcess::spawn(&data_dir, &log_root, true, SOFT_LIMIT);
    let pid = floor.id();
    let (samples, sampler) = sample(pid, spawned);
    let mgmt_socket = wait_for_native(&data_dir, &mut floor).await;
    let run = data_dir.join("native/run");
    let (door_sock, bridge_sock) = (run.join("door.sock"), run.join("meshdata.sock"));

    // fieldd's own connection, paired before the trouble: the row reads the units and the doors through it while
    // the floor has no descriptor to give a new one
    let stream = UnixStream::connect(&mgmt_socket)
        .await
        .expect("connect mgmt");
    let mut kept = Mgmt::over(stream);
    assert!(kept.paired(&data_dir, "fieldd-accept-pressure-kept").await);

    // 1. the doors, one at a time, to the ceiling; then every door the floor took is open (each waits its census)
    let (doors, taken, reached) = fill(pid, &door_sock).await;
    let deadline = Instant::now() + Duration::from_secs(5);
    while kept.open_doors().await.map_or(0, |open| open.len()) < taken && Instant::now() < deadline
    {
        sleep(SAMPLE_EVERY).await;
    }

    // 2. one trigger per listener, while the count reads the limit: its failed accept is the run
    let held_before = open_fd_count_for(pid) >= Some(SOFT_LIMIT);
    let mut door_trigger = dial(&door_sock).await;
    let mut mgmt_trigger = dial(&mgmt_socket).await;
    let mut bridge_trigger = dial(&bridge_sock).await;
    sleep(Duration::from_millis(300)).await;
    let held_after = open_fd_count_for(pid) >= Some(SOFT_LIMIT);
    let fates = format!(
        "door {}, mgmt {}, meshdata {}",
        fate(&mut door_trigger).await,
        fate(&mut mgmt_trigger).await,
        fate(&mut bridge_trigger).await,
    );
    let door_degraded = kept.unit_reads("door", "degraded").await;
    let bridge_degraded = kept.unit_reads("mesh-bridge", "degraded").await;
    let before = kept.open_doors().await.unwrap_or_default();

    // 3. the release, then one fresh connection per listener, each timed from the release
    drop(doors);
    let released = Instant::now();
    let until = released + WATCHED_FOR;
    // the fresh door is held open until the row ends: the floor opens it as a door, and the snapshot shows it
    let fresh_door = dial(&door_sock).await;
    let mut fresh_mgmt = dial(&mgmt_socket).await.map(Mgmt::over);
    let mut fresh_bridge = dial(&bridge_sock).await;
    let (bridge_at, mgmt_at, (door_at, door_up_at, bridge_up_at)) = tokio::join!(
        async {
            match &mut fresh_bridge {
                Ok(stream) => bridge_served(stream, &data_dir, released, until).await,
                Err(_) => None,
            }
        },
        async {
            match &mut fresh_mgmt {
                Ok(probe) => mgmt_served(probe, released).await,
                Err(_) => None,
            }
        },
        kept.after_release(&before, released, until),
    );
    sampler.abort();
    let timeline = (samples.lock().unwrap().iter())
        .map(|(ms, count)| {
            format!(
                "{ms}:{}",
                count.map_or_else(|| "?".to_owned(), |c| c.to_string())
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    let released_ms = released.duration_since(spawned).as_millis();

    // the floor ends before its root does (item 196), and before its log is read
    floor.terminate().await;
    let logged = logged_accepts(&log_root);

    let within = |at: Option<Duration>| at.is_some_and(|at| at <= SERVED_WITHIN);
    let shows = reached && held_before && held_after;
    let passed = within(door_at)
        && within(mgmt_at)
        && within(bridge_at)
        && door_degraded
        && bridge_degraded
        && door_up_at.is_some()
        && bridge_up_at.is_some();
    let kept_root = if shows && passed {
        drop(root);
        "removed".to_owned()
    } else {
        format!("KEPT at {}", root.keep().display())
    };
    let readings = format!(
        "doors taken {taken}; the ceiling read at the fill {reached}, before the triggers {held_before}, after them \
         {held_after}; the triggers: {fates}; released at {released_ms} ms; the floor's log: {logged}; the floor's \
         descriptors (ms since spawn:count, each change): {timeline}; the root {kept_root}"
    );
    assert!(
        shows,
        "the floor's {SOFT_LIMIT}-descriptor ceiling was not shown around the triggers, so no accept was shown to \
         fail: this row proves nothing. {readings}"
    );
    assert!(
        passed,
        "a listener did not outlive its failed accept: door: fresh {}, degraded while it retried \
         {door_degraded}, up after {}; mgmt: fresh {}; meshdata: fresh {}, degraded while it retried \
         {bridge_degraded}, up after {}. {readings}",
        fresh(&fresh_door, door_at),
        shown(door_up_at),
        fresh(&fresh_mgmt, mgmt_at),
        fresh(&fresh_bridge, bridge_at),
        shown(bridge_up_at),
    );
}
