//! The presentation PUMP — one per activation (terminal-pipeline-v3 §8): the
//! engine's TRF1 packets → envelope units on the frames leg, under the BYTES
//! credit ledger, with seed + ONE catch-up convergence and the oversized /
//! starved path as transfers.
//!
//! The rules, as built:
//! - Stamps are OURS: `sceneRevision` = the TRF1 `revision` (the model's content
//!   revision, monotonic within a `sceneEpoch` = {cellBootId, session epoch});
//!   a unit's `baseContent` is the revision the pump last SENT (the worker's
//!   eventual current — the socket is ordered), its `resultContent` the frame's.
//! - Seed = `Session::refresh()` (a forced FULL frame, catalog reset) sent as
//!   a `seed` transfer with `baseContent = null`; then ordinary deltas flow in
//!   the engine's own order, so the lineage holds.
//! - Any DROPPED frame (credit starvation, a hub lag, demand gone and back)
//!   breaks the lineage — so the pump marks `needs_full`, drops every further
//!   delta (COALESCING — the model keeps updating, the mailbox does not grow),
//!   and repairs with ONE `catchup` transfer (another forced full frame, `base`
//!   = last sent, `result` = the new revision) once credit allows. A full frame
//!   is exactly the spec's "coalesced delta bounded by the model".
//! - A transfer is CHUNKED to `maxChunkBytes` and always COMPLETES: a starved
//!   chunk waits for credit. Past `maxActivationCatchupMs` with nothing
//!   admissible the pump SAYS so — `presentation: stopped{overload}`, once per
//!   stall — and keeps waiting: overload is a STATE the returning credit
//!   recovers (the table puts the activation back to presenting once a unit
//!   sent after the stop is applied), never the pump's end (C3: a pump that
//!   returned there would leave `pump_running` set with nothing to restart
//!   it, and the stop permanent).
//! - An oversized catalog-reset frame is already self-contained: transfer it
//!   directly. Refreshing in response would make two viewers refresh each other.
//! - Frames for other sessions on a shared hub are skipped by handle; the
//!   worker validates the TRF1 identity it was told at attach (`trfIdentity`).

use super::activation::{LegRef, Outbound, UnitClass};
use super::crc32c::crc32c;
use super::source::Trf1Header;
use super::wire::{encode_envelope, SceneContentStamp, SceneEpoch};
use ghosttea::{FrameHub, Session};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::sync::Notify;

/// The door, as the pump sees it.
pub trait PumpHost: Send + Sync + 'static {
    /// Admit `bytes` of `class` for this activation on its frames connection
    /// (mutating: the bytes are charged to both windows when Admitted). Bulk
    /// leaves the urgent reserve; urgent draws the full connection window.
    fn try_admit(
        &self,
        connection_id: u64,
        activation_id: &str,
        bytes: u64,
        class: UnitClass,
    ) -> Admission;
    /// Would `bytes` of `class` be admissible right now? It charges nothing (the
    /// pump asks before forcing the engine to render a full frame nobody can
    /// receive), but it records a refusal, so the credit that returns wakes this
    /// pump: a credit move wakes only a refused account's pump.
    fn can_admit(
        &self,
        connection_id: u64,
        activation_id: &str,
        bytes: u64,
        class: UnitClass,
    ) -> Admission;
    /// A unit (a delta or a whole transfer) was sent ending at `revision`.
    fn unit_sent(&self, activation_id: &str, revision: u64, seed: bool);
    /// The pump could not converge within the bound. Said once per stall; the
    /// pump keeps waiting for the credit that recovers it.
    fn presentation_stopped(&self, activation_id: &str, reason: &'static str);
    /// The live view's (attachment epoch, repair generation). A changed pair
    /// requires a whole scene, including changes whose wakes coalesced.
    fn scene_generation(&self, activation_id: &str) -> Option<(u64, u64)>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    Admitted,
    Starved,
    /// the activation or its ledger is gone — the pump ends
    Gone,
}

/// Everything a pump needs, fixed at start.
pub struct PumpStart {
    pub activation_id: String,
    pub session_id: String,
    pub lease_epoch: u64,
    pub connection_id: u64,
    pub credit_epoch: u64,
    pub frames: LegRef,
    pub session: Arc<Session>,
    pub hub: FrameHub,
    pub session_handle: u64,
    pub scene_epoch: SceneEpoch,
    pub max_chunk_bytes: usize,
    /// a delta larger than this is not an urgent incremental — it becomes a
    /// (bulk) catch-up transfer (§8, TP-S3d).
    pub max_urgent_unit_bytes: u64,
    pub seed_wait: Duration,
    pub catchup_bound: Duration,
}

