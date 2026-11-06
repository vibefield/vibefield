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
    use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};

    struct ReadyHost {
        view_epoch: AtomicUsize,
        /// Every `scene_generation` read: in the door, the registry lock.
        scene_reads: AtomicUsize,
    }

    impl Default for ReadyHost {
        fn default() -> Self {
            Self {
                view_epoch: AtomicUsize::new(1),
                scene_reads: AtomicUsize::new(0),
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
        fn unit_sent(&self, _: &str, _: u64, _: bool) {}
        fn presentation_stopped(&self, _: &str, reason: &'static str) {
            panic!("unexpected stop: {reason}");
        }
        fn scene_generation(&self, _: &str) -> Option<(u64, u64)> {
            self.scene_reads.fetch_add(1, Ordering::SeqCst);
            let epoch = self.view_epoch.load(Ordering::SeqCst) as u64;
            (epoch != 0).then_some((epoch, 0))
        }
    }

    /// The cell's shape (RV #93): idle sessions publishing on ONE hub, as G22's
    /// service publishes every session's frames on its one hub. Every pump in
    /// these rows starts through `start`, so the frame seam is spelled once.
    struct SharedHub {
        hub: FrameHub,
        sessions: Vec<Arc<Session>>,
    }

    impl SharedHub {
        fn new(count: usize) -> Self {
            let hub = FrameHub::new(32);
            let sessions = (0..count).map(|_| idle_session(&hub)).collect();
            Self { hub, sessions }
        }

        /// A pump of `session` whose units go to `out`, on `connection_id`.
        fn start(
            &self,
            activation_id: &str,
            session: &Arc<Session>,
            connection_id: u64,
            out: UnboundedSender<Outbound>,
        ) -> PumpStart {
            PumpStart {
                activation_id: activation_id.into(),
                session_id: session.id(),
                lease_epoch: 0,
                connection_id,
                credit_epoch: 1,
                frames: LegRef {
                    connection_id,
                    leg_generation: 1,
                    out,
                    bulk_credit: None,
                    geometry_events: false,
                    selection_credit: None,
                },
                session: session.clone(),
                hub: self.hub.clone(),
                session_handle: session.summary().handle.parse().unwrap(),
                scene_epoch: SceneEpoch {
                    cell_boot_id: "shared-hub-test".into(),
                    model_generation: 1,
                },
                max_chunk_bytes: 1024,
                max_urgent_unit_bytes: 1 << 20,
                seed_wait: Duration::from_secs(5),
                catchup_bound: Duration::from_secs(5),
            }
        }

        fn terminate(&self) {
            for session in &self.sessions {
                session.terminate(TerminationSource::User).unwrap();
            }
        }
    }

    /// The next presentation unit's envelope header.
    async fn next_unit(received: &mut UnboundedReceiver<Outbound>) -> Value {
        loop {
            let unit = tokio::time::timeout(Duration::from_secs(10), received.recv())
                .await
                .expect("a unit within 10s")
                .expect("the leg's writer is open");
            if let Outbound::Binary(bytes, _) | Outbound::Bulk(bytes, _) = unit {
                let (header, _) = super::super::wire::decode_envelope(&bytes).unwrap();
                return header;
            }
        }
    }

    /// Read `received` up to the next unit of `kind`; its envelope header.
    async fn until_kind(received: &mut UnboundedReceiver<Outbound>, kind: &str) -> Value {
        loop {
            let header = next_unit(received).await;
            if header["kind"] == kind {
                return header;
            }
        }
    }

    /// The control reader can process none -> live before the pump runs again.
    /// Notify coalesces those wakes; observing only the final live bit loses the
    /// repair needed by the new consumer, which no longer holds the old base.
    #[tokio::test]
    async fn a_coalesced_park_and_reattach_sends_a_catchup_before_any_delta() {
        let cell = SharedHub::new(1);
        let session = &cell.sessions[0];
        let host = Arc::new(ReadyHost::default());
        let (out, mut received) = tokio::sync::mpsc::unbounded_channel();
        let start = cell.start("coalesced-reattach", session, 1, out);
        let pump = spawn_pump(host.clone(), start);
        let seed = until_kind(&mut received, "transfer-end").await;
        let seed_end = seed["activationSequence"].as_u64().unwrap();

        // No await between the two edges: the current-thread pump cannot see
        // the parked state. A reattach refresh competes with the coalesced wake.
        host.view_epoch.store(0, Ordering::SeqCst);
        pump.notify.notify_one();
        host.view_epoch.store(2, Ordering::SeqCst);
        pump.notify.notify_one();
        session.refresh().unwrap();
        let next = next_unit(&mut received).await;
        pump.stop();
        pump.task.await.unwrap();
        cell.terminate();

        assert_eq!(
            next["kind"], "transfer-begin",
            "a new consumer needs a whole scene"
        );
        assert_eq!(next["transfer"]["kind"], "catchup");
        assert_eq!(next["activationSequence"].as_u64(), Some(seed_end + 1));
    }

    /// RV #114's guard (the 09-27 defect 2), synced on events rather than on a
    /// quiet window: two idle viewers of one session, every frame oversized.
    /// A refresh one viewer forced is a full catalog-reset frame, already
    /// self-contained, so the other carries it as a transfer and never
    /// refreshes in turn. Each marker below is one engine frame every viewer
    /// carries. A viewer that refreshed in response instead (the reuse branch
    /// reverted) refreshes before its next transfer, and the two refresh each
    /// other forever: the hub's ordinal moves past the markers.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn two_viewers_reuse_oversized_refreshes_without_feedback() {
        const MARKERS: u64 = 3;
        let cell = SharedHub::new(1);
        let session = &cell.sessions[0];
        let host = Arc::new(ReadyHost::default());
        let mut viewers = Vec::new();
        for viewer in 1..=2 {
            let (out, received) = tokio::sync::mpsc::unbounded_channel();
            let start = PumpStart {
                // Force the oversized path independently of fonts/frame size.
                max_urgent_unit_bytes: 1,
                ..cell.start(&format!("viewer-{viewer}"), session, viewer, out)
            };
            viewers.push((spawn_pump(host.clone(), start), received));
        }
        // A viewer's first transfer is its seed, and the refresh it forced came
        // before it: past both seeds, nothing but a marker moves the ordinal.
        for (_, received) in &mut viewers {
            until_kind(received, "transfer-end").await;
        }
        let baseline = cell.hub.current_ordinal();
        for _ in 0..MARKERS {
            session.refresh().unwrap();
            for (_, received) in &mut viewers {
                until_kind(received, "transfer-end").await;
            }
        }
        let advanced = cell.hub.current_ordinal() - baseline;
        for (pump, _) in viewers {
            pump.stop();
            pump.task.await.unwrap();
        }
        cell.terminate();
        assert_eq!(
            advanced, MARKERS,
            "idle viewers must not manufacture engine frames"
        );
    }

    /// RV #93 (native-tp-4): a live pump wakes for its own session's frames
    /// only. On the cell's one shared hub every packet of every session woke
    /// it, and it read the registry (`scene_generation`, the door's lock)
    /// before it filtered by handle. Sixteen of B's frames go first, then one
    /// of A's: the pump reads in order, so A's delta for its marker is out only
    /// after every B packet was seen. Its own frame owes one pre-send re-check,
    /// plus the loop-head reads around it.
    #[tokio::test]
    async fn a_live_pump_never_wakes_for_another_sessions_frames() {
        let cell = SharedHub::new(2);
        let (a, b) = (&cell.sessions[0], &cell.sessions[1]);
        let host = Arc::new(ReadyHost::default());
        let (out, mut received) = tokio::sync::mpsc::unbounded_channel();
        let pump = spawn_pump(host.clone(), cell.start("live-a", a, 1, out));
        until_kind(&mut received, "transfer-end").await;
        host.scene_reads.store(0, Ordering::SeqCst);

        for _ in 0..16 {
            b.refresh().unwrap();
        }
        a.refresh().unwrap();
        until_kind(&mut received, "trf1-frame").await;
        let reads = host.scene_reads.load(Ordering::SeqCst);
        pump.stop();
        pump.task.await.unwrap();
        cell.terminate();

        assert!(
            reads <= 3,
            "A read the registry {reads} times for one frame of its own: B's frames woke it"
        );
    }

    /// RV #93 (native-tp-4): a parked pump (demand none) holds no subscription,
    /// so no frame wakes it. On the shared hub it woke for every packet of
    /// every session, only to read the registry and park again. Going live
    /// subscribes before the forced refresh, so the catch-up it owes goes out.
    #[tokio::test]
    async fn a_parked_pump_holds_no_subscription_and_never_wakes() {
        let cell = SharedHub::new(2);
        let (a, b) = (&cell.sessions[0], &cell.sessions[1]);
        let host = Arc::new(ReadyHost::default());
        let (out, mut received) = tokio::sync::mpsc::unbounded_channel();
        let pump = spawn_pump(host.clone(), cell.start("parked-a", a, 1, out));
        until_kind(&mut received, "transfer-end").await;

        // Park. Current-thread: once the pump has read `None` it runs on to
        // its wait before this task is polled again.
        let live_reads = host.scene_reads.load(Ordering::SeqCst);
        host.view_epoch.store(0, Ordering::SeqCst);
        pump.notify.notify_one();
        while host.scene_reads.load(Ordering::SeqCst) == live_reads {
            tokio::task::yield_now().await;
        }
        host.scene_reads.store(0, Ordering::SeqCst);

        for _ in 0..2 {
            for _ in 0..8 {
                b.refresh().unwrap();
            }
            tokio::task::yield_now().await;
        }
        let parked_reads = host.scene_reads.load(Ordering::SeqCst);

        host.view_epoch.store(2, Ordering::SeqCst);
        pump.notify.notify_one();
        let begin = until_kind(&mut received, "transfer-begin").await;
        until_kind(&mut received, "transfer-end").await;
        pump.stop();
        pump.task.await.unwrap();
        cell.terminate();

        assert_eq!(
            parked_reads, 0,
            "B's frames woke a parked pump: it held a subscription"
        );
        assert_eq!(begin["transfer"]["kind"], "catchup");
    }

    /// An idle `/bin/sh` publishing on `hub`: nothing prints unless asked.
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
        let cell = SharedHub::new(1);
        let session = &cell.sessions[0];
        let host = Arc::new(WithheldCredit::default());
        let (out, mut received) = tokio::sync::mpsc::unbounded_channel();
        let drain = tokio::spawn(async move { while received.recv().await.is_some() {} });
        let start = PumpStart {
            catchup_bound: Duration::from_millis(100),
            ..cell.start("starved", session, 1, out)
        };
        let pump = spawn_pump(host.clone(), start);

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
        cell.terminate();
    }

    /// The seed's door: it admits the seed's `transfer-begin`, then starves
    /// every unit until the test opens it.
    #[derive(Default)]
    struct GatedCredit {
        begun: AtomicBool,
        open: AtomicBool,
    }

    impl PumpHost for GatedCredit {
        fn try_admit(&self, _: u64, _: &str, _: u64, _: UnitClass) -> Admission {
            if self.open.load(Ordering::SeqCst) || !self.begun.swap(true, Ordering::SeqCst) {
                Admission::Admitted
            } else {
                Admission::Starved
            }
        }
        fn can_admit(&self, _: u64, _: &str, _: u64, _: UnitClass) -> Admission {
            Admission::Admitted
        }
        fn unit_sent(&self, _: &str, _: u64, _: bool) {}
        fn presentation_stopped(&self, _: &str, reason: &'static str) {
            panic!("unexpected stop: {reason}");
        }
        fn scene_generation(&self, _: &str) -> Option<(u64, u64)> {
            Some((1, 0))
        }
    }

    /// RV #116 (native-tp-1, rv-hub-lag A): while A's seed waits on credit, a
    /// neighbour's burst is not A's loss. On the shared hub A's receiver lagged
    /// past its 32 slots on B's frames alone, and the lag forced a catch-up: a
    /// refresh and a catalog reset for every viewer of A. Routed, A's feed holds
    /// only A's frames, and the router drains each batch of B's as it comes.
    #[tokio::test]
    async fn a_neighbours_burst_while_a_transfer_waits_on_credit_is_not_this_sessions_loss() {
        let cell = SharedHub::new(2);
        let (a, b) = (&cell.sessions[0], &cell.sessions[1]);
        let host = Arc::new(GatedCredit::default());
        let (out, mut received) = tokio::sync::mpsc::unbounded_channel();
        let start = PumpStart {
            // the wait is the test's own: the bound must never fire inside it
            catchup_bound: Duration::from_secs(60),
            ..cell.start("waiting-a", a, 1, out)
        };
        let pump = spawn_pump(host.clone(), start);
        // The seed's begin is admitted, and its first chunk waits on credit.
        until_kind(&mut received, "transfer-begin").await;

        for _ in 0..8 {
            for _ in 0..8 {
                b.refresh().unwrap();
            }
            tokio::task::yield_now().await;
        }
        host.open.store(true, Ordering::SeqCst);
        pump.notify.notify_one();
        until_kind(&mut received, "transfer-end").await;
        a.refresh().unwrap();
        let next = next_unit(&mut received).await;
        pump.stop();
        pump.task.await.unwrap();
        cell.terminate();

        assert_eq!(
            next["kind"], "trf1-frame",
            "B's burst was taken for A's loss: A repaired it with a catch-up"
        );
    }
}
