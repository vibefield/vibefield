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
//!   chunk waits for credit (bounded by `maxActivationCatchupMs`, else the
//!   activation stops `{overload}` — never a livelock, never a false ready).
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
    /// Would `bytes` of `class` be admissible right now? (non-mutating — the pump
    /// asks before forcing the engine to render a full frame nobody can receive)
    fn can_admit(
        &self,
        connection_id: u64,
        activation_id: &str,
        bytes: u64,
        class: UnitClass,
    ) -> Admission;
    /// A unit (a delta or a whole transfer) was sent ending at `revision`.
    fn unit_sent(&self, activation_id: &str, revision: u64, seed: bool);
    /// The pump could not converge within the bound.
    fn presentation_stopped(&self, activation_id: &str, reason: &'static str);
    /// Does the activation want frames right now (demand live, view attached)?
    fn wants_frames(&self, activation_id: &str) -> bool;
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
    End,
}

async fn run_pump<H: PumpHost>(
    host: Arc<H>,
    start: PumpStart,
    notify: Arc<Notify>,
    stop: Arc<AtomicBool>,
) {
    let (mut rx, _baseline) = start.hub.subscribe();
    let mut pump = Pump {
        host,
        start,
        notify,
        stop,
        activation_sequence: 0,
        last_sent: None,
        first_seed: true,
        transfer_counter: 0,
    };
    let mut needs_full = true;
    loop {
        if pump.stop.load(Ordering::Acquire) {
            break;
        }
        // Demand none (the view is detached): nothing should arrive, and
        // whatever does is coalesced; the return to live repairs with a full.
        if !pump.host.wants_frames(&pump.start.activation_id) {
            // Observing demand-none IS the lineage break (§8) — mark it NOW, not
            // lazily on a frame/notify. Otherwise a quiet demand-none window sets
            // nothing, and on re-attach the WakePump and the engine's re-attach
            // frame are both ready: if select takes the frame, `needs_full` is
            // still false and a delta rides out where a catch-up must. Setting it
            // here makes re-attach ALWAYS catch up, regardless of select ordering.
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
                    // Demand may have gone NONE while we were parked in this
                    // select (a demand cycle, or a read-only viewer parking) —
                    // `DeclareDemand{none}` sets demand and WakePumps, but the
                    // wake and a pending frame are BOTH ready and select picks
                    // one at random. A frame that arrives after demand-none must
                    // NOT ride out as a delta: drop it (needs_full) so re-attach
                    // repairs with a catch-up. This makes §8's "demand gone and
                    // back breaks the lineage" hold by construction, not by timing.
                    if !pump.host.wants_frames(&pump.start.activation_id) {
                        needs_full = true;
                        continue;
                    }
                    let Some(header) = Trf1Header::parse(&packet) else { continue };
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
                if self.start.frames.out.send(Outbound::Binary(unit)).is_err() {
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
    /// first time, catch-up after). Waits for credit per chunk (bounded).
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
                    self.host
                        .presentation_stopped(&self.start.activation_id, "overload");
                    return Step::End;
                }
                Ok(Err(broadcast::error::RecvError::Closed)) => return Step::End,
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Ok(packet)) => {
                    if packet.session_handle != self.start.session_handle {
                        continue;
                    }
                    if Trf1Header::parse(&packet).is_some_and(|h| h.full_snapshot) {
                        break packet;
                    }
                }
            }
        };
        let header = Trf1Header::parse(&packet).expect("checked above");
        let kind = if self.first_seed { "seed" } else { "catchup" };
        let bytes: &[u8] = &packet;
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
            "targetLayout": { "cols": header.cols, "rows": header.rows, "scrollbackRows": 0 },
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

    /// Block until `bytes` of BULK WOULD be admissible (or the bound passes →
    /// overload). Non-mutating: the real charge happens when the unit is sent.
    async fn wait_for_credit(&self, bytes: u64) -> Result<(), ()> {
        let deadline = tokio::time::Instant::now() + self.start.catchup_bound;
        loop {
            match self.host.can_admit(
                self.start.connection_id,
                &self.start.activation_id,
                bytes,
                UnitClass::Bulk,
            ) {
                Admission::Admitted => return Ok(()),
                Admission::Starved => {
                    if self.stop.load(Ordering::Acquire) {
                        return Err(());
                    }
                    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                    if remaining.is_zero() {
                        self.host
                            .presentation_stopped(&self.start.activation_id, "overload");
                        return Err(());
                    }
                    let _ = tokio::time::timeout(remaining, self.notify.notified()).await;
                }
                Admission::Gone => return Err(()),
            }
        }
    }

    /// Send one BULK transfer envelope once admitted (waiting for credit,
    /// bounded), then behind the writer's bulk-ahead backpressure. Credit is
    /// charged first; only once admitted do we acquire the writer permits — so a
    /// credit-starved loop never leaks bulk permits.
    async fn send_admitted(&mut self, unit: Vec<u8>) -> Result<(), ()> {
        let deadline = tokio::time::Instant::now() + self.start.catchup_bound;
        loop {
            match self.host.try_admit(
                self.start.connection_id,
                &self.start.activation_id,
                unit.len() as u64,
                UnitClass::Bulk,
            ) {
                Admission::Admitted => break,
                Admission::Starved => {
                    if self.stop.load(Ordering::Acquire) {
                        return Err(());
                    }
                    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                    if remaining.is_zero() {
                        self.host
                            .presentation_stopped(&self.start.activation_id, "overload");
                        return Err(());
                    }
                    let _ = tokio::time::timeout(remaining, self.notify.notified()).await;
                }
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
            .send(Outbound::Bulk(unit))
            .map_err(|_| ())
    }
}