pub struct PumpHandle {
    pub notify: Arc<Notify>,
    pub stop: Arc<AtomicBool>,
    pub task: tokio::task::JoinHandle<()>,
}

impl PumpHandle {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Release);
        self.notify.notify_one();
    }
}

pub fn spawn_pump<H: PumpHost>(host: Arc<H>, start: PumpStart) -> PumpHandle {
    let notify = Arc::new(Notify::new());
    let stop = Arc::new(AtomicBool::new(false));
    let task = tokio::spawn(run_pump(host, start, notify.clone(), stop.clone()));
    PumpHandle { notify, stop, task }
}

struct Pump<H: PumpHost> {
    host: Arc<H>,
    start: PumpStart,
    /// `start.activation_id`, shared: every unit the writer queues names it.
    activation: Arc<str>,
    notify: Arc<Notify>,
    stop: Arc<AtomicBool>,
    activation_sequence: u64,
    /// the revision the worker will hold once it applies everything sent
    last_sent: Option<u64>,
    first_seed: bool,
    transfer_counter: u64,
}

enum Step {
    Continue,
    /// The full frame did not come: the lineage still needs one — ask again.
    Retry,
    End,
}

async fn run_pump<H: PumpHost>(
    host: Arc<H>,
    start: PumpStart,
    notify: Arc<Notify>,
    stop: Arc<AtomicBool>,
) {
    let (mut rx, _baseline) = start.hub.subscribe();
    let activation: Arc<str> = Arc::from(start.activation_id.as_str());
    let mut pump = Pump {
        host,
        start,
        activation,
        notify,
        stop,
        activation_sequence: 0,
        last_sent: None,
        first_seed: true,
        transfer_counter: 0,
    };
    let mut needs_full = true;
    let mut last_scene_generation = None;
    loop {
        if pump.stop.load(Ordering::Acquire) {
            break;
        }
        let scene_generation = pump.host.scene_generation(&pump.start.activation_id);
        if scene_generation != last_scene_generation {
            needs_full = true;
            last_scene_generation = scene_generation;
        }
        // Corrected 2026-10-30: watching only the live bit missed a none ->
        // live cycle whose wakes coalesced before this task ran. The attachment
        // epoch remembers that break, so a new consumer receives a whole scene.
        if scene_generation.is_none() {
            needs_full = true;
            tokio::select! {
                _ = pump.notify.notified() => {}
                r = rx.recv() => match r {
                    Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            continue;
        }
        if needs_full {
            match pump.full_frame(&mut rx).await {
                Step::Continue => {
                    needs_full = false;
                    continue;
                }
                Step::Retry => continue,
                Step::End => break,
            }
        }
        tokio::select! {
            _ = pump.notify.notified() => { /* demand/credit moved — re-evaluate */ }
            r = rx.recv() => match r {
                Err(broadcast::error::RecvError::Lagged(_)) => { needs_full = true; }
                Err(broadcast::error::RecvError::Closed) => break,
                Ok(packet) => {
                    if packet.session_handle != pump.start.session_handle {
                        continue;
                    }
                    // The frame and the wake can both be ready. Re-check the
                    // attachment before sending a delta, including a whole
                    // none -> live cycle that happened while select waited.
                    let scene_generation = pump.host.scene_generation(&pump.start.activation_id);
                    if scene_generation.is_none() || scene_generation != last_scene_generation {
                        needs_full = true;
                        continue;
                    }
                    let Some(header) = Trf1Header::parse(&packet) else { continue };
                    // A refresh from another viewer is already self-contained.
                    // Reuse it instead of forcing a second refresh: otherwise
                    // two viewers of a large idle pane refresh each other forever.
                    if packet.len() as u64 > pump.start.max_urgent_unit_bytes
                        && header.full_snapshot && header.glyph_catalog_reset
                    {
                        if matches!(pump.transfer(&packet, &header).await, Step::End) {
                            break;
                        }
                        continue;
                    }
                    match pump.delta(&packet, &header) {
                        Ok(true) => {}
                        Ok(false) => { needs_full = true; }
                        Err(()) => break,
                    }
                }
            }
        }
    }
}

impl<H: PumpHost> Pump<H> {
    fn stamp(&self, revision: u64) -> SceneContentStamp {
        SceneContentStamp {
            scene_epoch: self.start.scene_epoch.clone(),
            scene_revision: revision,
        }
    }

    fn next_sequence(&mut self) -> u64 {
        self.activation_sequence += 1;
        self.activation_sequence
    }

    fn header(&mut self, kind: &str) -> Value {
        json!({
            "creditEpoch": self.start.credit_epoch,
            "activationSequence": self.next_sequence(),
            "sessionId": self.start.session_id,
            "activationId": self.start.activation_id,
            "leaseEpoch": self.start.lease_epoch,
            "kind": kind,
        })
    }

    /// One ordinary unit: a TRF1 frame (delta, or a full frame the engine
    /// emitted on its own) wrapped as `trf1-frame`. Ok(true) = sent, Ok(false)
    /// = starved (dropped; the lineage needs a full), Err = the activation is gone.
    fn delta(&mut self, packet: &[u8], header: &Trf1Header) -> Result<bool, ()> {
        // An oversized incremental is NOT an urgent unit — drop the lineage here
        // and let the bounded catch-up transfer (bulk, chunked) carry it (§8,
        // TP-S3d). Checked on the payload, before a sequence is spent.
        if packet.len() as u64 > self.start.max_urgent_unit_bytes {
            return Ok(false);
        }
        let mut h = self.header("trf1-frame");
        h["baseContent"] = match self.last_sent {
            Some(rev) => serde_json::to_value(self.stamp(rev)).unwrap(),
            None => Value::Null,
        };
        h["resultContent"] = serde_json::to_value(self.stamp(header.revision)).unwrap();
        let unit = encode_envelope(&h, packet);
        // A delta is an URGENT incremental: it may draw the full connection window
        // and rides the writer's urgent lane, ahead of any bulk transfer.
        match self.host.try_admit(
            self.start.connection_id,
            &self.start.activation_id,
            unit.len() as u64,
            UnitClass::Urgent,
        ) {
            Admission::Admitted => {
                let unit = Outbound::Binary(unit, Some(self.activation.clone()));
                if self.start.frames.out.send(unit).is_err() {
                    return Err(());
                }
                self.last_sent = Some(header.revision);
                self.host
                    .unit_sent(&self.start.activation_id, header.revision, false);
                Ok(true)
            }
            Admission::Starved => Ok(false),
            Admission::Gone => Err(()),
        }
    }

    /// Force a FULL frame from the engine and send it as a transfer (seed the
    /// first time, catch-up after). Waits for credit per chunk (overload said
    /// past the bound, the wait kept).
    async fn full_frame(&mut self, rx: &mut broadcast::Receiver<ghosttea::FramePacket>) -> Step {
        // Wait for admissible credit BEFORE forcing the engine: a refresh with
        // nowhere to send it would only churn the model.
        let minimal = self.start.max_chunk_bytes.min(4096) as u64;
        if self.wait_for_credit(minimal).await.is_err() {
            return Step::End;
        }
        if self.start.session.refresh().is_err() {
            return Step::End;
        }
        // The forced full frame is in the hub now (publish is synchronous);
        // skip anything older in the channel and take the first FULL frame.
        let deadline = tokio::time::Instant::now() + self.start.seed_wait;
        let packet = loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            match tokio::time::timeout(remaining, rx.recv()).await {
                Err(_) => {
                    // The forced frame never reached us: the receiver lagged past
                    // it, or the engine was too busy to render one in time. Say
                    // so and ask again (at most one refresh per `seed_wait`) —
                    // ending here would leave the activation stopped for good (C3).
                    self.host
                        .presentation_stopped(&self.start.activation_id, "overload");
                    return Step::Retry;
                }
                Ok(Err(broadcast::error::RecvError::Closed)) => return Step::End,
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Ok(packet)) => {
                    if packet.session_handle != self.start.session_handle {
                        continue;
                    }
                    if Trf1Header::parse(&packet)
                        .is_some_and(|h| h.full_snapshot && h.glyph_catalog_reset)
                    {
                        break packet;
                    }
                }
            }
        };
        let header = Trf1Header::parse(&packet).expect("checked above");
        self.transfer(&packet, &header).await
    }

    /// Send a self-contained frame without asking the engine to shape it again.
    async fn transfer(&mut self, packet: &[u8], header: &Trf1Header) -> Step {
        let kind = if self.first_seed { "seed" } else { "catchup" };
        let bytes = packet;
        let total = bytes.len();
        let chunk = self.start.max_chunk_bytes.max(1);
        let chunk_count = total.div_ceil(chunk).max(1);
        self.transfer_counter += 1;
        let transfer_id = format!("{}-{}", self.start.activation_id, self.transfer_counter);
        let result = serde_json::to_value(self.stamp(header.revision)).unwrap();
        let base = match (kind, self.last_sent) {
            ("seed", _) => Value::Null,
            (_, Some(rev)) => serde_json::to_value(self.stamp(rev)).unwrap(),
            (_, None) => Value::Null,
        };
        // begin
        let mut begin = self.header("transfer-begin");
        begin["baseContent"] = base;
        begin["resultContent"] = result.clone();
        begin["transfer"] = json!({
            "transferId": transfer_id,
            "kind": kind,
            "totalBytes": total,
            "chunkCount": chunk_count,
            "targetLayout": {
                "cols": header.cols, "rows": header.rows,
                "scrollbackRows": Trf1Header::scrollback_rows(bytes).unwrap_or(0),
            },
            "checksum": { "alg": "crc32c", "value": crc32c(bytes) },
        });
        if self
            .send_admitted(encode_envelope(&begin, &[]))
            .await
            .is_err()
        {
            return Step::End;
        }
        // chunks
        for (index, slice) in bytes.chunks(chunk).enumerate() {
            let mut h = self.header("transfer-chunk");
            h["transfer"] = json!({
                "transferId": transfer_id,
                "chunkIndex": index,
                "byteOffset": index * chunk,
            });
            if self
                .send_admitted(encode_envelope(&h, slice))
                .await
                .is_err()
            {
                return Step::End;
            }
        }
        if total == 0 {
            // an empty frame cannot happen (64-byte header), but the wire
            // contract allows a zero-chunk transfer: begin + end
        }
        // end
        let mut end = self.header("transfer-end");
        end["transfer"] = json!({ "transferId": transfer_id });
        if self
            .send_admitted(encode_envelope(&end, &[]))
            .await
            .is_err()
        {
            return Step::End;
        }
        self.last_sent = Some(header.revision);
        let seed = self.first_seed;
        self.first_seed = false;
        self.host
            .unit_sent(&self.start.activation_id, header.revision, seed);
        Step::Continue
    }

    /// Block until `bytes` of BULK WOULD be admissible (past the bound the pump
    /// says overload and waits on — `starved`). It charges nothing: the real
    /// charge happens when the unit is sent.
    async fn wait_for_credit(&self, bytes: u64) -> Result<(), ()> {
        let mut deadline = Some(tokio::time::Instant::now() + self.start.catchup_bound);
        loop {
            match self.host.can_admit(
                self.start.connection_id,
                &self.start.activation_id,
                bytes,
                UnitClass::Bulk,
            ) {
                Admission::Admitted => return Ok(()),
                Admission::Starved => self.starved(&mut deadline).await?,
                Admission::Gone => return Err(()),
            }
        }
    }

    /// One starved wait (§8): parked until a `WakePump` (credit returned,
    /// demand moved), the stop flag, or the convergence bound. When the bound
    /// passes with nothing admissible the pump SAYS so — `presentation:
    /// stopped{overload}`, once for this wait — and then waits with no bound:
    /// the credit that returns is what recovers it (C3), and a dead leg ends
    /// the pump through `Gone`, the stop flag or the writer's closed semaphore,
    /// never through this. `Err` = the pump was stopped.
    async fn starved(&self, deadline: &mut Option<tokio::time::Instant>) -> Result<(), ()> {
        if self.stop.load(Ordering::Acquire) {
            return Err(());
        }
        let Some(at) = *deadline else {
            self.notify.notified().await;
            return Ok(());
        };
        let remaining = at.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            self.host
                .presentation_stopped(&self.start.activation_id, "overload");
            *deadline = None;
            return Ok(());
        }
        let _ = tokio::time::timeout(remaining, self.notify.notified()).await;
        Ok(())
    }

    /// Send one BULK transfer envelope once admitted (waiting for credit; past
    /// the bound the pump says overload and waits on — `starved`), then behind
    /// the writer's bulk-ahead backpressure. Credit is charged first; only once
    /// admitted do we acquire the writer permits — so a credit-starved loop
    /// never leaks bulk permits.
    async fn send_admitted(&mut self, unit: Vec<u8>) -> Result<(), ()> {
        let mut deadline = Some(tokio::time::Instant::now() + self.start.catchup_bound);
        loop {
            match self.host.try_admit(
                self.start.connection_id,
                &self.start.activation_id,
                unit.len() as u64,
                UnitClass::Bulk,
            ) {
                Admission::Admitted => break,
                Admission::Starved => self.starved(&mut deadline).await?,
                Admission::Gone => return Err(()),
            }
        }
        // Bulk-ahead backpressure (`maxBulkBytesAdmittedAhead`): acquire a chunk's
        // worth of writer permits and FORGET them; the writer returns them as it
        // writes the chunk. A CLOSED semaphore means the socket's writer exited —
        // end the pump rather than block forever.
        if let Some(sem) = &self.start.frames.bulk_credit {
            match sem.acquire_many(unit.len() as u32).await {
                Ok(permit) => permit.forget(),
                Err(_) => return Err(()),
            }
        }
        self.start
            .frames
            .out
            .send(Outbound::Bulk(unit, self.activation.clone()))
            .map_err(|_| ())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use ghosttea::session::{Persistence, SpawnOptions};
    use ghosttea::{SessionEnvironment, SessionProgramKind, TerminationSource, TextEngine};
    use std::collections::HashMap;
    use std::sync::atomic::AtomicUsize;
    use std::sync::Mutex;

    struct ReadyHost {
        seeds: AtomicUsize,
        view_epoch: AtomicUsize,
    }

    impl Default for ReadyHost {
        fn default() -> Self {
            Self {
                seeds: AtomicUsize::new(0),
                view_epoch: AtomicUsize::new(1),
            }
        }
    }

    impl PumpHost for ReadyHost {
        fn try_admit(&self, _: u64, _: &str, _: u64, _: UnitClass) -> Admission {
            Admission::Admitted
        }
        fn can_admit(&self, _: u64, _: &str, _: u64, _: UnitClass) -> Admission {
            Admission::Admitted
        }
        fn unit_sent(&self, _: &str, _: u64, seed: bool) {
            if seed {
                self.seeds.fetch_add(1, Ordering::SeqCst);
            }
        }
        fn presentation_stopped(&self, _: &str, reason: &'static str) {
            panic!("unexpected stop: {reason}");
        }
        fn scene_generation(&self, _: &str) -> Option<(u64, u64)> {
            let epoch = self.view_epoch.load(Ordering::SeqCst) as u64;
            (epoch != 0).then_some((epoch, 0))
        }
    }

    /// The control reader can process none -> live before the pump runs again.
    /// Notify coalesces those wakes; observing only the final live bit loses the
    /// repair needed by the new consumer, which no longer holds the old base.
    #[tokio::test]
    async fn a_coalesced_park_and_reattach_sends_a_catchup_before_any_delta() {
        let hub = FrameHub::new(32);
        let session = idle_session(&hub);
        let host = Arc::new(ReadyHost::default());
        let (out, mut received) = tokio::sync::mpsc::unbounded_channel();
        let pump = spawn_pump(
            host.clone(),
            PumpStart {
                activation_id: "coalesced-reattach".into(),
                session_id: session.id(),
                lease_epoch: 0,
                connection_id: 1,
                credit_epoch: 1,
                frames: LegRef {
                    connection_id: 1,
                    leg_generation: 1,
                    out,
                    bulk_credit: None,
                    geometry_events: false,
                    selection_credit: None,
                },
                session: session.clone(),
                hub: hub.clone(),
                session_handle: session.summary().handle.parse().unwrap(),
                scene_epoch: SceneEpoch {
                    cell_boot_id: "coalesced-reattach-test".into(),
                    model_generation: 1,
                },
                max_chunk_bytes: 1024,
                max_urgent_unit_bytes: 1 << 20,
                seed_wait: Duration::from_secs(5),
                catchup_bound: Duration::from_secs(5),
            },
        );
        let seed_end = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if let Outbound::Binary(bytes, _) | Outbound::Bulk(bytes, _) =
                    received.recv().await.unwrap()
                {
                    let (header, _) = super::super::wire::decode_envelope(&bytes).unwrap();
                    if header["kind"] == "transfer-end" {
                        break header["activationSequence"].as_u64().unwrap();
                    }
                }
            }
        })
        .await
        .unwrap();

        // No await between the two edges: the current-thread pump cannot see
        // the parked state. A reattach refresh competes with the coalesced wake.
        host.view_epoch.store(0, Ordering::SeqCst);
        pump.notify.notify_one();
        host.view_epoch.store(2, Ordering::SeqCst);
        pump.notify.notify_one();
        session.refresh().unwrap();
        let next = tokio::time::timeout(Duration::from_secs(10), received.recv())
            .await
            .unwrap()
            .unwrap();
        pump.stop();
        pump.task.await.unwrap();
        session.terminate(TerminationSource::User).unwrap();

        let bytes = match next {
            Outbound::Binary(bytes, _) | Outbound::Bulk(bytes, _) => bytes,
            _ => panic!("expected a presentation unit"),
        };
        let (header, _) = super::super::wire::decode_envelope(&bytes).unwrap();
        assert_eq!(
            header["kind"], "transfer-begin",
            "a new consumer needs a whole scene"
        );
        assert_eq!(header["transfer"]["kind"], "catchup");
        assert_eq!(header["activationSequence"].as_u64(), Some(seed_end + 1));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn two_viewers_reuse_oversized_refreshes_without_feedback() {
        let hub = FrameHub::new(32);
        let session = Session::spawn(
            SpawnOptions {
                creation_id: None,
                executable: "/bin/sh".into(),
                args: vec!["-c".into(), "exec sleep 30".into()],
                cwd: None,
                env: HashMap::new(),
                environment: Some(SessionEnvironment::Clean {
                    variables: HashMap::from([("PATH".into(), "/usr/bin:/bin".into())]),
                }),
                cols: 120,
                rows: 40,
                persistence: Persistence::KeepUntilExit,
                program_kind: SessionProgramKind::Application,
                owner_id: None,
                scrollback_bytes: None,
            },
            hub.clone(),
            Arc::new(Mutex::new(TextEngine::discover().unwrap())),
            Arc::new(|_, _| {}),
        )
        .unwrap();
        let (mut frames, _) = hub.subscribe();
        session.refresh().unwrap();
        let header = Trf1Header::parse(&frames.recv().await.unwrap()).unwrap();
        let host = Arc::new(ReadyHost::default());
        let (out, mut received) = tokio::sync::mpsc::unbounded_channel();
        let drain = tokio::spawn(async move { while received.recv().await.is_some() {} });
        let mut pumps = Vec::new();
        for viewer in 1..=2 {
            pumps.push(spawn_pump(
                host.clone(),
                PumpStart {
                    activation_id: format!("viewer-{viewer}"),
                    session_id: session.id(),
                    lease_epoch: 0,
                    connection_id: viewer,
                    credit_epoch: 1,
                    frames: LegRef {
                        connection_id: viewer,
                        leg_generation: 1,
                        out: out.clone(),
                        bulk_credit: None,
                        geometry_events: false,
                        selection_credit: None,
                    },
                    session: session.clone(),
                    hub: hub.clone(),
                    session_handle: header.session_handle,
                    scene_epoch: SceneEpoch {
                        cell_boot_id: "oversize-test".into(),
                        model_generation: header.session_epoch,
                    },
                    max_chunk_bytes: 1024,
                    // Force the oversized path independently of fonts/frame size.
                    max_urgent_unit_bytes: 1,
                    seed_wait: Duration::from_secs(5),
                    catchup_bound: Duration::from_secs(5),
                },
            ));
        }
        tokio::time::timeout(Duration::from_secs(10), async {
            while host.seeds.load(Ordering::SeqCst) < 2 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let before = hub.current_ordinal();
        tokio::time::sleep(Duration::from_millis(200)).await;
        let after = hub.current_ordinal();
        for pump in pumps {
            pump.stop();
            pump.task.await.unwrap();
        }
        drain.abort();
        session.terminate(TerminationSource::User).unwrap();
        assert_eq!(
            after, before,
            "idle viewers must not manufacture engine frames"
        );
    }

    /// An idle `/bin/sh` on its own hub — nothing prints unless asked.
    fn idle_session(hub: &FrameHub) -> Arc<Session> {
        Session::spawn(
            SpawnOptions {
                creation_id: None,
                executable: "/bin/sh".into(),
                args: vec!["-c".into(), "exec sleep 30".into()],
                cwd: None,
                env: HashMap::new(),
                environment: Some(SessionEnvironment::Clean {
                    variables: HashMap::from([("PATH".into(), "/usr/bin:/bin".into())]),
                }),
                cols: 80,
                rows: 24,
                persistence: Persistence::KeepUntilExit,
                program_kind: SessionProgramKind::Application,
                owner_id: None,
                scrollback_bytes: None,
            },
            hub.clone(),
            Arc::new(Mutex::new(TextEngine::discover().unwrap())),
            Arc::new(|_, _| {}),
        )
        .unwrap()
    }

    async fn wait_until(what: &str, mut done: impl FnMut() -> bool) {
        tokio::time::timeout(Duration::from_secs(10), async {
            while !done() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("timeout: {what}"));
    }

    /// A door whose credit is withheld until the test opens it.
    #[derive(Default)]
    struct WithheldCredit {
        open: AtomicBool,
        stops: AtomicUsize,
        seeds: AtomicUsize,
    }

    impl WithheldCredit {
        fn admission(&self) -> Admission {
            if self.open.load(Ordering::SeqCst) {
                Admission::Admitted
            } else {
                Admission::Starved
            }
        }
    }

    impl PumpHost for WithheldCredit {
        fn try_admit(&self, _: u64, _: &str, _: u64, _: UnitClass) -> Admission {
            self.admission()
        }
        fn can_admit(&self, _: u64, _: &str, _: u64, _: UnitClass) -> Admission {
            self.admission()
        }
        fn unit_sent(&self, _: &str, _: u64, seed: bool) {
            if seed {
                self.seeds.fetch_add(1, Ordering::SeqCst);
            }
        }
        fn presentation_stopped(&self, _: &str, reason: &'static str) {
            assert_eq!(reason, "overload");
            self.stops.fetch_add(1, Ordering::SeqCst);
        }
        fn scene_generation(&self, _: &str) -> Option<(u64, u64)> {
            Some((1, 0))
        }
    }

    /// C3 — credit withheld past the convergence bound: the pump says
    /// `stopped{overload}` ONCE and keeps waiting, parked, never finished —
    /// nothing would restart a pump that returned there. The credit returning
    /// (the door's `WakePump` on a `TransportCredit`) recovers it: the seed it
    /// was holding goes out.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_overload_stop_is_said_once_and_the_returning_credit_recovers_the_pump() {
        let hub = FrameHub::new(32);
        let session = idle_session(&hub);
        let host = Arc::new(WithheldCredit::default());
        let (out, mut received) = tokio::sync::mpsc::unbounded_channel();
        let drain = tokio::spawn(async move { while received.recv().await.is_some() {} });
        let pump = spawn_pump(
            host.clone(),
            PumpStart {
                activation_id: "starved".into(),
                session_id: session.id(),
                lease_epoch: 0,
                connection_id: 1,
                credit_epoch: 1,
                frames: LegRef {
                    connection_id: 1,
                    leg_generation: 1,
                    out,
                    bulk_credit: None,
                    geometry_events: false,
                    selection_credit: None,
                },
                session: session.clone(),
                hub: hub.clone(),
                session_handle: session.summary().handle.parse().unwrap(),
                scene_epoch: SceneEpoch {
                    cell_boot_id: "overload-test".into(),
                    model_generation: 1,
                },
                max_chunk_bytes: 1024,
                max_urgent_unit_bytes: 1 << 20,
                seed_wait: Duration::from_secs(5),
                catchup_bound: Duration::from_millis(100),
            },
        );

        // Past the bound with nothing admissible: the stop is SAID…
        wait_until("the overload stop", || {
            host.stops.load(Ordering::SeqCst) == 1
        })
        .await;
        // …once — four more bounds pass while starved, and the pump is parked,
        // not finished.
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert_eq!(
            host.stops.load(Ordering::SeqCst),
            1,
            "a stall is said once, never once per bound"
        );
        assert!(
            !pump.task.is_finished(),
            "an overload stop is a state, never the pump's end"
        );
        assert_eq!(host.seeds.load(Ordering::SeqCst), 0);

        // The credit returns: the seed the pump was holding goes out.
        host.open.store(true, Ordering::SeqCst);
        pump.notify.notify_one();
        wait_until("the recovered seed", || {
            host.seeds.load(Ordering::SeqCst) == 1
        })
        .await;
        assert_eq!(host.stops.load(Ordering::SeqCst), 1);

        pump.stop();
        pump.task.await.unwrap();
        drain.abort();
        session.terminate(TerminationSource::User).unwrap();
    }
}
