//! The cell-side ACTIVATION table (terminal-pipeline-v3 §5.4, TP-D22; the
//! contracts' ACTIVATION / CREDIT_ACCOUNT machines as the cell sees them):
//! one pending-or-active activation per `{clientId, sessionId}`, attached on
//! the control leg (`AttachControlLeg` → `ControlLegAttached`, carrying the
//! initial demand) and then on the frames leg (`AttachFramesLeg` →
//! `FramesLegAttached` with the TRF1 identity), the two-dimensional LEASE
//! (`presentation × input`) refreshed periodically and on changes from `SceneApplied`, `DeclareDemand
//! {none|live}` → the ghosttea view attached/detached (warm/hot), the BYTES
//! credit ledger per frames connection with per-activation accounts, and the
//! activation-scoped release when a leg dies.
//!
//! PURE over its inputs: every method returns `Effect`s (messages to send, a
//! view to attach/detach, a pump to start/stop) and the door performs them
//! outside the lock. Nothing here touches a socket or the engine, which is what
//! makes the state rows testable without either.

use super::grant::{AttachClaims, AttachRight};
use super::wire::{
    tagged, AttachControlLeg, AttachFramesLeg, AttachRefused, CellActivationStatus, ClaimGeometry,
    ControlLegAttached, DeclareDemand, DemandAccepted, FramesAttachOutcome, FramesLegAttached,
    GeometryCommitted, GeometryHolder, GeometryHolderFace, GeometryRefused, GeometryState,
    GeometryStateHolder, LeaseDimension, ReceiverCapacities, ReleaseGeometry, SceneApplied,
    SceneContentStamp, SceneEpoch, SendInput, SourceDemandMode, TransferGeometry, TransportCredit,
    TrfIdentity, JSON_MAX_SAFE_INTEGER,
};
use crate::registries::terminal_pipeline as tp;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::Semaphore;

/// What a leg's writer task receives. The writer is a TWO-LANE PRIORITY
/// scheduler (§8, TP-S3d): `Text`/`Binary`/`Close` ride the URGENT lane (control
/// replies, and the urgent-class incrementals that must never wait behind bulk);
/// `Bulk` rides the BULK lane (seed/catch-up transfer chunks). Urgent drains
/// first and the writer re-inspects it after every bulk chunk, so a background
/// transfer yields to an urgent incremental at chunk boundaries.
///
/// A presentation unit names its ACTIVATION, because the lanes may reorder
/// only ACROSS activations (2026-10-17): an activation's own catch-up is not
/// background to its own deltas. Each delta is built on the transfer queued
/// before it, and the worker drops a unit that arrives behind a later one of
/// its activation (`activationSequence` is "only a correctness check on an
/// ordered socket", §5) — so a delta that overtook its catch-up froze the
/// phone's scene for good. `Binary(_, None)` is a unit of no activation (a
/// calibration echo).
#[derive(Debug)]
pub enum Outbound {
    Text(String),
    Binary(Vec<u8>, Option<Arc<str>>),
    Bulk(Vec<u8>, Arc<str>),
    Close(u16, String),
}

/// The priority class of a presentation unit for admission (§8, TP-S3d): an
/// urgent incremental may draw the full connection window; bulk (a transfer) may
/// consume connection credit only down to the `urgentReserve`, and is further
/// bounded ahead of the writer by `maxBulkBytesAdmittedAhead`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnitClass {
    Urgent,
    Bulk,
}

/// A handle on one accepted leg: enough to address it and to write to it.
/// `bulk_credit` is the frames leg's byte-semaphore bounding `Bulk` bytes queued
/// ahead of the writer (`maxBulkBytesAdmittedAhead`); a pump acquires a chunk's
/// worth before enqueuing it and the writer returns them as it writes. `None` on
/// a control leg (it has no bulk lane). The semaphore is CLOSED when the writer
/// exits, so a pump blocked acquiring permits on a dead socket ends promptly.
///
/// `geometry_events` (item 42, 2026-10-19): this leg's hello negotiated the
/// `geometry-events` capability, so the cell may send it `GeometryState` — set
/// once at acceptance, always false on a frames leg. It lives on the LEG, not
/// on the activation, because it is a fact of one hello: an activation's
/// control leg can be re-pointed at a newer leg of its set (the renewal path of
/// `attach_control`), and that leg may have negotiated differently. Carried by
/// the `LegRef` the announcement would actually ride, the flag can never
/// describe a socket that is gone, and there is no second copy to keep in step.
#[derive(Debug, Clone)]
pub struct LegRef {
    pub connection_id: u64,
    pub leg_generation: u64,
    pub out: UnboundedSender<Outbound>,
    pub bulk_credit: Option<Arc<Semaphore>>,
    pub geometry_events: bool,
}

impl LegRef {
    pub fn send_text(&self, text: String) {
        let _ = self.out.send(Outbound::Text(text));
    }
}

/// The connection set a leg belongs to, as the door knows it from the verified
/// transport grant.
#[derive(Debug, Clone)]
pub struct SetIdentity {
    pub client_id: String,
    pub connection_set_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presentation {
    /// attached, no seed applied yet
    Pending,
    Presenting,
    Stopped(&'static str),
    Revoked(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Input {
    Allowed,
    Suspended(&'static str),
    Revoked(&'static str),
}

/// One activation as the cell holds it.
#[derive(Debug)]
pub struct Activation {
    pub activation_id: String,
    pub client_id: String,
    pub connection_set_id: String,
    pub session_id: String,
    pub rights: Vec<AttachRight>,
    pub grant_generation: u64,
    pub grant_expires_at_ms: u64,
    pub lease_epoch: u64,
    /// item 42 — the `face` of the newest attach grant accepted (a renewal
    /// re-reads it with the rights), echoed in `GeometryState` while this
    /// activation's view holds the seat. None for a grant minted without one.
    pub face: Option<GeometryHolderFace>,
    pub control: LegRef,
    pub frames: Option<LegRef>,
    pub created_at: Instant,
    pub demand: SourceDemandMode,
    pub demand_sequence: u64,
    /// the ghosttea view attached for this activation (view id, attachment epoch)
    pub view: Option<(String, u64)>,
    pub presentation: Presentation,
    pub input: Input,
    pub status_sequence: u64,
    pub accepted: Option<SceneContentStamp>,
    pub resume_token: Option<String>,
    pub trf_identity: Option<TrfIdentity>,
    /// The protocol-safe lineage allocated for the engine's opaque `u64`
    /// session epoch when the frames leg attached.
    pub scene_epoch: Option<SceneEpoch>,
    /// the revision of the first seed sent — presenting once applied
    pub seed_revision: Option<u64>,
    /// C3 — the first revision the pump sent after an overload stop: the scene
    /// is advancing again once the worker applies it (presenting once more).
    pub resume_revision: Option<u64>,
    pub pump_running: bool,
    /// C5 — the lag ledger: every unit sent in this lineage and not yet
    /// covered by a `SceneApplied`, as (revision, when sent), oldest first.
    /// The lag call is the age of its FRONT (`lagging`).
    pub unacked: VecDeque<(u64, Instant)>,
    last_status_sent_at: Option<Instant>,
}

/// The lag ledger's bound per activation (memory, not a wire number). Past
/// it the newest entry absorbs each further unit — its revision moves up, its
/// earlier send time stays — which can only OVERSTATE the age: a worker that
/// many units behind is lagging.
const UNACKED_UNITS_CAP: usize = 1024;

impl Activation {
    fn has_right(&self, right: AttachRight) -> bool {
        self.rights.contains(&right)
    }

    /// The attach grant is valid at `now_ms` — the tick's expiry sweep's own
    /// boundary (`now >= expires` is expired), read synchronously by the
    /// geometry verbs so neither the precheck nor the finalize races the sweep
    /// (DS-4d).
    fn grant_live(&self, now_ms: u64) -> bool {
        now_ms < self.grant_expires_at_ms
    }

    /// The lease, as the wire carries it.
    pub fn status(&self) -> CellActivationStatus {
        let (p_state, p_reason) = match self.presentation {
            Presentation::Pending => ("stopped", Some("pending")),
            Presentation::Presenting => ("presenting", None),
            Presentation::Stopped(r) => ("stopped", Some(r)),
            Presentation::Revoked(r) => ("revoked", Some(r)),
        };
        let (i_state, i_reason) = match self.input {
            Input::Allowed => ("allowed", None),
            Input::Suspended(r) => ("suspended", Some(r)),
            Input::Revoked(r) => ("revoked", Some(r)),
        };
        CellActivationStatus {
            session_id: self.session_id.clone(),
            activation_id: self.activation_id.clone(),
            cell_status_sequence: self.status_sequence,
            lease_ttl_ms: tp::CELL_LEASE_TTL_MS,
            accepted_content: self.accepted.clone(),
            presentation: LeaseDimension::new(p_state, p_reason),
            input: LeaseDimension::new(i_state, i_reason),
        }
    }
}

/// What the door must do after a table call (outside the lock).
#[derive(Debug)]
pub enum Effect {
    /// send a text message on a leg
    Send(LegRef, String),
    /// attach the ghosttea view for this activation (read-write iff `input`)
    AttachView {
        activation_id: String,
        session_id: String,
        client_id: String,
        view_id: String,
        read_write: bool,
    },
    DetachView {
        activation_id: String,
        session_id: String,
        client_id: String,
        view_id: String,
    },
    /// start the presentation pump (both legs attached, demand live)
    StartPump { activation_id: String },
    /// stop the pump (activation gone or frames leg gone)
    StopPump { activation_id: String },
    /// wake the pump (credit returned / demand changed)
    WakePump { activation_id: String },
}

// --- Geometry lease (S3c) -------------------------------------------------
// The cell-side geometry seat for one session. The cell is the AUTHORITY —
// occupancy ("empty seat or own"), the cell-minted `holderGeneration`, the
// revision and its CAS, the four auto-releases — while ghosttea commits the
// actual PTY resize under its own attachment-epoch fence. ghosttea 0.10.1 has
// no clear-control-keep-view primitive and its `claim_control_checked` does not
// refuse an occupied seat (it only CASes a revision), so both the occupancy rule
// and a standalone release live here; a released seat leaves ghosttea's
// controller inert until the next claim overwrites it (the door is the only
// path to a resize, and it gates every one on this lease).
//
// item 42 (2026-10-19) — the lease is also the seat's ANNOUNCER: every change
// of its holder or of its committed size, and every attach that puts an
// activation of the session on a `geometry-events` leg, yields a
// `GeometryState` for those legs (`seat_announcements`, `seat_state_to`).
// Before it the cell told only the caller of a verb, and an emptied seat no
// one, so the pane another device was sizing could not say who drove it.

/// The geometry seat for one session.
#[derive(Debug, Default)]
pub struct GeometryLease {
    holder: Option<HolderRecord>,
    revision: u64,
    next_generation: u64,
    /// item 42 — the PTY's last COMMITTED size, `(cols, rows)`: the size the
    /// engine reported for the newest claim or resize that ran, which is the
    /// size every pane of the session is drawing. It belongs to the SEAT, not
    /// to a holder, because a release resizes nothing — an empty seat still
    /// carries it. None until the first commit (a never-claimed session has
    /// nothing to announce: its PTY is at its spawn size and no pane sized it).
    committed: Option<(u16, u16)>,
}

/// The seat's holder. Its size is the lease's (`GeometryLease::committed`) and
/// its face is its activation's (`Activation::face`, read when the seat is
/// announced): a holder record never outlives its activation — `invalidate`
/// releases the seat before the activation leaves the table — so the face is
/// always the one the newest accepted grant carried, never a copy taken at the
/// commit that a renewal could leave behind.
#[derive(Debug, Clone)]
struct HolderRecord {
    client_id: String,
    /// the renderer's non-reused mount id (wire identity)
    view_id: String,
    /// cell-minted, stable across resizes of the same seat
    holder_generation: u64,
    /// the ghosttea view key (== the activation id) and the control-epoch fence
    /// a resize reuses (the attachment-epoch fence is read FRESH per verb from the
    /// activation's view — a detach auto-releases the seat, so a stale one cannot
    /// survive to be reused).
    activation_id: String,
    control_epoch: u64,
    resize_sequence: u64,
}

impl HolderRecord {
    fn wire(&self) -> GeometryHolder {
        GeometryHolder {
            client_id: self.client_id.clone(),
            view_id: self.view_id.clone(),
            holder_generation: self.holder_generation,
        }
    }

    /// The holder as `GeometryState` names it: the wire identity plus `face`.
    fn announced(&self, face: Option<GeometryHolderFace>) -> GeometryStateHolder {
        GeometryStateHolder {
            client_id: self.client_id.clone(),
            view_id: self.view_id.clone(),
            holder_generation: self.holder_generation,
            face,
        }
    }
}

/// The ghosttea call `geometry_precheck` authorized the door to make.
#[derive(Debug)]
pub enum GeometryOp {
    /// Establish (empty seat) or re-establish (transfer) the controller — a new
    /// holder generation. Maps to `Session::claim_control_checked`.
    Claim { cols: u16, rows: u16 },
    /// Resize the seat this claimant already holds — no new generation. Maps to
    /// `Session::resize_view_checked`.
    Resize {
        control_epoch: u64,
        resize_sequence: u64,
        cols: u16,
        rows: u16,
    },
}

/// The door's marching orders for one geometry verb: refuse now, or perform the
/// engine op on `ghosttea_view_id` and then call `geometry_finalize`.
#[derive(Debug)]
pub enum GeometryDecision {
    Refuse(Vec<Effect>),
    Proceed(GeometryProceed),
}

#[derive(Debug)]
pub struct GeometryProceed {
    /// the CALLER activation (the verb's `activationId`) — where the response goes
    pub caller_activation_id: String,
    pub session_id: String,
    /// the ghosttea view to act on (the claimant/destination activation id)
    pub client_id: String,
    pub ghosttea_view_id: String,
    pub attachment_epoch: u64,
    pub base_revision: u64,
    /// the wire holder identity to announce on a successful claim/transfer
    pub claimant_view_id: String,
    pub op: GeometryOp,
}

/// What the engine did, handed back to `geometry_finalize`.
#[derive(Debug)]
pub enum GeometryOutcome {
    /// `claim_control_checked` granted — ghosttea's freshly minted control epoch.
    Claimed {
        control_epoch: u64,
        cols: u16,
        rows: u16,
    },
    /// `resize_view_checked` returned (size_changed or not — both commit).
    Resized { cols: u16, rows: u16 },
    /// the engine refused (stale attachment epoch, view gone, read-only view).
    EngineRefused,
}

impl GeometryOutcome {
    /// The size the engine COMMITTED on the PTY, if it committed one (item 42:
    /// the seat's announced size is the engine's, whatever the lease decides).
    fn committed_size(&self) -> Option<(u16, u16)> {
        match *self {
            Self::Claimed { cols, rows, .. } | Self::Resized { cols, rows } => Some((cols, rows)),
            Self::EngineRefused => None,
        }
    }
}

// --- Session input (S3-input) ---------------------------------------------
// The table's verdict on a `SendInput`. The gate is cell-side: the caller's own
// control leg, the placement fence (`leaseEpoch`), the `input` lease dimension,
// and a synchronous renewal-margin expiry check (a stale-Allowed lease cannot
// leak input past the margin). The fence coordinates the door hands ghosttea are
// the ones the CELL owns — `ghosttea_view_id`, `client_id`, `attachment_epoch`
// from the activation→view binding — never the wire body.

/// The door's marching orders for one `SendInput`.
#[derive(Debug)]
pub enum InputDecision {
    /// Refuse and audit (§5.4: the cell ALWAYS rejects input while it is not
    /// allowed; the echo of accepted input is a frame). The CALLER is told only
    /// on a leg that negotiated `input-refusals`, in the words
    /// `InputDrop::answer` gives (C5) — silent otherwise.
    Drop(InputDrop),
    /// Authorized — the door runs the engine input op on the resolved view.
    Proceed(InputProceed),
}

/// Which gate dropped one `SendInput` (C5). Every drop has its audit tag; the
/// answer a caller may hear is a separate question, and the type answers it:
/// a message naming no activation of the caller's own control leg is never
/// answered, so a refusal cannot confirm an id the caller does not own (EL7).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputDrop {
    /// No activation by that id.
    NoActivation,
    /// An activation, but not one of the caller's own control leg, or of
    /// another session than the message names.
    WrongLeg,
    /// The wire's `leaseEpoch` is not the route binding's (the placement fence).
    StaleLeaseEpoch,
    /// The lease's input dimension is not `allowed`; its own word says why
    /// (`lagging`, `overload`, `pending`, `not-granted`, `exited`, …).
    Lease(&'static str),
    /// The synchronous renewal-margin backstop: the lease WOULD recompute to
    /// `right-expired`.
    RightExpired,
    /// No presenting view to type into (demand none).
    NoView,
}

impl InputDrop {
    /// The audit tag, which every drop has (the door's `reason`).
    pub fn tag(self) -> &'static str {
        match self {
            Self::NoActivation => "no-activation",
            Self::WrongLeg => "wrong-leg",
            Self::StaleLeaseEpoch => "stale-lease-epoch",
            Self::Lease(_) => "input-not-allowed",
            Self::RightExpired => "right-expired",
            Self::NoView => "no-view",
        }
    }

    /// The `InputRefused` reason the caller may hear, or None. When the lease
    /// refused it is the lease's own input reason, the word the client already
    /// reads in `CellActivationStatus`; when another fence did, that fence's
    /// name. Never an answer for a drop that names no activation of the
    /// caller's own control leg.
    pub fn answer(self) -> Option<&'static str> {
        match self {
            Self::NoActivation | Self::WrongLeg => None,
            Self::StaleLeaseEpoch => Some("stale-lease-epoch"),
            Self::Lease(reason) => Some(reason),
            Self::RightExpired => Some("right-expired"),
            Self::NoView => Some("no-view"),
        }
    }
}

/// The cell-owned fence context for an authorized input op.
#[derive(Debug)]
pub struct InputProceed {
    pub session_id: String,
    pub client_id: String,
    pub ghosttea_view_id: String,
    pub attachment_epoch: u64,
    pub input_sequence: u64,
}

/// One credit window: cumulative bytes admitted vs returned within the epoch.
#[derive(Debug, Clone, Copy, Default)]
pub struct Window {
    pub admitted: u64,
    pub returned: u64,
    pub limit: u64,
}

impl Window {
    fn in_flight(&self) -> u64 {
        self.admitted.saturating_sub(self.returned)
    }
    fn can_admit(&self, bytes: u64) -> bool {
        self.in_flight().saturating_add(bytes) <= self.limit
    }
    /// Admit only up to `effective_limit` (≤ `self.limit`) — bulk leaves the
    /// `urgentReserve` headroom for the urgent class.
    fn can_admit_within(&self, bytes: u64, effective_limit: u64) -> bool {
        self.in_flight().saturating_add(bytes) <= effective_limit
    }
}

/// The frames leg's credit ledger (§8, TP-D11): the connection window and one
/// account per activation; every total CUMULATIVE within the credit epoch;
/// returns applied with max() and ignored when their sequence was seen.
#[derive(Debug)]
pub struct CreditLedger {
    pub credit_epoch: u64,
    pub last_sequence: Option<u64>,
    pub connection: Window,
    pub per_activation_limit: u64,
    /// bulk may consume connection credit only down to `connection.limit −
    /// urgent_reserve` (§8, TP-S3d); urgent draws the full window.
    pub urgent_reserve: u64,
    pub accounts: HashMap<String, Window>,
}

impl CreditLedger {
    pub fn new(credit_epoch: u64, windows: ReceiverCapacities, urgent_reserve: u64) -> Self {
        let connection_limit = windows.connection_credit_bytes;
        Self {
            credit_epoch,
            last_sequence: None,
            connection: Window {
                admitted: 0,
                returned: 0,
                limit: connection_limit,
            },
            per_activation_limit: windows.per_activation_credit_bytes,
            // N-H1 (2026-09-14) — the clamp used to read
            // `urgent_reserve.min(connection_limit)`, under a comment saying
            // "never let the reserve exceed the window (a tiny window would
            // otherwise starve bulk entirely and stall a seed)". It did exactly
            // the thing it named: a window AT OR BELOW the reserve clamped the
            // reserve to the whole window, so `connection_limit_for(Bulk)` was
            // `limit - limit == 0` and bulk could never be admitted at all. The
            // client was not refused and no error was logged — the pump simply
            // waited out `MAX_ACTIVATION_CATCHUP_MS` and reported
            // `presentation: stopped {overload}` on the control leg, which is a
            // lie about a connection that is merely small.
            //
            // HALF THE WINDOW, so bulk always keeps something to seed into. The
            // §8/TP-S3d law is unharmed where it bites: URGENT_RESERVE_BYTES is
            // sized at 2 x MAX_URGENT_PRESENTATION_UNIT_BYTES, so any window of
            // at least 2 x MAX_URGENT_PRESENTATION_UNIT_BYTES still reserves
            // room for a whole urgent unit, and every window a product client
            // declares (DEFAULT_CELL_RECEIVER_CAPS = 16 MiB, eight times the
            // reserve) is unaffected — the clamp does not engage at all there.
            // What changes is only the small-window case the old comment
            // claimed to handle: it degrades to a fair split instead of a
            // silent, permanent seed stall.
            urgent_reserve: urgent_reserve.min(connection_limit / 2),
            accounts: HashMap::new(),
        }
    }

    /// The connection headroom a unit of `class` may draw: the full window for
    /// urgent, the window minus the reserve for bulk.
    fn connection_limit_for(&self, class: UnitClass) -> u64 {
        match class {
            UnitClass::Urgent => self.connection.limit,
            UnitClass::Bulk => self.connection.limit.saturating_sub(self.urgent_reserve),
        }
    }

    fn open_account(&mut self, activation_id: &str) {
        self.accounts
            .entry(activation_id.to_string())
            .or_insert(Window {
                admitted: 0,
                returned: 0,
                limit: self.per_activation_limit,
            });
    }

    /// Law (1)/(3): a closed activation's account stays until the cell sees
    /// admitted == returned; the worker returns what it already admitted.
    fn close_account(&mut self, activation_id: &str) {
        if let Some(w) = self.accounts.get(activation_id) {
            if w.in_flight() == 0 {
                self.accounts.remove(activation_id);
            }
            // else: DRAINING — kept until the returns arrive
        }
    }

    /// Non-mutating: would `bytes` of `class` be admissible now? `None` = no such
    /// account. Bulk is bounded by the window minus the urgent reserve.
    pub fn can_admit(&self, activation_id: &str, bytes: u64, class: UnitClass) -> Option<bool> {
        let account = self.accounts.get(activation_id)?;
        Some(
            self.connection
                .can_admit_within(bytes, self.connection_limit_for(class))
                && account.can_admit(bytes),
        )
    }

    pub fn try_admit(&mut self, activation_id: &str, bytes: u64, class: UnitClass) -> bool {
        let effective = self.connection_limit_for(class);
        let Some(account) = self.accounts.get(activation_id) else {
            return false;
        };
        if !self.connection.can_admit_within(bytes, effective) || !account.can_admit(bytes) {
            return false;
        }
        self.connection.admitted += bytes;
        self.accounts.get_mut(activation_id).unwrap().admitted += bytes;
        true
    }

    /// Apply a `TransportCredit`; returns the activation ids whose accounts
    /// moved (to wake their pumps). Old epochs and seen sequences are ignored.
    pub fn returned(&mut self, credit: &TransportCredit) -> Vec<String> {
        if credit.credit_epoch != self.credit_epoch {
            return Vec::new();
        }
        if self
            .last_sequence
            .is_some_and(|s| credit.credit_sequence <= s)
        {
            return Vec::new();
        }
        self.last_sequence = Some(credit.credit_sequence);
        let before = self.connection.returned;
        self.connection.returned = self
            .connection
            .returned
            .max(credit.connection_bytes_returned);
        let connection_moved = self.connection.returned > before;
        let mut woke = Vec::new();
        for account in &credit.accounts {
            if let Some(w) = self.accounts.get_mut(&account.activation_id) {
                if account.bytes_returned > w.returned {
                    w.returned = account.bytes_returned;
                    woke.push(account.activation_id.clone());
                }
            }
        }
        // a drained closed account closes for good
        self.accounts
            .retain(|_, w| w.limit != 0 || w.in_flight() > 0);
        if connection_moved {
            // connection credit frees every starved pump, not only the named ones
            for id in self.accounts.keys() {
                if !woke.contains(id) {
                    woke.push(id.clone());
                }
            }
        }
        woke
    }
}

/// The table. One per cell (behind the door's registry lock).
#[derive(Debug)]
pub struct ActivationTable {
    cell_boot_id: String,
    by_id: HashMap<String, Activation>,
    by_key: HashMap<(String, String), String>,
    /// Ghosttea derives a session epoch from UUID bytes, so it can occupy all
    /// 64 bits. The JSON wire cannot. Translate each live engine lineage to a
    /// stable, cell-local, monotonically increasing safe counter; never
    /// truncate or modulo an identity token.
    model_generations: HashMap<(String, u64), u64>,
    next_model_generation: u64,
    credit: HashMap<u64, CreditLedger>,
    /// the geometry seat per session (S3c)
    geometry: HashMap<String, GeometryLease>,
    attach_deadline: Duration,
    max_activations: usize,
}

pub struct AttachControlInput<'a> {
    pub now_ms: u64,
    pub set: &'a SetIdentity,
    pub leg: &'a LegRef,
    pub msg: AttachControlLeg,
    pub claims: AttachClaims,
    pub session_known: bool,
}

pub struct AttachFramesInput<'a> {
    pub set: &'a SetIdentity,
    pub leg: &'a LegRef,
    pub msg: AttachFramesLeg,
    pub claims: AttachClaims,
    pub trf_identity: Option<TrfIdentity>,
    pub resume_token: String,
    /// the session's live model generation (`Session::session_epoch()`), read by
    /// the door — a resume whose `from` names a different epoch is `epoch-changed`.
    pub session_epoch: u64,
}

impl ActivationTable {
    pub fn new(cell_boot_id: &str) -> Self {
        Self {
            cell_boot_id: cell_boot_id.to_string(),
            by_id: HashMap::new(),
            by_key: HashMap::new(),
            model_generations: HashMap::new(),
            next_model_generation: 1,
            credit: HashMap::new(),
            geometry: HashMap::new(),
            attach_deadline: Duration::from_millis(tp::ACTIVATION_ATTACH_DEADLINE_MS),
            max_activations: tp::CELL_MAX_CONCURRENT_ACTIVATIONS as usize,
        }
    }

    pub fn get(&self, activation_id: &str) -> Option<&Activation> {
        self.by_id.get(activation_id)
    }

    pub fn get_mut(&mut self, activation_id: &str) -> Option<&mut Activation> {
        self.by_id.get_mut(activation_id)
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }

    pub fn scene_epoch(&self, model_generation: u64) -> SceneEpoch {
        assert!(
            model_generation <= JSON_MAX_SAFE_INTEGER,
            "TP model generations must be exactly representable JSON integers"
        );
        SceneEpoch {
            cell_boot_id: self.cell_boot_id.clone(),
            model_generation,
        }
    }

    fn resolve_scene_epoch(&mut self, session_id: &str, engine_epoch: u64) -> SceneEpoch {
        let key = (session_id.to_string(), engine_epoch);
        let model_generation = match self.model_generations.get(&key) {
            Some(generation) => *generation,
            None => {
                let generation = self.next_model_generation;
                assert!(
                    generation <= JSON_MAX_SAFE_INTEGER,
                    "TP exhausted its JavaScript-safe model-generation space"
                );
                self.next_model_generation = generation + 1;
                self.model_generations.insert(key, generation);
                generation
            }
        };
        self.scene_epoch(model_generation)
    }

    /// Forget engine identity tokens once their session has left the live
    /// source. `next_model_generation` deliberately never moves backward: a
    /// later lineage can never reuse a stamp from this cell boot.
    pub fn prune_model_generations(&mut self, mut session_is_live: impl FnMut(&str) -> bool) {
        self.model_generations
            .retain(|(session_id, _), _| session_is_live(session_id));
    }

    /// A frames leg was accepted: its credit epoch opens with these windows.
    pub fn open_credit(
        &mut self,
        connection_id: u64,
        credit_epoch: u64,
        windows: ReceiverCapacities,
        urgent_reserve: u64,
    ) {
        self.credit.insert(
            connection_id,
            CreditLedger::new(credit_epoch, windows, urgent_reserve),
        );
    }

    pub fn credit_ledger(&self, connection_id: u64) -> Option<&CreditLedger> {
        self.credit.get(&connection_id)
    }

    fn refuse(leg: &LegRef, activation_id: Option<&str>, code: &str, retryable: bool) -> Effect {
        Effect::Send(
            leg.clone(),
            tagged(
                "AttachRefused",
                &AttachRefused {
                    activation_id: activation_id.map(str::to_string),
                    code: code.to_string(),
                    retryable,
                },
            ),
        )
    }

    fn status_effect(a: &mut Activation) -> Effect {
        a.status_sequence += 1;
        a.last_status_sent_at = Some(Instant::now());
        Effect::Send(
            a.control.clone(),
            tagged("CellActivationStatus", &a.status()),
        )
    }

    /// Recompute `input` from presentation, rights, lag and expiry; true if changed.
    fn recompute_input(a: &mut Activation, now_ms: u64) -> bool {
        let before = a.input;
        if matches!(a.input, Input::Revoked(_)) {
            // a revoked right never comes back on its own (and keeps its reason:
            // `not-granted` from birth, `right-revoked` from a downgrade)
        } else if !a.has_right(AttachRight::Input) {
            a.input = Input::Revoked("not-granted");
        } else if let Presentation::Stopped(reason) = a.presentation {
            // the scene is not advancing, and the lease says why in the
            // spec's own word for both dimensions (`overload`), not `pending`
            a.input = Input::Suspended(reason);
        } else if a.presentation != Presentation::Presenting {
            a.input = Input::Suspended("pending");
        } else if now_ms + tp::ATTACH_RENEWAL_MARGIN_MS >= a.grant_expires_at_ms {
            a.input = Input::Suspended("right-expired");
        } else if Self::lagging(a) {
            // the cell's own lag call: a unit the worker has not acknowledged
            // for longer than the bound
            a.input = Input::Suspended("lagging");
        } else {
            a.input = Input::Allowed;
        }
        a.input != before
    }

    /// The cell's lag call (§5.4 — the LAG decision is the cell's alone): the
    /// AGE of the oldest unit sent and not yet acknowledged, against
    /// `INPUT_LAG_SUSPEND_MS`. A time, never a count (C5): a revision count
    /// fills in half a second of a streaming agent and trips at once on one
    /// catch-up (a single unit, hundreds of revisions on); and the age is the
    /// OLDEST unit's — the newest is always young while output flows.
    fn lagging(a: &Activation) -> bool {
        a.unacked.front().is_some_and(|(_, sent)| {
            sent.elapsed() > Duration::from_millis(tp::INPUT_LAG_SUSPEND_MS)
        })
    }

    // --- Geometry (S3c) ---------------------------------------------------

    fn geometry_refuse(
        leg: &LegRef,
        code: &str,
        current_holder: Option<GeometryHolder>,
        geometry_revision: Option<u64>,
    ) -> Vec<Effect> {
        vec![Effect::Send(
            leg.clone(),
            tagged(
                "GeometryRefused",
                &GeometryRefused {
                    code: code.to_string(),
                    current_holder,
                    geometry_revision,
                },
            ),
        )]
    }

    /// `ClaimGeometry` (a re-claim of the same seat commits a resize). PURE: the
    /// door performs the engine op the decision names, then `geometry_finalize`.
    pub fn claim_geometry(
        &mut self,
        leg: &LegRef,
        msg: ClaimGeometry,
        now_ms: u64,
    ) -> GeometryDecision {
        // Phase 1 — the caller (its own control leg, its own view). A malformed
        // caller carries no lease context.
        let caller = match self.by_id.get(&msg.activation_id) {
            Some(a)
                if a.control.connection_id == leg.connection_id
                    && a.client_id == msg.claimant.client_id
                    && a.session_id == msg.session_id =>
            {
                a
            }
            _ => {
                return GeometryDecision::Refuse(Self::geometry_refuse(
                    leg,
                    "NOT_HOLDER",
                    None,
                    None,
                ))
            }
        };
        // a lapsed grant carries no rights at all (DS-4d — the tick would
        // invalidate it within a tick; the verb no longer races that)
        if !caller.has_right(AttachRight::Geometry) || !caller.grant_live(now_ms) {
            return GeometryDecision::Refuse(Self::geometry_refuse(
                leg,
                "RIGHT_MISSING",
                None,
                None,
            ));
        }
        let Some((ghosttea_view_id, attachment_epoch)) = caller.view.clone() else {
            // no presenting view (demand none) — nothing to resize
            return GeometryDecision::Refuse(Self::geometry_refuse(
                leg,
                "VIEW_NOT_PRESENTING",
                None,
                None,
            ));
        };
        let client_id = caller.client_id.clone();
        let caller_activation_id = caller.activation_id.clone();
        // Phase 2 — the lease.
        let lease = self.geometry.entry(msg.session_id.clone()).or_default();
        let holder_wire = lease.holder.as_ref().map(HolderRecord::wire);
        if msg.expect_revision != lease.revision {
            return GeometryDecision::Refuse(Self::geometry_refuse(
                leg,
                "STALE_REVISION",
                holder_wire,
                Some(lease.revision),
            ));
        }
        let own_seat = lease.holder.as_ref().is_some_and(|h| {
            h.client_id == msg.claimant.client_id && h.view_id == msg.claimant.view_id
        });
        if lease.holder.is_some() && !own_seat {
            return GeometryDecision::Refuse(Self::geometry_refuse(
                leg,
                "SEAT_HELD",
                holder_wire,
                Some(lease.revision),
            ));
        }
        let op = if own_seat {
            let h = lease.holder.as_ref().expect("own_seat");
            GeometryOp::Resize {
                control_epoch: h.control_epoch,
                resize_sequence: h.resize_sequence + 1,
                cols: msg.cols,
                rows: msg.rows,
            }
        } else {
            GeometryOp::Claim {
                cols: msg.cols,
                rows: msg.rows,
            }
        };
        GeometryDecision::Proceed(GeometryProceed {
            caller_activation_id,
            session_id: msg.session_id,
            client_id,
            ghosttea_view_id,
            attachment_epoch,
            base_revision: lease.revision,
            claimant_view_id: msg.claimant.view_id,
            op,
        })
    }

    /// `TransferGeometry` — ONE cell-side transition that revokes the seat,
    /// grants it to `to` and commits the resize as one engine claim.
    ///
    /// Three callers may make it (TPv3 §6, the Authorization bullet as amended
    /// 2026-09-30): the current holder's own client (a hand-off), a caller whose
    /// grant carries `geometryAdmin`, and — THE TAKE — any caller whose own grant
    /// carries `geometry`, when the destination is ITSELF. The take is the one
    /// clause DS-D5's note added (James: "the latest focused pane takes full
    /// control include resizing, LWW. no matter it is local pane, remote desktop
    /// pane or mobile pane"): the HOST decides when a pane takes — on focus — and
    /// the cell only authorizes it, so focus still mints nothing here (TP-D2) and a
    /// `controlsResize:false` mirror, which never sends the verb, never takes.
    /// Every other fence holds for all three: `from` must be the LIVE holder, the
    /// revision must match, and the destination must hold a presenting,
    /// geometry-capable view. So a take is exactly one CAS and one committed
    /// resize, and a stale one is refused with the holder and revision a runtime
    /// needs to try once more. The CAS holds at the ENGINE too (DS-4d): the door
    /// runs this precheck, the engine claim and the finalize inside the
    /// session's gate, so of two takes at once the second prechecks against the
    /// first's commit.
    ///
    /// Corrected 2026-10-19 (item 42): this said the cell announces a new holder
    /// to the CALLER only, so a displaced holder learns it from a refusal like
    /// these, never from a push. That was true until item 42; now
    /// `geometry_finalize` also sends `GeometryState` to the control leg of
    /// every activation of the session that negotiated `geometry-events`, the
    /// displaced holder's included, and only a client that did not negotiate
    /// still learns the seat from a refusal.
    pub fn transfer_geometry(
        &mut self,
        leg: &LegRef,
        msg: TransferGeometry,
        now_ms: u64,
    ) -> GeometryDecision {
        // Phase 1 — the caller (its own control leg, this session) and its
        // standing. A caller with none of the three is refused BEFORE the
        // destination or the lease is examined, and told nothing about either:
        // like a claim's RIGHT_MISSING, the holder and the revision are echoed
        // only to a caller that could act on them (phase 3's refusals).
        let (may_transfer, caller_activation_id) = match self.by_id.get(&msg.activation_id) {
            Some(a)
                if a.control.connection_id == leg.connection_id
                    && a.session_id == msg.session_id =>
            {
                // the holder's own client (phase 3 proves `from` is live) · an
                // admin · a TAKE: the destination is the caller, on its own right.
                // A lapsed grant has none of the three (DS-4d): a take on one
                // must not displace a live holder.
                let live = a.grant_live(now_ms);
                let holder = a.client_id == msg.from.client_id;
                let admin = a.has_right(AttachRight::GeometryAdmin);
                let take = msg.to.client_id == a.client_id && a.has_right(AttachRight::Geometry);
                (live && (holder || admin || take), a.activation_id.clone())
            }
            _ => {
                return GeometryDecision::Refuse(Self::geometry_refuse(
                    leg,
                    "NOT_HOLDER",
                    None,
                    None,
                ))
            }
        };
        if !may_transfer {
            return GeometryDecision::Refuse(Self::geometry_refuse(leg, "NOT_HOLDER", None, None));
        }
        // Phase 2 — the destination must hold a geometry-capable, presenting view.
        let Some(dest_id) = self
            .by_key
            .get(&(msg.to.client_id.clone(), msg.session_id.clone()))
            .cloned()
        else {
            return GeometryDecision::Refuse(Self::geometry_refuse(
                leg,
                "DESTINATION_INELIGIBLE",
                None,
                None,
            ));
        };
        let dest = self.by_id.get(&dest_id).expect("indexed");
        let dest_ok = dest.has_right(AttachRight::Geometry)
            && dest.grant_live(now_ms)
            && dest.client_id == msg.to.client_id
            && dest.view.is_some();
        if !dest_ok {
            return GeometryDecision::Refuse(Self::geometry_refuse(
                leg,
                "DESTINATION_INELIGIBLE",
                None,
                None,
            ));
        }
        let (dest_view_id, dest_epoch) = dest.view.clone().expect("checked");
        let dest_client = dest.client_id.clone();
        // Phase 3 — the lease: whatever the caller's standing, the `from` must be
        // the LIVE holder (client, view AND the cell-minted generation) and the
        // revision must match. For the holder's own client that is what proves it
        // holds; for an admin and a taker it is what makes the hand-over one CAS
        // against the seat as it is, never as the caller last saw it.
        let lease = self.geometry.entry(msg.session_id.clone()).or_default();
        let holder_wire = lease.holder.as_ref().map(HolderRecord::wire);
        let from_is_holder = lease.holder.as_ref().is_some_and(|h| {
            h.client_id == msg.from.client_id
                && h.view_id == msg.from.view_id
                && h.holder_generation == msg.from.holder_generation
        });
        if !from_is_holder {
            return GeometryDecision::Refuse(Self::geometry_refuse(
                leg,
                "NOT_HOLDER",
                holder_wire,
                Some(lease.revision),
            ));
        }
        if msg.expect_revision != lease.revision {
            return GeometryDecision::Refuse(Self::geometry_refuse(
                leg,
                "STALE_REVISION",
                holder_wire,
                Some(lease.revision),
            ));
        }
        GeometryDecision::Proceed(GeometryProceed {
            caller_activation_id,
            session_id: msg.session_id,
            client_id: dest_client,
            ghosttea_view_id: dest_view_id,
            attachment_epoch: dest_epoch,
            base_revision: lease.revision,
            claimant_view_id: msg.to.view_id,
            op: GeometryOp::Claim {
                cols: msg.cols,
                rows: msg.rows,
            },
        })
    }

    /// The door performed the engine op; commit (or refuse) the lease.
    ///
    /// No other geometry VERB of this session ran since the precheck: the door
    /// holds the session's gate from the precheck to here, and the engine claim
    /// was a compare-and-set on the control revision read beside it (DS-4d).
    /// This comment used to call a cross-client interleaving "the rare transfer
    /// race" — DS-4's take made cross-client verbs routine, and two takes at
    /// once left the engine's controller with the loser. What can still move the
    /// seat under a verb is the table's own auto-release (view detach, leg
    /// loss, grant expiry, a renewal dropping `geometry`), which only ever
    /// EMPTIES it: the revision CAS below refuses then, and the engine's
    /// controller is this verb's, inert, as after any release.
    ///
    /// The DESTINATION is re-checked at `now_ms`, the clock read after the
    /// engine op (DS-4d): the engine acted for it, but it may have lapsed in
    /// flight — its grant expired, its client went away (the activation
    /// invalidated), its view or its `geometry` right changed. Committing would
    /// seat a holder that can never resize again, every other pane reading
    /// SEAT_HELD until a take. So it commits NO holder: the engine's claim has
    /// already displaced whoever held the seat (and a resize's holder IS the
    /// destination), so the seat is emptied — claimable — and the caller is
    /// refused `DESTINATION_INELIGIBLE` with the revision and no holder.
    ///
    /// item 42 (2026-10-19) — and the seat is ANNOUNCED. An engine op that
    /// returned a claim or a resize committed that size on the PTY whatever the
    /// lease decides below, so the size is recorded first
    /// (`GeometryLease::committed`); then, if the seat as `GeometryState`
    /// carries it moved — its revision (every holder change and every commit
    /// moves it) or its committed size — every `geometry-events` control leg of
    /// the session hears it, AFTER the caller's own reply. Two paths move the
    /// size at an UNCHANGED revision, and item 42 keeps DS-4d's revision
    /// semantics there as they stand: `DESTINATION_INELIGIBLE` on a seat that
    /// was already empty (no holder to take, so no revision step), and a
    /// commit that landed after an auto-release emptied the seat under the
    /// verb (refused `STALE_REVISION`). Their announcement carries the new size
    /// at the revision a receiver already holds, which is why the receiver's
    /// rule replaces its state on an EQUAL revision and ignores only an older
    /// one.
    pub fn geometry_finalize(
        &mut self,
        leg: &LegRef,
        proceed: GeometryProceed,
        outcome: GeometryOutcome,
        now_ms: u64,
    ) -> Vec<Effect> {
        let destination_live = self.destination_live(&proceed, now_ms);
        let session_id = proceed.session_id.clone();
        let lease = self.geometry.entry(session_id.clone()).or_default();
        let announced_before = (lease.revision, lease.committed);
        if let Some(size) = outcome.committed_size() {
            lease.committed = Some(size);
        }
        let mut effects = Self::commit_lease(lease, leg, proceed, outcome, destination_live);
        // item 42 — the announcement follows the reply. An unchanged (revision,
        // size) pair is no change: a refusal that moved nothing says nothing.
        if (lease.revision, lease.committed) != announced_before {
            effects.extend(self.seat_announcements(&session_id));
        }
        effects
    }

    /// The lease half of `geometry_finalize` — commit the holder, or refuse —
    /// answering the CALLER on `leg`; every DS-4d rule above lives here.
    fn commit_lease(
        lease: &mut GeometryLease,
        leg: &LegRef,
        proceed: GeometryProceed,
        outcome: GeometryOutcome,
        destination_live: bool,
    ) -> Vec<Effect> {
        if lease.revision != proceed.base_revision {
            return Self::geometry_refuse(
                leg,
                "STALE_REVISION",
                lease.holder.as_ref().map(HolderRecord::wire),
                Some(lease.revision),
            );
        }
        match outcome {
            GeometryOutcome::EngineRefused => Self::geometry_refuse(
                leg,
                "VIEW_SUPERSEDED",
                lease.holder.as_ref().map(HolderRecord::wire),
                Some(lease.revision),
            ),
            GeometryOutcome::Claimed { .. } | GeometryOutcome::Resized { .. }
                if !destination_live =>
            {
                if lease.holder.take().is_some() {
                    lease.revision += 1;
                }
                Self::geometry_refuse(leg, "DESTINATION_INELIGIBLE", None, Some(lease.revision))
            }
            GeometryOutcome::Claimed {
                control_epoch,
                cols,
                rows,
            } => {
                lease.next_generation += 1;
                let record = HolderRecord {
                    client_id: proceed.client_id,
                    view_id: proceed.claimant_view_id,
                    holder_generation: lease.next_generation,
                    activation_id: proceed.ghosttea_view_id,
                    control_epoch,
                    resize_sequence: 0,
                };
                let wire = record.wire();
                lease.holder = Some(record);
                lease.revision += 1;
                vec![Effect::Send(
                    leg.clone(),
                    tagged(
                        "GeometryCommitted",
                        &GeometryCommitted {
                            holder: wire,
                            geometry_revision: lease.revision,
                            cols,
                            rows,
                        },
                    ),
                )]
            }
            GeometryOutcome::Resized { cols, rows } => {
                let Some(h) = lease.holder.as_mut() else {
                    return Self::geometry_refuse(
                        leg,
                        "VIEW_SUPERSEDED",
                        None,
                        Some(lease.revision),
                    );
                };
                h.resize_sequence += 1;
                let wire = h.wire();
                lease.revision += 1;
                vec![Effect::Send(
                    leg.clone(),
                    tagged(
                        "GeometryCommitted",
                        &GeometryCommitted {
                            holder: wire,
                            geometry_revision: lease.revision,
                            cols,
                            rows,
                        },
                    ),
                )]
            }
        }
    }

    /// DS-4d — the destination of a geometry verb is still the one its precheck
    /// authorized: the same activation (the view id IS the activation id —
    /// `HolderRecord::activation_id`), its client and session, its `geometry`
    /// right, a grant live at `now_ms`, and the same view incarnation the
    /// engine op was fenced on.
    fn destination_live(&self, proceed: &GeometryProceed, now_ms: u64) -> bool {
        self.by_id.get(&proceed.ghosttea_view_id).is_some_and(|d| {
            d.client_id == proceed.client_id
                && d.session_id == proceed.session_id
                && d.has_right(AttachRight::Geometry)
                && d.grant_live(now_ms)
                && d.view.as_ref().is_some_and(|(view, epoch)| {
                    *view == proceed.ghosttea_view_id && *epoch == proceed.attachment_epoch
                })
        })
    }

    /// `ReleaseGeometry` — the holder yields the seat. No engine call (ghosttea
    /// 0.10.1 has no clear-control-keep-view; its controller stays inert until
    /// the next claim overwrites it, and every resize is gated on this lease).
    /// A release has no reply of its own; since item 42 (2026-10-19) the empty
    /// seat is announced to every `geometry-events` leg of the session, the
    /// releaser's included, at the size the PTY was left at.
    pub fn release_geometry(&mut self, leg: &LegRef, msg: ReleaseGeometry) -> Vec<Effect> {
        let ok_caller = self.by_id.get(&msg.activation_id).is_some_and(|a| {
            a.control.connection_id == leg.connection_id && a.session_id == msg.session_id
        });
        if !ok_caller {
            return Self::geometry_refuse(leg, "NOT_HOLDER", None, None);
        }
        let Some(lease) = self.geometry.get_mut(&msg.session_id) else {
            return Self::geometry_refuse(leg, "NOT_HOLDER", None, None);
        };
        let is_holder = lease.holder.as_ref().is_some_and(|h| {
            h.client_id == msg.holder.client_id
                && h.view_id == msg.holder.view_id
                && h.holder_generation == msg.holder.holder_generation
        });
        if !is_holder {
            return Self::geometry_refuse(
                leg,
                "NOT_HOLDER",
                lease.holder.as_ref().map(HolderRecord::wire),
                Some(lease.revision),
            );
        }
        lease.holder = None;
        lease.revision += 1;
        self.seat_announcements(&msg.session_id)
    }

    /// Auto-release: if `activation_id` holds the seat for `session_id`, clear it
    /// (view detach, leg death, grant expiry, liveness lapse — the four triggers).
    /// The view detach itself clears ghosttea's controller.
    ///
    /// Returns the empty seat's announcement (item 42, 2026-10-19) — nothing when
    /// the activation held no seat — and every caller hands it to the door with
    /// its own effects. An auto-release is a seat change like any other; until
    /// item 42 it was the silent one, and the pane it left sized could not say
    /// that nobody drove it any more.
    fn release_geometry_if_held(&mut self, session_id: &str, activation_id: &str) -> Vec<Effect> {
        let Some(lease) = self.geometry.get_mut(session_id) else {
            return Vec::new();
        };
        if !lease
            .holder
            .as_ref()
            .is_some_and(|h| h.activation_id == activation_id)
        {
            return Vec::new();
        }
        lease.holder = None;
        lease.revision += 1;
        self.seat_announcements(session_id)
    }

    /// item 42 (2026-10-19) — the session's seat as `GeometryState` carries it,
    /// tagged for the control leg; None while no size has ever been committed
    /// (the PTY is at its spawn size and no pane sized it — nothing to say). The
    /// holder's face is its activation's (`HolderRecord`'s note).
    fn seat_state_text(&self, session_id: &str) -> Option<String> {
        let lease = self.geometry.get(session_id)?;
        let (cols, rows) = lease.committed?;
        let holder = lease.holder.as_ref().map(|h| {
            let face = self
                .by_id
                .get(&h.activation_id)
                .and_then(|a| a.face.clone());
            h.announced(face)
        });
        Some(tagged(
            "GeometryState",
            &GeometryState {
                session_id: session_id.to_string(),
                holder,
                geometry_revision: lease.revision,
                cols,
                rows,
            },
        ))
    }

    /// item 42 — THE announcement: the session's `GeometryState` to the control
    /// leg of every activation of the session whose hello negotiated
    /// `geometry-events`, the caller's included. A caller's reply is already
    /// ahead of it in the effects it returns, and the door performs effects in
    /// order onto one writer channel per leg, so the reply arrives first.
    /// Activation-scoped: a leg with no activation of the session hears nothing
    /// of its seat, and an un-negotiated leg never hears it at all (ghosttea-react
    /// and the kit close a leg on an unknown tag).
    fn seat_announcements(&self, session_id: &str) -> Vec<Effect> {
        let Some(text) = self.seat_state_text(session_id) else {
            return Vec::new();
        };
        self.by_id
            .values()
            .filter(|a| a.session_id == session_id && a.control.geometry_events)
            .map(|a| Effect::Send(a.control.clone(), text.clone()))
            .collect()
    }

    /// item 42 — the seat told ONCE to a leg an attach just put an activation of
    /// the session on (ruled with item 42, 2026-10-19: a pane that mounts while
    /// another device drives says so at once, not at the next change — and a
    /// refusal's `currentHolder` carries no face). The caller places it right
    /// after the attach's `ControlLegAttached`. Nothing when the leg did not
    /// negotiate `geometry-events`, or no size has been committed yet.
    fn seat_state_to(&self, session_id: &str, leg: &LegRef) -> Option<Effect> {
        if !leg.geometry_events {
            return None;
        }
        self.seat_state_text(session_id)
            .map(|text| Effect::Send(leg.clone(), text))
    }

    /// `SendInput` (§5.4, TP-S3-input) — the cell-side gate for one input op.
    /// PURE read: it resolves the caller activation, applies every cell-side
    /// fence, and hands back the coordinates the door feeds ghosttea (whose own
    /// `authorize_input` is the engine backstop). A failed gate is a `Drop`,
    /// answered only where `input_refusal` allows it (C5). `now_ms` drives the
    /// renewal-margin expiry check so a stale-`Allowed` lease cannot leak input
    /// past the margin.
    pub fn send_input(&self, leg: &LegRef, msg: &SendInput, now_ms: u64) -> InputDecision {
        let Some(a) = self.by_id.get(&msg.activation_id) else {
            return InputDecision::Drop(InputDrop::NoActivation);
        };
        // The input thread is the CALLER's own control leg (a frames-leg or
        // foreign-connection SendInput is not this activation's).
        if a.control.connection_id != leg.connection_id || a.session_id != msg.session_id {
            return InputDecision::Drop(InputDrop::WrongLeg);
        }
        // Placement fence: the wire's leaseEpoch must match the route binding
        // (a stale-route input is refused before it reaches the engine).
        if msg.lease_epoch != a.lease_epoch {
            return InputDecision::Drop(InputDrop::StaleLeaseEpoch);
        }
        // The input lease dimension — the single source of truth for "may write"
        // (already encodes the input right, presentation, lag and expiry margin).
        if let Input::Suspended(reason) | Input::Revoked(reason) = a.input {
            return InputDecision::Drop(InputDrop::Lease(reason));
        }
        // Synchronous backstop: drop the moment the lease WOULD recompute to
        // `right-expired`, even if it has not been recomputed since.
        if now_ms + tp::ATTACH_RENEWAL_MARGIN_MS >= a.grant_expires_at_ms {
            return InputDecision::Drop(InputDrop::RightExpired);
        }
        // The fence coordinates the cell owns (never the wire): the presenting
        // view and its attachment epoch. Demand-none = no view = nothing to type.
        let Some((ghosttea_view_id, attachment_epoch)) = a.view.clone() else {
            return InputDecision::Drop(InputDrop::NoView);
        };
        InputDecision::Proceed(InputProceed {
            session_id: a.session_id.clone(),
            client_id: a.client_id.clone(),
            ghosttea_view_id,
            attachment_epoch,
            input_sequence: msg.input_sequence,
        })
    }

    /// C5 — what the CALLER of a refused `SendInput` may be told: the
    /// `InputRefused` reason, or None (`InputDrop::answer`, where the stranger
    /// rule is a type). The message's activation is checked again against the
    /// caller's own control leg, so a drop handed in for another message can
    /// never confirm an id the caller does not own (EL7).
    pub fn input_refusal(
        &self,
        leg: &LegRef,
        msg: &SendInput,
        dropped: InputDrop,
    ) -> Option<&'static str> {
        let a = self.by_id.get(&msg.activation_id)?;
        if a.control.connection_id != leg.connection_id || a.session_id != msg.session_id {
            return None;
        }
        dropped.answer()
    }

    /// `AttachControlLeg` after the grant VERIFIED and the attach high-water
    /// ADMITTED it (the door does both first — they need the verifier and the
    /// transport ledger). Returns the effects: one reply, maybe a view attach.
    ///
    /// item 42 (2026-10-19): an attach that puts an activation of the session
    /// on a `geometry-events` leg — a new activation, a replacement, or an
    /// activation moved onto a newer leg of its set — tells that leg the seat
    /// right after the reply (`seat_state_to`). A retry or a renewal on the leg
    /// the activation already rides tells it nothing new: that leg has heard
    /// every change since the activation first rode it.
    pub fn attach_control(&mut self, input: AttachControlInput<'_>) -> Vec<Effect> {
        let AttachControlInput {
            now_ms,
            set,
            leg,
            msg,
            claims,
            session_known,
        } = input;
        let activation_id = msg.activation_id.clone();
        // The grant must be THIS client's (nothing a grant carries is repeated
        // outside it, so this is the one cross-check that exists).
        if claims.client_id != set.client_id {
            return vec![Self::refuse(
                leg,
                Some(&activation_id),
                "GRANT_INVALID",
                false,
            )];
        }
        if !session_known {
            return vec![Self::refuse(
                leg,
                Some(&activation_id),
                "SESSION_UNKNOWN",
                false,
            )];
        }
        let key = (set.client_id.clone(), claims.session_id.clone());
        let mut effects = Vec::new();

        // An existing activation for {client, session}?
        if let Some(existing_id) = self.by_key.get(&key).cloned() {
            if existing_id == activation_id {
                // item 42 — an attach that MOVES the activation onto a newer
                // leg of its set puts it on a leg that has heard nothing of the
                // seat. Read before the renewal below touches anything, so the
                // leg is told the seat its reply answers.
                let moved_to_leg = self
                    .by_id
                    .get(&existing_id)
                    .filter(|a| a.control.connection_id != leg.connection_id)
                    .and_then(|_| self.seat_state_to(&claims.session_id, leg));
                // Idempotent retry — or a RENEWAL (a newer generation updates
                // rights/expiry; a downgrade applies at once).
                let a = self.by_id.get_mut(&existing_id).expect("indexed");
                if claims.grant_generation < a.grant_generation {
                    return vec![Self::refuse(
                        leg,
                        Some(&activation_id),
                        "GRANT_GENERATION_ROLLBACK",
                        false,
                    )];
                }
                let renewed = claims.grant_generation > a.grant_generation;
                let mut dropped_geometry = false;
                if renewed {
                    let had_input = a.has_right(AttachRight::Input);
                    let had_geometry = a.has_right(AttachRight::Geometry);
                    a.rights = claims.rights.clone();
                    a.grant_generation = claims.grant_generation;
                    a.grant_expires_at_ms = claims.expires_at;
                    // item 42 — the face follows the newest grant, as the rights
                    // do; the next announcement of a seat it holds carries it
                    a.face = claims.face.clone();
                    if had_input && !a.has_right(AttachRight::Input) {
                        a.input = Input::Revoked("right-revoked");
                    } else if matches!(a.input, Input::Suspended("right-expired")) {
                        // a renewal in time reopens what the margin closed
                        a.input = Input::Suspended("pending");
                    }
                    // a renewal that DROPS geometry revokes the seat at once (a
                    // renewal that retains it keeps the holder — the activation,
                    // and thus the seat, survives the grant bump automatically).
                    dropped_geometry = had_geometry && !a.has_right(AttachRight::Geometry);
                    // a renewed view access may differ (read-write ⇄ read-only):
                    // the pump's view is re-attached by the door when it changes
                }
                // the control leg may have been replaced by a newer leg of the set
                a.control = leg.clone();
                effects.push(Effect::Send(
                    leg.clone(),
                    tagged(
                        "ControlLegAttached",
                        &ControlLegAttached {
                            session_id: a.session_id.clone(),
                            activation_id: a.activation_id.clone(),
                            grant_generation_accepted: a.grant_generation,
                            rights: a.rights.clone(),
                        },
                    ),
                ));
                effects.extend(moved_to_leg);
                if renewed {
                    Self::recompute_input(a, now_ms);
                    effects.push(Self::status_effect(a));
                }
                if dropped_geometry {
                    effects.extend(self.release_geometry_if_held(&claims.session_id, &existing_id));
                }
                return effects;
            }
            // A DIFFERENT id must name what it replaces.
            if msg.replaces_activation_id.as_deref() == Some(existing_id.as_str()) {
                effects.extend(self.invalidate(&existing_id, "replaced", true));
            } else {
                return vec![Self::refuse(
                    leg,
                    Some(&activation_id),
                    "ACTIVATION_CONFLICT",
                    true,
                )];
            }
        }
        if self.by_id.len() >= self.max_activations {
            return vec![Self::refuse(leg, Some(&activation_id), "CAPACITY", true)];
        }
        if self.by_id.contains_key(&activation_id) {
            // the id is taken by ANOTHER key — ids are fresh and non-reused
            return vec![Self::refuse(
                leg,
                Some(&activation_id),
                "ACTIVATION_CONFLICT",
                false,
            )];
        }
        let has_input = claims.rights.contains(&AttachRight::Input);
        let activation = Activation {
            activation_id: activation_id.clone(),
            client_id: set.client_id.clone(),
            connection_set_id: set.connection_set_id.clone(),
            session_id: claims.session_id.clone(),
            rights: claims.rights.clone(),
            grant_generation: claims.grant_generation,
            grant_expires_at_ms: claims.expires_at,
            lease_epoch: claims.lease_epoch.unwrap_or(0),
            face: claims.face.clone(),
            control: leg.clone(),
            frames: None,
            created_at: Instant::now(),
            demand: msg.initial_demand.mode,
            demand_sequence: 0,
            view: None,
            presentation: Presentation::Pending,
            input: if has_input {
                Input::Suspended("pending")
            } else {
                Input::Revoked("not-granted")
            },
            status_sequence: 0,
            accepted: None,
            resume_token: None,
            trf_identity: None,
            scene_epoch: None,
            seed_revision: None,
            resume_revision: None,
            pump_running: false,
            unacked: VecDeque::new(),
            last_status_sent_at: None,
        };
        let reply = tagged(
            "ControlLegAttached",
            &ControlLegAttached {
                session_id: activation.session_id.clone(),
                activation_id: activation_id.clone(),
                grant_generation_accepted: activation.grant_generation,
                rights: activation.rights.clone(),
            },
        );
        let wants_view = activation.demand == SourceDemandMode::Live;
        let session_id = activation.session_id.clone();
        self.by_key.insert(key, activation_id.clone());
        self.by_id.insert(activation_id.clone(), activation);
        effects.push(Effect::Send(leg.clone(), reply));
        // item 42 — the new activation's leg is told the seat as it stands (a
        // replaced predecessor's hold was released above, and announced)
        effects.extend(self.seat_state_to(&session_id, leg));
        if wants_view {
            effects.push(Effect::AttachView {
                activation_id: activation_id.clone(),
                session_id,
                client_id: set.client_id.clone(),
                view_id: activation_id,
                // geometry is a terminal WRITE too: ghosttea gates size control on
                // a read-write view. The cell still gates BYTE input on the input
                // right + the 2-D lease, so a geometry-only view never types.
                read_write: has_input || claims.rights.contains(&AttachRight::Geometry),
            });
        }
        effects
    }

    /// `AttachFramesLeg` after the grant verified: binds the frames leg, mints
    /// the resume token, declares the TRF1 identity; the pump starts if the
    /// view is attached (demand live) — else on the next `DeclareDemand{live}`.
    pub fn attach_frames(&mut self, input: AttachFramesInput<'_>) -> Vec<Effect> {
        let AttachFramesInput {
            set,
            leg,
            msg,
            claims,
            trf_identity,
            resume_token,
            session_epoch,
        } = input;
        let activation_id = msg.activation_id.clone();
        if claims.client_id != set.client_id {
            return vec![Self::refuse(
                leg,
                Some(&activation_id),
                "GRANT_INVALID",
                false,
            )];
        }
        let Some(a) = self.by_id.get(&activation_id) else {
            // No control attach yet (or gone): the runtime attaches control first.
            return vec![Self::refuse(
                leg,
                Some(&activation_id),
                "ACTIVATION_CONFLICT",
                true,
            )];
        };
        if a.client_id != set.client_id
            || a.connection_set_id != set.connection_set_id
            || a.session_id != claims.session_id
        {
            return vec![Self::refuse(
                leg,
                Some(&activation_id),
                "GRANT_INVALID",
                false,
            )];
        }
        if claims.grant_generation < a.grant_generation {
            return vec![Self::refuse(
                leg,
                Some(&activation_id),
                "GRANT_GENERATION_ROLLBACK",
                false,
            )];
        }
        let Some(trf) = trf_identity else {
            return vec![Self::refuse(
                leg,
                Some(&activation_id),
                "SESSION_UNKNOWN",
                false,
            )];
        };
        let current_scene_epoch = self.resolve_scene_epoch(&claims.session_id, session_epoch);
        let a = self
            .by_id
            .get_mut(&activation_id)
            .expect("the activation was validated above");
        // A replaced frames leg: the old one's pump stops with its leg (the door
        // invalidates activations on a closed leg); a re-attach on the same leg
        // is idempotent.
        let lineage_changed = a
            .scene_epoch
            .as_ref()
            .is_some_and(|epoch| epoch != &current_scene_epoch);
        let already = a
            .frames
            .as_ref()
            .is_some_and(|f| f.connection_id == leg.connection_id)
            && !lineage_changed;
        a.frames = Some(leg.clone());
        if lineage_changed {
            // the new lineage's revisions do not compare with the old one's
            a.resume_revision = None;
            a.unacked.clear();
        }
        if a.resume_token.is_none() {
            a.resume_token = Some(resume_token);
        }
        a.trf_identity = Some(trf.clone());
        a.scene_epoch = Some(current_scene_epoch.clone());
        if let Some(ledger) = self.credit.get_mut(&leg.connection_id) {
            ledger.open_account(&activation_id);
        }
        let mut effects = vec![Effect::Send(
            leg.clone(),
            tagged(
                "FramesLegAttached",
                &FramesLegAttached {
                    session_id: a.session_id.clone(),
                    activation_id: activation_id.clone(),
                    resume_token: a.resume_token.clone().expect("minted above"),
                    trf_identity: trf,
                    outcome: FramesAttachOutcome {
                        kind: "seed-required".to_string(),
                        from: None,
                        newest_available: None,
                        // The honest reason (S3c): a resume whose `from` names a
                        // different SceneEpoch is a MIGRATION (`epoch-changed`);
                        // a same-epoch resume is viable but the dormant-cursor
                        // machinery is capability-gated (capabilities §5.4) and not
                        // in the core profile, so it still seeds.
                        reason: Some(match &msg.resume {
                            Some(resume) => {
                                if resume.from.scene_epoch != current_scene_epoch {
                                    "epoch-changed".to_string()
                                } else {
                                    "no-resume-capability".to_string()
                                }
                            }
                            None => "no-cursor".to_string(),
                        }),
                    },
                },
            ),
        )];
        if lineage_changed && a.pump_running {
            a.pump_running = false;
            effects.push(Effect::StopPump {
                activation_id: activation_id.clone(),
            });
        }
        if !already && a.view.is_some() && !a.pump_running {
            a.pump_running = true;
            effects.push(Effect::StartPump {
                activation_id: activation_id.clone(),
            });
        }
        effects
    }

    /// The door attached the ghosttea view for an activation.
    pub fn view_attached(&mut self, activation_id: &str, view_id: &str, epoch: u64) -> Vec<Effect> {
        let Some(a) = self.by_id.get_mut(activation_id) else {
            return Vec::new();
        };
        a.view = Some((view_id.to_string(), epoch));
        if a.frames.is_some() && !a.pump_running {
            a.pump_running = true;
            return vec![Effect::StartPump {
                activation_id: activation_id.to_string(),
            }];
        }
        vec![Effect::WakePump {
            activation_id: activation_id.to_string(),
        }]
    }

    /// The door detached the ghosttea view for an activation. Returns the empty
    /// seat's announcement when the view held the seat (item 42) — the door
    /// performs it like any table effect; nothing when the activation held no
    /// seat, or has already left the table (`invalidate` released it first).
    pub fn view_detached(&mut self, activation_id: &str) -> Vec<Effect> {
        let session = self.by_id.get_mut(activation_id).map(|a| {
            a.view = None;
            a.session_id.clone()
        });
        // view detach ⇒ geometry revoke (one of the four auto-release triggers):
        // a demand-none that parked the view gives up the seat too.
        match session {
            Some(session_id) => self.release_geometry_if_held(&session_id, activation_id),
            None => Vec::new(),
        }
    }

    /// `DeclareDemand`: per-activation monotonic sequence; idempotent re-sends;
    /// `none` releases the view (warm), `live` attaches it (hot).
    pub fn declare_demand(&mut self, leg: &LegRef, msg: DeclareDemand) -> Vec<Effect> {
        let Some(a) = self.by_id.get_mut(&msg.activation_id) else {
            // a stale activation's demand is dropped by the cell (§7)
            return Vec::new();
        };
        if a.control.connection_id != leg.connection_id || a.session_id != msg.session_id {
            return Vec::new();
        }
        let accepted = Effect::Send(
            leg.clone(),
            tagged(
                "DemandAccepted",
                &DemandAccepted {
                    demand_sequence: msg.demand_sequence,
                },
            ),
        );
        if msg.demand_sequence <= a.demand_sequence && a.demand_sequence != 0 {
            return vec![accepted];
        }
        a.demand_sequence = msg.demand_sequence;
        let before = a.demand;
        a.demand = msg.demand.mode;
        let mut effects = vec![accepted];
        match (before, a.demand) {
            (SourceDemandMode::Live, SourceDemandMode::Live) => {}
            (_, SourceDemandMode::Live) => {
                if a.view.is_none() {
                    effects.push(Effect::AttachView {
                        activation_id: a.activation_id.clone(),
                        session_id: a.session_id.clone(),
                        client_id: a.client_id.clone(),
                        view_id: a.activation_id.clone(),
                        read_write: a.has_right(AttachRight::Input)
                            || a.has_right(AttachRight::Geometry),
                    });
                }
            }
            (_, _) => {
                if let Some((view_id, _)) = a.view.clone() {
                    effects.push(Effect::DetachView {
                        activation_id: a.activation_id.clone(),
                        session_id: a.session_id.clone(),
                        client_id: a.client_id.clone(),
                        view_id,
                    });
                }
                effects.push(Effect::WakePump {
                    activation_id: a.activation_id.clone(),
                });
            }
        }
        effects
    }

    /// `SceneApplied` from the worker: progress, the lease answered.
    pub fn scene_applied(&mut self, leg: &LegRef, msg: SceneApplied, now_ms: u64) -> Vec<Effect> {
        let Some(a) = self.by_id.get_mut(&msg.activation_id) else {
            return Vec::new();
        };
        if a.frames.as_ref().map(|f| f.connection_id) != Some(leg.connection_id)
            || a.session_id != msg.session_id
        {
            return Vec::new();
        }
        let presentation_before = a.presentation;
        let input_before = a.input;
        let same_epoch = a
            .accepted
            .as_ref()
            .is_none_or(|s| s.scene_epoch == msg.applied_content.scene_epoch);
        let advances = same_epoch
            && a.accepted
                .as_ref()
                .is_none_or(|s| msg.applied_content.scene_revision >= s.scene_revision);
        if advances || !same_epoch {
            a.accepted = Some(msg.applied_content.clone());
        }
        // C5 — the worker holds everything through this revision: those units
        // leave the lag ledger. Only an ack in the units' OWN lineage does —
        // another lineage's revisions say nothing about this one's.
        if a.scene_epoch.as_ref() == Some(&msg.applied_content.scene_epoch) {
            let through = msg.applied_content.scene_revision;
            while a
                .unacked
                .front()
                .is_some_and(|(revision, _)| *revision <= through)
            {
                a.unacked.pop_front();
            }
        }
        if a.presentation == Presentation::Pending {
            if let Some(seed) = a.seed_revision {
                if msg.applied_content.scene_revision >= seed {
                    a.presentation = Presentation::Presenting;
                }
            }
        }
        // C3 — an overload stop is a state, not an end: the first unit the pump
        // sent after it, applied, means the scene is advancing again. This is
        // the contracts' `stalled → presenting` row, which both clients take.
        if a.presentation == Presentation::Stopped("overload")
            && a.resume_revision
                .is_some_and(|resume| msg.applied_content.scene_revision >= resume)
        {
            a.presentation = Presentation::Presenting;
            a.resume_revision = None;
        }
        Self::recompute_input(a, now_ms);
        // Progress is recorded for every frame, but unchanged leases need only
        // refresh before their TTL. State transitions still reach main immediately.
        if a.presentation != presentation_before
            || a.input != input_before
            || a.last_status_sent_at.is_none_or(|at| {
                at.elapsed() >= Duration::from_millis(tp::PRESENTATION_STATUS_REFRESH_MS)
            })
        {
            vec![Self::status_effect(a)]
        } else {
            Vec::new()
        }
    }

    /// The pump sent a unit (a seed/catch-up transfer or a delta) ending at `revision`.
    pub fn unit_sent(&mut self, activation_id: &str, revision: u64, seed: bool) -> Vec<Effect> {
        let Some(a) = self.by_id.get_mut(activation_id) else {
            return Vec::new();
        };
        // C5 — the lag ledger: what was sent, and when, until the worker says it
        // holds it (bounded — `UNACKED_UNITS_CAP`).
        if a.unacked.len() >= UNACKED_UNITS_CAP {
            if let Some(newest) = a.unacked.back_mut() {
                newest.0 = revision;
            }
        } else {
            a.unacked.push_back((revision, Instant::now()));
        }
        if seed && a.seed_revision.is_none() {
            a.seed_revision = Some(revision);
        }
        // C3 — the first unit after an overload stop: `scene_applied` turns the
        // lease back to presenting once the worker has applied it.
        if a.presentation == Presentation::Stopped("overload") && a.resume_revision.is_none() {
            a.resume_revision = Some(revision);
        }
        Vec::new()
    }

    /// The pump reports an overload stop (§8: recovery terminates bounded — in
    /// a STATE: the pump keeps waiting, and the credit that returns recovers
    /// it through `unit_sent` + `scene_applied`). One stall can outlive several
    /// bounded waits (each chunk of a transfer starving past the bound): the
    /// lease says it once, and a repeat report only moves the recovery on to a
    /// unit sent after it.
    pub fn presentation_stopped(
        &mut self,
        activation_id: &str,
        reason: &'static str,
        now_ms: u64,
    ) -> Vec<Effect> {
        let Some(a) = self.by_id.get_mut(activation_id) else {
            return Vec::new();
        };
        // a session that EXITED (C8 — final: the pump starving on a dead
        // session's last frames never replaces it)
        if a.presentation == Presentation::Stopped("exited") {
            return Vec::new();
        }
        // The same stop said again: nothing new for the wire — but a report IS
        // the pump starved now, parked in a wait with no bound that will never
        // report again. A recovery unit sent BEFORE this report does not end
        // the stop: its ack would turn the lease presenting (input allowed)
        // over a pump still parked and a screen still frozen. Only a unit sent
        // after this report does.
        if a.presentation == Presentation::Stopped(reason) {
            a.resume_revision = None;
            return Vec::new();
        }
        a.presentation = Presentation::Stopped(reason);
        a.resume_revision = None;
        Self::recompute_input(a, now_ms);
        vec![Self::status_effect(a)]
    }

    /// C8 — the session's program EXITED (the lifecycle bus, or
    /// the source's own summary): every activation of it is told at once —
    /// presentation `stopped{exited}` (the scene stops advancing; its last
    /// frame stays the viewer's) and input `revoked{exited}` (there is no PTY to
    /// write to; a revoked input never comes back on its own). Final: neither
    /// an overload stop nor a seed applied after it moves the lease. Idempotent.
    pub fn session_exited(&mut self, session_id: &str) -> Vec<Effect> {
        let mut effects = Vec::new();
        for a in self
            .by_id
            .values_mut()
            .filter(|a| a.session_id == session_id)
        {
            if a.presentation == Presentation::Stopped("exited") {
                continue;
            }
            a.presentation = Presentation::Stopped("exited");
            a.input = Input::Revoked("exited");
            a.resume_revision = None;
            effects.push(Self::status_effect(a));
        }
        effects
    }

    /// C8 — the session left the engine's registry: every activation of it is
    /// revoked `removed` — the invalidation a dead leg gets (the lease said on
    /// the control leg, the view detached, the pump stopped, the credit account
    /// draining, the geometry seat released). Both clients end the activation
    /// on it: the PTY is gone, and nothing re-attaches to it.
    pub fn session_removed(&mut self, session_id: &str) -> Vec<Effect> {
        let ids: Vec<String> = self
            .by_id
            .values()
            .filter(|a| a.session_id == session_id)
            .map(|a| a.activation_id.clone())
            .collect();
        let mut effects = Vec::new();
        for id in ids {
            effects.extend(self.invalidate(&id, "removed", false));
        }
        effects
    }

    /// The sessions the table holds activations for, once each — what the door
    /// reconciles against the source when its lifecycle receiver lagged (C8).
    pub fn session_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.by_id.values().map(|a| a.session_id.clone()).collect();
        ids.sort();
        ids.dedup();
        ids
    }

    /// Credit returned on a frames connection: wake the pumps whose windows moved.
    pub fn credit_returned(&mut self, connection_id: u64, credit: &TransportCredit) -> Vec<Effect> {
        let Some(ledger) = self.credit.get_mut(&connection_id) else {
            return Vec::new();
        };
        ledger
            .returned(credit)
            .into_iter()
            .map(|activation_id| Effect::WakePump { activation_id })
            .collect()
    }

    /// The pump asks to admit `bytes` of `class` for an activation on a frames connection.
    pub fn try_admit(
        &mut self,
        connection_id: u64,
        activation_id: &str,
        bytes: u64,
        class: UnitClass,
    ) -> bool {
        self.credit
            .get_mut(&connection_id)
            .is_some_and(|l| l.try_admit(activation_id, bytes, class))
    }

    /// Non-mutating twin: `None` when the connection's ledger or the account is gone.
    pub fn can_admit(
        &self,
        connection_id: u64,
        activation_id: &str,
        bytes: u64,
        class: UnitClass,
    ) -> Option<bool> {
        self.credit
            .get(&connection_id)
            .and_then(|l| l.can_admit(activation_id, bytes, class))
    }

    /// Does the activation want frames right now (demand live and the view attached)?
    pub fn wants_frames(&self, activation_id: &str) -> bool {
        self.by_id
            .get(activation_id)
            .is_some_and(|a| a.demand == SourceDemandMode::Live && a.view.is_some())
    }

    /// Invalidate one activation: the lease revoked on the control leg (if it
    /// is not the leg that died), the view detached, the pump stopped, the
    /// credit account set draining. `keep_key` = a replacement takes the key.
    fn invalidate(
        &mut self,
        activation_id: &str,
        reason: &'static str,
        keep_key: bool,
    ) -> Vec<Effect> {
        let Some(mut a) = self.by_id.remove(activation_id) else {
            return Vec::new();
        };
        if !keep_key {
            self.by_key
                .remove(&(a.client_id.clone(), a.session_id.clone()));
        } else {
            // the caller inserts the replacement under the same key
            self.by_key
                .remove(&(a.client_id.clone(), a.session_id.clone()));
        }
        // auto-release the geometry seat (connection death / grant expiry /
        // liveness lapse all funnel here); the DetachView below clears ghosttea's
        // controller. A replacement's new activation re-claims if it wants it.
        // item 42: the empty seat is announced to the session's OTHER
        // activations — this one has already left the table, and its own leg
        // hears its revocation below instead.
        let mut effects = self.release_geometry_if_held(&a.session_id, activation_id);
        a.presentation = Presentation::Revoked(reason);
        a.input = Input::Revoked(reason);
        a.status_sequence += 1;
        if !a.control.out.is_closed() {
            effects.push(Effect::Send(
                a.control.clone(),
                tagged("CellActivationStatus", &a.status()),
            ));
        }
        if let Some((view_id, _)) = a.view.take() {
            effects.push(Effect::DetachView {
                activation_id: a.activation_id.clone(),
                session_id: a.session_id.clone(),
                client_id: a.client_id.clone(),
                view_id,
            });
        }
        if a.pump_running {
            effects.push(Effect::StopPump {
                activation_id: a.activation_id.clone(),
            });
        }
        if let Some(frames) = &a.frames {
            if let Some(ledger) = self.credit.get_mut(&frames.connection_id) {
                ledger.close_account(&a.activation_id);
            }
        }
        effects
    }

    /// A leg closed: every activation using it is invalidated (`leg-dead`);
    /// a frames connection's ledger goes with its leg (law 4: a new leg is a
    /// new credit epoch).
    pub fn leg_closed(&mut self, connection_id: u64) -> Vec<Effect> {
        let ids: Vec<String> = self
            .by_id
            .values()
            .filter(|a| {
                a.control.connection_id == connection_id
                    || a.frames
                        .as_ref()
                        .is_some_and(|f| f.connection_id == connection_id)
            })
            .map(|a| a.activation_id.clone())
            .collect();
        let mut effects = Vec::new();
        for id in ids {
            effects.extend(self.invalidate(&id, "leg-dead", false));
        }
        self.credit.remove(&connection_id);
        effects
    }

    /// `RevokeClient` (F1): every activation of the client ends `right-revoked`, the reason a
    /// lapsed grant already gives.
    pub fn revoke_client(&mut self, client_id: &str) -> Vec<Effect> {
        let ids: Vec<String> = (self.by_id.values())
            .filter(|a| a.client_id == client_id)
            .map(|a| a.activation_id.clone())
            .collect();
        let mut effects = Vec::new();
        for id in ids {
            effects.extend(self.invalidate(&id, "right-revoked", false));
        }
        effects
    }

    /// Periodic: attach deadlines, grant expiry, lag by time. Returns statuses
    /// to send and the activations to drop.
    pub fn tick(&mut self, now_ms: u64) -> Vec<Effect> {
        let mut effects = Vec::new();
        let expired: Vec<String> = self
            .by_id
            .values()
            .filter(|a| now_ms >= a.grant_expires_at_ms)
            .map(|a| a.activation_id.clone())
            .collect();
        for id in expired {
            effects.extend(self.invalidate(&id, "right-revoked", false));
        }
        let deadline = self.attach_deadline;
        let pending: Vec<String> = self
            .by_id
            .values()
            .filter(|a| a.frames.is_none() && a.created_at.elapsed() > deadline)
            .map(|a| a.activation_id.clone())
            .collect();
        for id in pending {
            effects.extend(self.invalidate(&id, "attach-deadline", false));
        }
        for a in self.by_id.values_mut() {
            if Self::recompute_input(a, now_ms) {
                effects.push(Self::status_effect(a));
            }
        }
        effects
    }

    /// For the door's snapshot/tests.
    pub fn summary(&self) -> Vec<(String, String, String, Presentation, Input)> {
        let mut rows: Vec<_> = self
            .by_id
            .values()
            .map(|a| {
                (
                    a.activation_id.clone(),
                    a.client_id.clone(),
                    a.session_id.clone(),
                    a.presentation,
                    a.input,
                )
            })
            .collect();
        rows.sort();
        rows
    }
}

impl PartialOrd for Presentation {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Presentation {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        format!("{self:?}").cmp(&format!("{other:?}"))
    }
}
impl PartialOrd for Input {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Input {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        format!("{self:?}").cmp(&format!("{other:?}"))
    }
}

#[cfg(test)]
mod tests {
    /// The table's clock for every geometry verb below that does not test time
    /// itself: inside every fixture grant's `[issued, expires)` window.
    const NOW: u64 = 1_000;

    use super::*;
    use crate::tp::wire::{InputOp, SourceDemand};
    use tokio::sync::mpsc::unbounded_channel;

    fn leg(connection_id: u64) -> (LegRef, tokio::sync::mpsc::UnboundedReceiver<Outbound>) {
        let (tx, rx) = unbounded_channel();
        (
            LegRef {
                connection_id,
                leg_generation: 1,
                out: tx,
                bulk_credit: None,
                geometry_events: false,
            },
            rx,
        )
    }

    fn claims(session: &str, generation: u64, rights: &[AttachRight]) -> AttachClaims {
        AttachClaims {
            audience_cell_boot_id: "cb".into(),
            client_id: "win:1#1".into(),
            session_id: session.into(),
            lease_epoch: None,
            route_revision: 1,
            grant_generation: generation,
            rights: rights.to_vec(),
            issued_at: 1_000,
            expires_at: 1_000 + 600_000,
            face: None,
        }
    }

    fn set() -> SetIdentity {
        SetIdentity {
            client_id: "win:1#1".into(),
            connection_set_id: "win:1#1@cb".into(),
        }
    }

    fn control_msg(id: &str, replaces: Option<&str>, live: bool) -> AttachControlLeg {
        AttachControlLeg {
            activation_id: id.into(),
            attach_grant: serde_json::json!({}),
            replaces_activation_id: replaces.map(str::to_string),
            initial_demand: SourceDemand {
                mode: if live {
                    SourceDemandMode::Live
                } else {
                    SourceDemandMode::None
                },
                cadence_class: None,
                urgency: None,
            },
        }
    }

    /// A contracts golden (EL9): the bytes the TS schema and the kit parse.
    fn fixture(name: &str) -> serde_json::Value {
        let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures")
            .join(name);
        serde_json::from_str(&std::fs::read_to_string(&p).expect("fixture read")).expect("json")
    }

    fn texts(rx: &mut tokio::sync::mpsc::UnboundedReceiver<Outbound>) -> Vec<serde_json::Value> {
        let mut out = Vec::new();
        while let Ok(m) = rx.try_recv() {
            if let Outbound::Text(t) = m {
                out.push(serde_json::from_str(&t).unwrap());
            }
        }
        out
    }

    fn perform(effects: Vec<Effect>) {
        for e in effects {
            if let Effect::Send(leg, text) = e {
                leg.send_text(text);
            }
        }
    }

    #[test]
    fn opaque_engine_lineages_get_stable_non_reused_json_safe_generations() {
        let mut t = ActivationTable::new("cb");

        let first = t.resolve_scene_epoch("s1", u64::MAX);
        assert_eq!(first.model_generation, 1);
        assert!(first.model_generation <= JSON_MAX_SAFE_INTEGER);
        assert_eq!(
            t.resolve_scene_epoch("s1", u64::MAX),
            first,
            "one engine lineage keeps one protocol generation"
        );

        let reset = t.resolve_scene_epoch("s1", u64::MAX - 1);
        let other_session = t.resolve_scene_epoch("s2", u64::MAX);
        assert_eq!(reset.model_generation, 2);
        assert_eq!(other_session.model_generation, 3);

        t.prune_model_generations(|session_id| session_id == "s2");
        assert_eq!(t.model_generations.len(), 1);
        assert_eq!(
            t.resolve_scene_epoch("s1", u64::MAX).model_generation,
            4,
            "pruning can reclaim identity tokens but never reuse their stamps"
        );
    }

    #[test]
    fn attach_is_idempotent_conflicts_without_replaces_and_replaces_with_it() {
        let mut t = ActivationTable::new("cb");
        let (control, mut rx) = leg(1);
        let full = [AttachRight::Geometry, AttachRight::Input, AttachRight::Read];
        let first = t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set(),
            leg: &control,
            msg: control_msg("a1", None, true),
            claims: claims("s1", 1, &full),
            session_known: true,
        });
        assert!(matches!(
            first[1],
            Effect::AttachView {
                read_write: true,
                ..
            }
        ));
        perform(first);
        let replies = texts(&mut rx);
        assert_eq!(replies[0]["type"], "ControlLegAttached");
        assert_eq!(
            replies[0]["rights"],
            serde_json::json!(["geometry", "input", "read"])
        );
        // idempotent
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set(),
            leg: &control,
            msg: control_msg("a1", None, true),
            claims: claims("s1", 1, &full),
            session_known: true,
        }));
        assert_eq!(texts(&mut rx)[0]["type"], "ControlLegAttached");
        // a different id without replaces: conflict
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set(),
            leg: &control,
            msg: control_msg("a2", None, true),
            claims: claims("s1", 1, &full),
            session_known: true,
        }));
        let r = texts(&mut rx);
        assert_eq!(r[0]["type"], "AttachRefused");
        assert_eq!(r[0]["code"], "ACTIVATION_CONFLICT");
        assert_eq!(r[0]["retryable"], true);
        // naming what it replaces: the old one is revoked{replaced}, the new one attached
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set(),
            leg: &control,
            msg: control_msg("a2", Some("a1"), true),
            claims: claims("s1", 1, &full),
            session_known: true,
        }));
        let r = texts(&mut rx);
        assert_eq!(r[0]["type"], "CellActivationStatus");
        assert_eq!(r[0]["activationId"], "a1");
        assert_eq!(r[0]["presentation"]["state"], "revoked");
        assert_eq!(r[0]["presentation"]["reason"], "replaced");
        assert_eq!(r[1]["type"], "ControlLegAttached");
        assert_eq!(r[1]["activationId"], "a2");
        assert_eq!(t.len(), 1);
        // unknown session / wrong client
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set(),
            leg: &control,
            msg: control_msg("a3", None, true),
            claims: claims("ghost", 1, &full),
            session_known: false,
        }));
        assert_eq!(texts(&mut rx)[0]["code"], "SESSION_UNKNOWN");
        let mut other = claims("s9", 1, &full);
        other.client_id = "win:2#2".into();
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set(),
            leg: &control,
            msg: control_msg("a4", None, true),
            claims: other,
            session_known: true,
        }));
        assert_eq!(texts(&mut rx)[0]["code"], "GRANT_INVALID");
    }

    #[test]
    fn the_lease_presenting_after_the_seed_applies_and_input_follows_rights_and_lag() {
        let mut t = ActivationTable::new("cb");
        let (control, mut crx) = leg(1);
        let (frames, mut frx) = leg(2);
        t.open_credit(
            2,
            1,
            ReceiverCapacities {
                connection_credit_bytes: 1_000,
                per_activation_credit_bytes: 500,
                staging_bytes_per_session: 0,
                staging_bytes_total: 0,
                max_concurrent_activations: 8,
                max_concurrent_seeds: 1,
            },
            0,
        );
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set(),
            leg: &control,
            msg: control_msg("a1", None, true),
            claims: claims("s1", 1, &[AttachRight::Input, AttachRight::Read]),
            session_known: true,
        }));
        texts(&mut crx);
        // the view attaches; the frames leg attaches; the pump starts
        let e = t.view_attached("a1", "a1", 7);
        assert!(e.is_empty() || matches!(e[0], Effect::WakePump { .. }));
        let e = t.attach_frames(AttachFramesInput {
            set: &set(),
            leg: &frames,
            msg: AttachFramesLeg {
                activation_id: "a1".into(),
                attach_grant: serde_json::json!({}),
                resume: None,
            },
            claims: claims("s1", 1, &[AttachRight::Input, AttachRight::Read]),
            trf_identity: Some(TrfIdentity {
                session_handle: "77".into(),
                view_handle: "77".into(),
            }),
            resume_token: "rt".into(),
            session_epoch: 0,
        });
        assert!(matches!(e[1], Effect::StartPump { .. }));
        perform(e);
        let r = texts(&mut frx);
        assert_eq!(r[0]["type"], "FramesLegAttached");
        assert_eq!(r[0]["trfIdentity"]["sessionHandle"], "77");
        assert_eq!(r[0]["outcome"]["kind"], "seed-required");
        // credit: the account opened with the per-activation window
        assert!(t.try_admit(2, "a1", 400, UnitClass::Urgent));
        assert!(
            !t.try_admit(2, "a1", 200, UnitClass::Urgent),
            "per-activation window exhausted"
        );
        // the seed sent at revision 10; SceneApplied(10) ⇒ presenting, input allowed
        t.unit_sent("a1", 10, true);
        let epoch = t.scene_epoch(1);
        perform(t.scene_applied(
            &frames,
            SceneApplied {
                session_id: "s1".into(),
                activation_id: "a1".into(),
                lease_epoch: 0,
                applied_content: SceneContentStamp {
                    scene_epoch: epoch.clone(),
                    scene_revision: 10,
                },
            },
            3_000,
        ));
        let s = texts(&mut crx);
        assert_eq!(s[0]["type"], "CellActivationStatus");
        assert_eq!(s[0]["presentation"]["state"], "presenting");
        assert_eq!(s[0]["input"]["state"], "allowed");
        assert_eq!(s[0]["acceptedContent"]["sceneRevision"], 10);
        assert_eq!(s[0]["cellStatusSequence"], 1);
        // Stable progress updates the ledger without another renderer-main task.
        let quiet = SceneApplied {
            session_id: "s1".into(),
            activation_id: "a1".into(),
            lease_epoch: 0,
            applied_content: SceneContentStamp {
                scene_epoch: epoch.clone(),
                scene_revision: 10,
            },
        };
        assert!(t.scene_applied(&frames, quiet.clone(), 3_001).is_empty());
        t.by_id.get_mut("a1").unwrap().last_status_sent_at =
            Some(Instant::now() - Duration::from_millis(tp::PRESENTATION_STATUS_REFRESH_MS + 1));
        perform(t.scene_applied(&frames, quiet, 3_002));
        assert_eq!(texts(&mut crx)[0]["input"]["state"], "allowed");
        // lag: a unit the worker has not acknowledged for longer than the
        // bound ⇒ suspended{lagging} (C5: its AGE, never how far its revision is)
        t.unit_sent("a1", 120, false);
        t.by_id.get_mut("a1").unwrap().unacked.back_mut().unwrap().1 =
            Instant::now() - Duration::from_millis(tp::INPUT_LAG_SUSPEND_MS + 1);
        perform(t.scene_applied(
            &frames,
            SceneApplied {
                session_id: "s1".into(),
                activation_id: "a1".into(),
                lease_epoch: 0,
                applied_content: SceneContentStamp {
                    scene_epoch: epoch.clone(),
                    scene_revision: 11,
                },
            },
            3_100,
        ));
        let s = texts(&mut crx);
        assert_eq!(s[0]["presentation"]["state"], "presenting");
        assert_eq!(s[0]["input"]["state"], "suspended");
        assert_eq!(s[0]["input"]["reason"], "lagging");
        // caught up ⇒ allowed again
        perform(t.scene_applied(
            &frames,
            SceneApplied {
                session_id: "s1".into(),
                activation_id: "a1".into(),
                lease_epoch: 0,
                applied_content: SceneContentStamp {
                    scene_epoch: epoch.clone(),
                    scene_revision: 120,
                },
            },
            3_200,
        ));
        assert_eq!(texts(&mut crx)[0]["input"]["state"], "allowed");
        // the frames leg dies: the control leg learns revoked{leg-dead}, the pump stops
        let e = t.leg_closed(2);
        assert!(e.iter().any(|x| matches!(x, Effect::StopPump { .. })));
        assert!(e.iter().any(|x| matches!(x, Effect::DetachView { .. })));
        perform(e);
        let s = texts(&mut crx);
        assert_eq!(s[0]["presentation"]["state"], "revoked");
        assert_eq!(s[0]["presentation"]["reason"], "leg-dead");
        assert!(t.is_empty());
    }

    type Rx = tokio::sync::mpsc::UnboundedReceiver<Outbound>;

    /// An input-granted activation on legs of its own, both attached with the
    /// view up — PENDING (no seed yet). The receivers are drained.
    fn attached_activation(
        t: &mut ActivationTable,
        activation_id: &str,
        session: &str,
    ) -> (LegRef, Rx, LegRef, Rx) {
        let base = 10 * (t.len() as u64 + 1);
        let (control, mut crx) = leg(base);
        let (frames, mut frx) = leg(base + 1);
        t.open_credit(base + 1, 1, ReceiverCapacities::CELL_CAPS, 0);
        let rights = [AttachRight::Input, AttachRight::Read];
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set(),
            leg: &control,
            msg: control_msg(activation_id, None, true),
            claims: claims(session, 1, &rights),
            session_known: true,
        }));
        t.view_attached(activation_id, activation_id, 7);
        perform(t.attach_frames(AttachFramesInput {
            set: &set(),
            leg: &frames,
            msg: AttachFramesLeg {
                activation_id: activation_id.into(),
                attach_grant: serde_json::json!({}),
                resume: None,
            },
            claims: claims(session, 1, &rights),
            trf_identity: Some(TrfIdentity {
                session_handle: "77".into(),
                view_handle: "77".into(),
            }),
            resume_token: "rt".into(),
            session_epoch: 0,
        }));
        texts(&mut crx);
        texts(&mut frx);
        (control, crx, frames, frx)
    }

    /// `attached_activation`, then its seed at `seed` sent and applied:
    /// presenting, input allowed. The receivers are drained.
    fn presenting_activation(
        t: &mut ActivationTable,
        activation_id: &str,
        session: &str,
        seed: u64,
    ) -> (LegRef, Rx, LegRef, Rx) {
        let (control, mut crx, frames, frx) = attached_activation(t, activation_id, session);
        t.unit_sent(activation_id, seed, true);
        perform(applied(t, &frames, activation_id, session, seed, 3_000));
        let s = texts(&mut crx);
        assert_eq!(s.last().unwrap()["input"]["state"], "allowed");
        (control, crx, frames, frx)
    }

    /// The worker's `SceneApplied` for `revision`, in the activation's lineage.
    fn applied(
        t: &mut ActivationTable,
        frames: &LegRef,
        activation_id: &str,
        session: &str,
        revision: u64,
        now_ms: u64,
    ) -> Vec<Effect> {
        let scene_epoch = t
            .get(activation_id)
            .and_then(|a| a.scene_epoch.clone())
            .expect("a frames-attached activation");
        t.scene_applied(
            frames,
            SceneApplied {
                session_id: session.into(),
                activation_id: activation_id.into(),
                lease_epoch: 0,
                applied_content: SceneContentStamp {
                    scene_epoch,
                    scene_revision: revision,
                },
            },
            now_ms,
        )
    }

    /// C3 — `stopped{overload}` is a STATE, never an end. The lease says it
    /// once (input `suspended{overload}`, the spec's word, not `pending`); an
    /// ack of a unit sent BEFORE the stop moves nothing; the first unit sent
    /// after it — the transfer the returning credit let through — applied, is
    /// presenting again with input allowed.
    #[test]
    fn an_overload_stop_is_said_once_and_recovers_when_a_unit_sent_after_it_applies() {
        let mut t = ActivationTable::new("cb");
        let (_control, mut crx, frames, _frx) = presenting_activation(&mut t, "a1", "s1", 10);

        perform(t.presentation_stopped("a1", "overload", 3_100));
        let s = texts(&mut crx);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0]["presentation"]["state"], "stopped");
        assert_eq!(s[0]["presentation"]["reason"], "overload");
        assert_eq!(s[0]["input"]["state"], "suspended");
        assert_eq!(s[0]["input"]["reason"], "overload");
        // the same stall, said again by another bounded wait: nothing new
        assert!(t.presentation_stopped("a1", "overload", 3_200).is_empty());

        // an ack of what was sent BEFORE the stop is not the recovery
        perform(applied(&mut t, &frames, "a1", "s1", 10, 3_300));
        assert_eq!(
            t.get("a1").unwrap().presentation,
            Presentation::Stopped("overload")
        );

        // the credit returned: the pump's catch-up went out ending at 40 and a
        // delta followed at 41; an ack short of 40 is still not the recovery
        t.unit_sent("a1", 40, false);
        t.unit_sent("a1", 41, false);
        assert_eq!(t.get("a1").unwrap().resume_revision, Some(40));
        perform(applied(&mut t, &frames, "a1", "s1", 39, 3_400));
        assert_eq!(
            t.get("a1").unwrap().presentation,
            Presentation::Stopped("overload")
        );
        texts(&mut crx);

        // …and the catch-up applied IS: presenting, input allowed, said at once
        perform(applied(&mut t, &frames, "a1", "s1", 40, 3_500));
        let s = texts(&mut crx);
        let recovered = s.last().expect("the recovery is said");
        assert_eq!(recovered["presentation"]["state"], "presenting");
        assert_eq!(recovered["input"]["state"], "allowed");
        assert_eq!(t.get("a1").unwrap().resume_revision, None);

        // A stop while the SEED was still starved (the activation pending)
        // recovers the same way: the seed that finally goes out, applied.
        let (_control, mut crx2, frames2, _frx2) = attached_activation(&mut t, "b1", "s2");
        perform(t.presentation_stopped("b1", "overload", 3_000));
        let s = texts(&mut crx2);
        assert_eq!(s[0]["presentation"]["reason"], "overload");
        assert_eq!(s[0]["input"]["reason"], "overload");
        t.unit_sent("b1", 5, true);
        perform(applied(&mut t, &frames2, "b1", "s2", 5, 3_100));
        let s = texts(&mut crx2);
        assert_eq!(s.last().unwrap()["presentation"]["state"], "presenting");
        assert_eq!(s.last().unwrap()["input"]["state"], "allowed");
    }

    /// C3 — a stop said AGAIN after a recovery unit went out is the pump
    /// starved again, parked with no bound: the unit sent before that report
    /// does not end the stop, or its ack would read presenting (input allowed)
    /// over a frozen screen with nothing left to report it. Only a unit sent
    /// after the latest report recovers.
    #[test]
    fn a_stop_said_again_after_a_recovery_unit_waits_for_a_unit_sent_after_it() {
        let mut t = ActivationTable::new("cb");
        let (_control, mut crx, frames, _frx) = presenting_activation(&mut t, "a1", "s1", 10);

        perform(t.presentation_stopped("a1", "overload", 3_100));
        // trickling credit let a catch-up through, ending at 40…
        t.unit_sent("a1", 40, false);
        assert_eq!(t.get("a1").unwrap().resume_revision, Some(40));
        // …and the next one starved past the bound before 40 was acknowledged
        assert!(t.presentation_stopped("a1", "overload", 3_200).is_empty());
        assert_eq!(t.get("a1").unwrap().resume_revision, None);
        texts(&mut crx);

        // 40 applied: the scene reached 40, but the pump is starved again
        perform(applied(&mut t, &frames, "a1", "s1", 40, 3_300));
        let a = t.get("a1").unwrap();
        assert_eq!(a.presentation, Presentation::Stopped("overload"));
        assert_eq!(a.input, Input::Suspended("overload"));
        for s in texts(&mut crx) {
            assert_eq!(s["presentation"]["state"], "stopped");
        }

        // the credit returned for real: a unit sent after the report, applied
        t.unit_sent("a1", 55, false);
        assert_eq!(t.get("a1").unwrap().resume_revision, Some(55));
        perform(applied(&mut t, &frames, "a1", "s1", 55, 3_400));
        let s = texts(&mut crx);
        let recovered = s.last().expect("the recovery is said");
        assert_eq!(recovered["presentation"]["state"], "presenting");
        assert_eq!(recovered["input"]["state"], "allowed");
    }

    /// C5 — the lag call is the AGE of the oldest unit the worker has not
    /// acknowledged, never a revision count. A catch-up that moves the lineage
    /// hundreds of revisions in ONE unit is not lag; a burst of young units is
    /// not lag however many revisions it spans; the OLDEST unacknowledged unit
    /// aging past the bound is lag even with younger ones behind it (a
    /// streaming pane never lets the NEWEST grow old); the ack that covers it
    /// ends it. The ledger is bounded, and the bound only ever overstates the
    /// age.
    #[test]
    fn lag_is_the_age_of_the_oldest_unacknowledged_unit_never_a_revision_count() {
        let mut t = ActivationTable::new("cb");
        let (_control, mut crx, frames, _frx) = presenting_activation(&mut t, "a1", "s1", 10);
        let past_the_bound =
            || Instant::now() - Duration::from_millis(tp::INPUT_LAG_SUSPEND_MS + 1);

        // a catch-up: one unit, 400 revisions on — young, so not lag
        t.unit_sent("a1", 410, false);
        assert!(
            t.tick(3_100).is_empty(),
            "a young unit is not lag, whatever its revision"
        );
        perform(applied(&mut t, &frames, "a1", "s1", 410, 3_200));
        assert!(t.get("a1").unwrap().unacked.is_empty());

        // a burst of a hundred young units: not lag either
        for revision in 411..=510 {
            t.unit_sent("a1", revision, false);
        }
        assert!(t.tick(3_300).is_empty());
        assert_eq!(t.get("a1").unwrap().input, Input::Allowed);

        // the OLDEST unacknowledged unit past the bound: lagging, though
        // ninety-nine younger units were sent after it
        t.by_id
            .get_mut("a1")
            .unwrap()
            .unacked
            .front_mut()
            .unwrap()
            .1 = past_the_bound();
        perform(t.tick(3_400));
        let s = texts(&mut crx);
        assert_eq!(s.last().unwrap()["input"]["state"], "suspended");
        assert_eq!(s.last().unwrap()["input"]["reason"], "lagging");

        // an ack covering the old unit but not the newest: the oldest left is
        // young, and input is allowed again
        perform(applied(&mut t, &frames, "a1", "s1", 450, 3_500));
        assert_eq!(texts(&mut crx).last().unwrap()["input"]["state"], "allowed");
        assert_eq!(t.get("a1").unwrap().unacked.front().unwrap().0, 451);

        // bounded: past the cap the newest entry absorbs each further unit
        let last = 510 + 2 * UNACKED_UNITS_CAP as u64;
        for revision in 511..=last {
            t.unit_sent("a1", revision, false);
        }
        let a = t.get("a1").unwrap();
        assert_eq!(a.unacked.len(), UNACKED_UNITS_CAP);
        assert_eq!(a.unacked.back().unwrap().0, last);
        assert_eq!(a.unacked.front().unwrap().0, 451);
    }

    #[test]
    fn a_read_only_grant_never_reaches_input_allowed_and_renewal_downgrades_at_once() {
        let mut t = ActivationTable::new("cb");
        let (control, mut crx) = leg(1);
        let (frames, _frx) = leg(2);
        t.open_credit(2, 1, ReceiverCapacities::CELL_CAPS, 0);
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set(),
            leg: &control,
            msg: control_msg("r1", None, true),
            claims: claims("s1", 1, &[AttachRight::Read]),
            session_known: true,
        }));
        texts(&mut crx);
        t.view_attached("r1", "r1", 1);
        perform(t.attach_frames(AttachFramesInput {
            set: &set(),
            leg: &frames,
            msg: AttachFramesLeg {
                activation_id: "r1".into(),
                attach_grant: serde_json::json!({}),
                resume: None,
            },
            claims: claims("s1", 1, &[AttachRight::Read]),
            trf_identity: Some(TrfIdentity {
                session_handle: "1".into(),
                view_handle: "1".into(),
            }),
            resume_token: "rt".into(),
            session_epoch: 0,
        }));
        t.unit_sent("r1", 5, true);
        perform(t.scene_applied(
            &frames,
            SceneApplied {
                session_id: "s1".into(),
                activation_id: "r1".into(),
                lease_epoch: 0,
                applied_content: SceneContentStamp {
                    scene_epoch: t.scene_epoch(1),
                    scene_revision: 5,
                },
            },
            3_000,
        ));
        let s = texts(&mut crx);
        assert_eq!(s[0]["presentation"]["state"], "presenting");
        assert_eq!(s[0]["input"]["state"], "revoked");
        assert_eq!(s[0]["input"]["reason"], "not-granted");

        // a full-rights activation renewed WITHOUT input: revoked{right-revoked} at once
        let (control2, mut crx2) = leg(3);
        let set2 = SetIdentity {
            client_id: "win:2#1".into(),
            connection_set_id: "win:2#1@cb".into(),
        };
        let mut c = claims("s2", 1, &[AttachRight::Input, AttachRight::Read]);
        c.client_id = "win:2#1".into();
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set2,
            leg: &control2,
            msg: control_msg("f1", None, false),
            claims: c,
            session_known: true,
        }));
        texts(&mut crx2);
        let mut renewed = claims("s2", 2, &[AttachRight::Read]);
        renewed.client_id = "win:2#1".into();
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set2,
            leg: &control2,
            msg: control_msg("f1", None, false),
            claims: renewed,
            session_known: true,
        }));
        let r = texts(&mut crx2);
        assert_eq!(r[0]["type"], "ControlLegAttached");
        assert_eq!(r[0]["grantGenerationAccepted"], 2);
        assert_eq!(r[0]["rights"], serde_json::json!(["read"]));
        assert_eq!(r[1]["type"], "CellActivationStatus");
        assert_eq!(r[1]["input"]["state"], "revoked");
        assert_eq!(r[1]["input"]["reason"], "right-revoked");
        // and a LOWER generation is a rollback
        let mut old = claims("s2", 1, &[AttachRight::Input, AttachRight::Read]);
        old.client_id = "win:2#1".into();
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set2,
            leg: &control2,
            msg: control_msg("f1", None, false),
            claims: old,
            session_known: true,
        }));
        assert_eq!(texts(&mut crx2)[0]["code"], "GRANT_GENERATION_ROLLBACK");
    }

    #[test]
    fn demand_none_detaches_the_view_and_live_reattaches_it() {
        let mut t = ActivationTable::new("cb");
        let (control, mut crx) = leg(1);
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set(),
            leg: &control,
            msg: control_msg("d1", None, false),
            claims: claims("s1", 1, &[AttachRight::Read]),
            session_known: true,
        }));
        texts(&mut crx);
        let e = t.declare_demand(
            &control,
            DeclareDemand {
                session_id: "s1".into(),
                activation_id: "d1".into(),
                lease_epoch: 0,
                demand_sequence: 1,
                demand: SourceDemand {
                    mode: SourceDemandMode::Live,
                    cadence_class: None,
                    urgency: None,
                },
            },
        );
        assert!(matches!(
            e[1],
            Effect::AttachView {
                read_write: false,
                ..
            }
        ));
        perform(e);
        assert_eq!(texts(&mut crx)[0]["demandSequence"], 1);
        t.view_attached("d1", "d1", 3);
        // an idempotent re-send is accepted without effect; then none releases
        let e = t.declare_demand(
            &control,
            DeclareDemand {
                session_id: "s1".into(),
                activation_id: "d1".into(),
                lease_epoch: 0,
                demand_sequence: 1,
                demand: SourceDemand {
                    mode: SourceDemandMode::Live,
                    cadence_class: None,
                    urgency: None,
                },
            },
        );
        assert_eq!(e.len(), 1);
        let e = t.declare_demand(
            &control,
            DeclareDemand {
                session_id: "s1".into(),
                activation_id: "d1".into(),
                lease_epoch: 0,
                demand_sequence: 2,
                demand: SourceDemand {
                    mode: SourceDemandMode::None,
                    cadence_class: None,
                    urgency: None,
                },
            },
        );
        assert!(e.iter().any(|x| matches!(x, Effect::DetachView { .. })));
    }

    #[test]
    fn credit_is_cumulative_max_and_epoch_fenced() {
        let mut l = CreditLedger::new(
            3,
            ReceiverCapacities {
                connection_credit_bytes: 100,
                per_activation_credit_bytes: 60,
                staging_bytes_per_session: 0,
                staging_bytes_total: 0,
                max_concurrent_activations: 2,
                max_concurrent_seeds: 1,
            },
            0, // no urgent reserve: this row is about cumulative-max / epoch fencing
        );
        l.open_account("a");
        l.open_account("b");
        assert!(l.try_admit("a", 60, UnitClass::Urgent));
        assert!(
            !l.try_admit("a", 1, UnitClass::Urgent),
            "a's window is full"
        );
        assert!(l.try_admit("b", 40, UnitClass::Urgent));
        assert!(
            !l.try_admit("b", 1, UnitClass::Urgent),
            "the CONNECTION window is full (60+40)"
        );
        let credit = |epoch, seq, conn, accts: Vec<(&str, u64)>| TransportCredit {
            credit_epoch: epoch,
            credit_sequence: seq,
            connection_bytes_returned: conn,
            accounts: accts
                .into_iter()
                .map(|(id, b)| super::super::wire::CreditAccountReturn {
                    activation_id: id.into(),
                    bytes_returned: b,
                })
                .collect(),
        };
        // wrong epoch: ignored
        assert!(l.returned(&credit(2, 1, 100, vec![("a", 60)])).is_empty());
        // a's 60 back: a wakes; connection moved so b wakes too
        let woke = l.returned(&credit(3, 1, 60, vec![("a", 60)]));
        assert!(woke.contains(&"a".to_string()) && woke.contains(&"b".to_string()));
        assert!(l.try_admit("a", 60, UnitClass::Urgent));
        // a duplicate / reordered return is harmless
        assert!(l.returned(&credit(3, 1, 60, vec![("a", 60)])).is_empty());
        assert!(l.returned(&credit(3, 0, 10, vec![("a", 10)])).is_empty());
        // cumulative totals never go down
        l.returned(&credit(3, 2, 30, vec![("a", 10)]));
        assert_eq!(l.connection.returned, 60);
        assert_eq!(l.accounts["a"].returned, 60);
    }

    #[test]
    fn credit_reserves_the_window_for_urgent_and_the_floor_isolates_a_stall() {
        let caps = |conn: u64, per: u64| ReceiverCapacities {
            connection_credit_bytes: conn,
            per_activation_credit_bytes: per,
            staging_bytes_per_session: 0,
            staging_bytes_total: 0,
            max_concurrent_activations: 4,
            max_concurrent_seeds: 1,
        };

        // (1) urgentReserve (§8, TP-S3d): BULK consumes connection credit only
        // down to `limit − reserve`; URGENT draws the full window.
        let mut l = CreditLedger::new(3, caps(100, 100), 40);
        l.open_account("a");
        assert!(
            l.try_admit("a", 60, UnitClass::Bulk),
            "bulk fits down to limit − reserve (100 − 40)"
        );
        assert!(
            !l.try_admit("a", 1, UnitClass::Bulk),
            "bulk may never dip into the urgent reserve"
        );
        assert!(
            l.try_admit("a", 40, UnitClass::Urgent),
            "urgent draws the reserved headroom the bulk could not"
        );
        assert!(
            !l.try_admit("a", 1, UnitClass::Urgent),
            "now the whole window is in flight"
        );

        // (1b) N-H1 — THE CLAMP, which used to be the bug it was written to
        // prevent. A window at or below the reserve clamped the reserve to the
        // WHOLE window, so bulk headroom was zero and a seed could never be
        // admitted: no refusal, no log, just `presentation: stopped {overload}`
        // three seconds later on a leg nobody was reading. That is exactly how
        // `terminal_cell_route_probe` came to have no seed on either arm.
        //
        // Half the window is the rule now, asserted at and below the boundary.
        let mut l = CreditLedger::new(11, caps(100, 100), 100);
        l.open_account("a");
        assert_eq!(l.urgent_reserve, 50, "a reserve may claim at most half");
        assert!(
            l.try_admit("a", 50, UnitClass::Bulk),
            "a window equal to the reserve must still seed — it is small, not broken"
        );
        assert!(!l.try_admit("a", 1, UnitClass::Bulk));
        assert!(
            l.try_admit("a", 50, UnitClass::Urgent),
            "and urgent still has a reserve to draw on"
        );

        // A reserve far LARGER than the window is the case the probe hit (a
        // 1 MiB declaration against a 2 MiB reserve): still half, still seedable.
        let mut l = CreditLedger::new(12, caps(100, 100), 4_000);
        l.open_account("a");
        assert_eq!(l.urgent_reserve, 50);
        assert!(l.try_admit("a", 50, UnitClass::Bulk));

        // And the clamp must NOT engage where the product actually lives: every
        // window a real client declares is many times the reserve, and the
        // reserve there is the full §8 number, untouched.
        let mut l = CreditLedger::new(13, caps(100, 100), 40);
        l.open_account("a");
        assert_eq!(
            l.urgent_reserve, 40,
            "a window comfortably above the reserve keeps the whole reserve"
        );

        // (2) the fairness FLOOR (§8 law 7 / TP-R15a): a stalled activation
        // exhausts only ITS per-activation account, never the connection's — so
        // one viewer's stall is another viewer's non-event.
        let mut l = CreditLedger::new(7, caps(100, 30), 0);
        l.open_account("stalled");
        l.open_account("healthy");
        assert!(l.try_admit("stalled", 30, UnitClass::Urgent));
        assert!(
            !l.try_admit("stalled", 1, UnitClass::Urgent),
            "the stalled activation's own account is full and it is NOT returning"
        );
        assert!(
            l.try_admit("healthy", 30, UnitClass::Urgent),
            "yet another activation still admits — the connection had room, its account is fresh"
        );
        assert_eq!(l.connection.admitted, 60);
    }

    // --- Geometry lease (S3c) --------------------------------------------
    // The table is pure over its inputs, so these drive the whole verb cycle —
    // precheck → (the door's engine op, simulated by a `GeometryOutcome`) →
    // finalize — without a real ghosttea session or socket.

    use crate::tp::wire::GeometryClaimant;

    fn claims_for(client: &str, session: &str, gen: u64, rights: &[AttachRight]) -> AttachClaims {
        AttachClaims {
            audience_cell_boot_id: "cb".into(),
            client_id: client.into(),
            session_id: session.into(),
            lease_epoch: None,
            route_revision: 1,
            grant_generation: gen,
            rights: rights.to_vec(),
            issued_at: 1_000,
            expires_at: 1_000 + 600_000,
            face: None,
        }
    }

    fn set_for(client: &str) -> SetIdentity {
        SetIdentity {
            client_id: client.into(),
            connection_set_id: format!("{client}@cb"),
        }
    }

    /// Attach a live activation and (simulating the door) attach its ghosttea
    /// view, so the geometry precheck sees a presenting seat.
    fn attach_live_with_view(
        t: &mut ActivationTable,
        client: &str,
        session: &str,
        activation_id: &str,
        connection_id: u64,
        rights: &[AttachRight],
    ) -> LegRef {
        let expires_at = claims_for(client, session, 1, rights).expires_at;
        attach_live_expiring(
            t,
            client,
            session,
            activation_id,
            connection_id,
            rights,
            expires_at,
        )
    }

    /// `attach_live_with_view` with the grant lapsing at `expires_at` (ms).
    fn attach_live_expiring(
        t: &mut ActivationTable,
        client: &str,
        session: &str,
        activation_id: &str,
        connection_id: u64,
        rights: &[AttachRight],
        expires_at: u64,
    ) -> LegRef {
        let (control, _rx) = leg(connection_id);
        let mut claims = claims_for(client, session, 1, rights);
        claims.expires_at = expires_at;
        t.attach_control(AttachControlInput {
            now_ms: 1_000,
            set: &set_for(client),
            leg: &control,
            msg: AttachControlLeg {
                activation_id: activation_id.into(),
                attach_grant: serde_json::json!({}),
                replaces_activation_id: None,
                initial_demand: SourceDemand {
                    mode: SourceDemandMode::Live,
                    cadence_class: None,
                    urgency: None,
                },
            },
            claims,
            session_known: true,
        });
        // the door attaches the ghosttea view (view id == activation id)
        t.view_attached(activation_id, activation_id, 7);
        control
    }

    fn claim(
        client: &str,
        session: &str,
        activation_id: &str,
        view: &str,
        cols: u16,
        rows: u16,
        expect_revision: u64,
    ) -> ClaimGeometry {
        ClaimGeometry {
            session_id: session.into(),
            activation_id: activation_id.into(),
            lease_epoch: 0,
            claimant: GeometryClaimant {
                client_id: client.into(),
                view_id: view.into(),
            },
            cols,
            rows,
            expect_revision,
        }
    }

    fn proceed(decision: GeometryDecision) -> GeometryProceed {
        match decision {
            GeometryDecision::Proceed(p) => p,
            GeometryDecision::Refuse(_) => panic!("expected Proceed, got Refuse"),
        }
    }

    fn refused(decision: GeometryDecision) -> serde_json::Value {
        match decision {
            GeometryDecision::Refuse(effects) => {
                let (leg, mut rx) = leg(999);
                perform(
                    effects
                        .into_iter()
                        .map(|e| match e {
                            Effect::Send(_, text) => Effect::Send(leg.clone(), text),
                            other => other,
                        })
                        .collect(),
                );
                texts(&mut rx).pop().expect("a GeometryRefused")
            }
            GeometryDecision::Proceed(_) => panic!("expected Refuse, got Proceed"),
        }
    }

    #[test]
    fn geometry_claims_an_empty_seat_resizes_by_reclaim_and_cas_guards_the_revision() {
        let mut t = ActivationTable::new("cb");
        let a = attach_live_with_view(
            &mut t,
            "win:1#1",
            "s1",
            "a1",
            1,
            &[AttachRight::Read, AttachRight::Input, AttachRight::Geometry],
        );
        let (sink, mut rx) = leg(1);

        // claim an EMPTY seat → a Claim op → holder gen 1, revision 1.
        let d = t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-1", 100, 40, 0), NOW);
        let p = proceed(d);
        assert!(matches!(
            p.op,
            GeometryOp::Claim {
                cols: 100,
                rows: 40
            }
        ));
        let effects = t.geometry_finalize(
            &sink,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 5,
                cols: 100,
                rows: 40,
            },
            NOW,
        );
        perform(effects);
        let committed = texts(&mut rx).pop().unwrap();
        assert_eq!(committed["type"], "GeometryCommitted");
        assert_eq!(committed["holder"]["holderGeneration"], 1);
        assert_eq!(committed["geometryRevision"], 1);
        assert_eq!(committed["cols"], 100);

        // RE-claim the OWN seat with the new revision → a Resize op → the
        // generation is STABLE, the revision advances.
        let d = t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-1", 120, 40, 1), NOW);
        let p = proceed(d);
        assert!(matches!(
            p.op,
            GeometryOp::Resize {
                control_epoch: 5,
                resize_sequence: 1,
                cols: 120,
                rows: 40,
            }
        ));
        let effects = t.geometry_finalize(
            &sink,
            p,
            GeometryOutcome::Resized {
                cols: 120,
                rows: 40,
            },
            NOW,
        );
        perform(effects);
        let committed = texts(&mut rx).pop().unwrap();
        assert_eq!(committed["holder"]["holderGeneration"], 1); // unchanged
        assert_eq!(committed["geometryRevision"], 2);
        assert_eq!(committed["cols"], 120);

        // a STALE expectRevision is refused, holder + revision echoed.
        let refusal =
            refused(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-1", 80, 24, 0), NOW));
        assert_eq!(refusal["code"], "STALE_REVISION");
        assert_eq!(refusal["geometryRevision"], 2);
        assert_eq!(refusal["currentHolder"]["holderGeneration"], 1);

        // the engine refusing (a superseded view) does NOT mutate the lease.
        let p =
            proceed(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-1", 90, 30, 2), NOW));
        let effects = t.geometry_finalize(&sink, p, GeometryOutcome::EngineRefused, NOW);
        perform(effects);
        assert_eq!(texts(&mut rx).pop().unwrap()["code"], "VIEW_SUPERSEDED");
    }

    #[test]
    fn a_revoked_client_loses_every_activation_and_no_one_else_does() {
        let mut t = ActivationTable::new("cb");
        let rights = [AttachRight::Read];
        attach_live_with_view(&mut t, "freeway:p#n~hb", "s1", "a1", 1, &rights);
        attach_live_with_view(&mut t, "freeway:p#n~hb", "s2", "a2", 1, &rights);
        attach_live_with_view(&mut t, "win:1#1", "s1", "b1", 2, &rights);
        perform(t.revoke_client("freeway:p#n~hb"));
        assert!(t.get("a1").is_none() && t.get("a2").is_none());
        assert!(t.get("b1").is_some(), "another client's activation stands");
    }

    #[test]
    fn geometry_right_seat_occupancy_and_a_third_party_transfer_needs_the_holder_or_admin() {
        let mut t = ActivationTable::new("cb");
        let a = attach_live_with_view(
            &mut t,
            "win:1#1",
            "s1",
            "a1",
            1,
            &[AttachRight::Read, AttachRight::Input, AttachRight::Geometry],
        );
        // client B: read-only at first (no geometry), same session.
        let b = attach_live_with_view(&mut t, "win:2#1", "s1", "b1", 2, &[AttachRight::Read]);
        let (sink, _rx) = leg(1);

        // B without the geometry right → RIGHT_MISSING.
        assert_eq!(
            refused(t.claim_geometry(&b, claim("win:2#1", "s1", "b1", "mount-b", 80, 24, 0), NOW))
                ["code"],
            "RIGHT_MISSING"
        );

        // A claims and holds the seat.
        let p =
            proceed(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-a", 100, 40, 0), NOW));
        perform(t.geometry_finalize(
            &sink,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 5,
                cols: 100,
                rows: 40,
            },
            NOW,
        ));

        // give B geometry (a RENEWAL at a higher generation) — now B may CLAIM,
        // but the seat is A's.
        t.attach_control(AttachControlInput {
            now_ms: 1_500,
            set: &set_for("win:2#1"),
            leg: &b,
            msg: AttachControlLeg {
                activation_id: "b1".into(),
                attach_grant: serde_json::json!({}),
                replaces_activation_id: None,
                initial_demand: SourceDemand {
                    mode: SourceDemandMode::Live,
                    cadence_class: None,
                    urgency: None,
                },
            },
            claims: claims_for(
                "win:2#1",
                "s1",
                2,
                &[AttachRight::Read, AttachRight::Geometry],
            ),
            session_known: true,
        });
        assert_eq!(
            refused(t.claim_geometry(&b, claim("win:2#1", "s1", "b1", "mount-b", 80, 24, 1), NOW))
                ["code"],
            "SEAT_HELD"
        );

        // a third client C that could hold the seat, and an admin D that holds none.
        let _c = attach_live_with_view(
            &mut t,
            "win:3#1",
            "s1",
            "c1",
            3,
            &[AttachRight::Read, AttachRight::Input, AttachRight::Geometry],
        );
        let d = attach_live_with_view(
            &mut t,
            "win:4#1",
            "s1",
            "d1",
            4,
            &[AttachRight::Read, AttachRight::GeometryAdmin],
        );
        let a_to_c = |activation_id: &str| TransferGeometry {
            session_id: "s1".into(),
            activation_id: activation_id.into(),
            lease_epoch: 0,
            from: GeometryHolder {
                client_id: "win:1#1".into(),
                view_id: "mount-a".into(),
                holder_generation: 1,
            },
            to: GeometryClaimant {
                client_id: "win:3#1".into(),
                view_id: "mount-c".into(),
            },
            expect_revision: 1,
            cols: 90,
            rows: 30,
        };

        // B holds `geometry` but is neither the holder nor an admin: its right
        // lets it TAKE the seat for itself (the next test), never hand it to a
        // THIRD party. Refused before the destination or the lease is read, so
        // nothing about either is echoed.
        let refusal = refused(t.transfer_geometry(&b, a_to_c("b1"), NOW));
        assert_eq!(refusal["code"], "NOT_HOLDER");
        assert!(refusal.get("currentHolder").is_none());
        assert!(refusal.get("geometryRevision").is_none());

        // …while a `geometryAdmin` caller that holds nothing may (TP-D25 still
        // mints no admin; the cell keeps the clause for TP-S4). A PURE decision:
        // not finalized, so the lease below is untouched by it.
        let p = proceed(t.transfer_geometry(&d, a_to_c("d1"), NOW));
        assert_eq!(p.ghosttea_view_id, "c1");
        assert_eq!(p.client_id, "win:3#1");

        // the HOLDER (A) transfers the seat to B: one engine claim, B holds gen 2.
        let transfer = TransferGeometry {
            session_id: "s1".into(),
            activation_id: "a1".into(),
            lease_epoch: 0,
            from: GeometryHolder {
                client_id: "win:1#1".into(),
                view_id: "mount-a".into(),
                holder_generation: 1,
            },
            to: GeometryClaimant {
                client_id: "win:2#1".into(),
                view_id: "mount-b".into(),
            },
            expect_revision: 1,
            cols: 90,
            rows: 30,
        };
        let p = proceed(t.transfer_geometry(&a, transfer, NOW));
        assert_eq!(p.ghosttea_view_id, "b1"); // the destination's view is resized
        let (sink_b, mut rx_b) = leg(2);
        perform(t.geometry_finalize(
            &sink_b,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 6,
                cols: 90,
                rows: 30,
            },
            NOW,
        ));
        let committed = texts(&mut rx_b).pop().unwrap();
        assert_eq!(committed["holder"]["clientId"], "win:2#1");
        assert_eq!(committed["holder"]["holderGeneration"], 2);
        assert_eq!(committed["geometryRevision"], 2);

        // A is no longer the holder → A's claim on the (now B's) seat is SEAT_HELD.
        assert_eq!(
            refused(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-a", 70, 20, 2), NOW))
                ["code"],
            "SEAT_HELD"
        );
    }

    fn take(
        caller_activation: &str,
        from: (&str, &str, u64),
        to: (&str, &str),
        expect_revision: u64,
        (cols, rows): (u16, u16),
    ) -> TransferGeometry {
        TransferGeometry {
            session_id: "s1".into(),
            activation_id: caller_activation.into(),
            lease_epoch: 0,
            from: GeometryHolder {
                client_id: from.0.into(),
                view_id: from.1.into(),
                holder_generation: from.2,
            },
            to: GeometryClaimant {
                client_id: to.0.into(),
                view_id: to.1.into(),
            },
            expect_revision,
            cols,
            rows,
        }
    }

    /// DS-D5's note (James, 2026-09-30): "the latest focused pane takes full
    /// control include resizing, LWW" — the TAKE, TPv3 §6's Authorization bullet
    /// widened by one clause. A `geometry` grant may transfer the LIVE holder's
    /// seat to ITSELF: one CAS, one engine claim, one committed resize, and the
    /// seat goes back the same way when the other pane is focused again.
    #[test]
    fn geometry_take_a_geometry_right_caller_takes_the_held_seat_for_itself() {
        let mut t = ActivationTable::new("cb");
        let full = [AttachRight::Read, AttachRight::Input, AttachRight::Geometry];
        // A — this desktop's window; B — a pane on another desktop (or the phone),
        // minted the same rights as every self principal (DS-D5).
        let a = attach_live_with_view(&mut t, "win:1#1", "s1", "a1", 1, &full);
        let b = attach_live_with_view(&mut t, "tailnet:me#node-b", "s1", "b1", 2, &full);
        let (sink_a, mut rx_a) = leg(1);
        let (sink_b, mut rx_b) = leg(2);

        // An EMPTY seat is not taken, it is claimed: a take names a holder that
        // does not exist → NOT_HOLDER with no holder, at revision 0 (the runtime
        // answers an empty seat with `ClaimGeometry`).
        let refusal = refused(t.transfer_geometry(
            &b,
            take(
                "b1",
                ("win:1#1", "mount-a", 1),
                ("tailnet:me#node-b", "mount-b"),
                0,
                (90, 30),
            ),
            NOW,
        ));
        assert_eq!(refusal["code"], "NOT_HOLDER");
        assert!(refusal.get("currentHolder").is_none());
        assert_eq!(refusal["geometryRevision"], 0);

        // A claims and holds the seat: generation 1, revision 1.
        let p =
            proceed(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-a", 100, 40, 0), NOW));
        perform(t.geometry_finalize(
            &sink_a,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 5,
                cols: 100,
                rows: 40,
            },
            NOW,
        ));
        texts(&mut rx_a);

        // B mounts knowing nothing, so its claim names revision 0 and is refused
        // STALE_REVISION — and the refusal carries what a take needs: the live
        // holder and the revision (this is how B's runtime learns the seat).
        let held = refused(t.claim_geometry(
            &b,
            claim("tailnet:me#node-b", "s1", "b1", "mount-b", 90, 30, 0),
            NOW,
        ));
        assert_eq!(held["code"], "STALE_REVISION");
        assert_eq!(held["currentHolder"]["clientId"], "win:1#1");
        assert_eq!(held["currentHolder"]["viewId"], "mount-a");
        assert_eq!(held["currentHolder"]["holderGeneration"], 1);
        assert_eq!(held["geometryRevision"], 1);

        // B is FOCUSED → its host takes: a transfer from the live holder TO B, on
        // B's own `geometry` right. ONE decision carrying ONE engine op — a claim
        // on B's own view at B's size.
        let p = proceed(t.transfer_geometry(
            &b,
            take(
                "b1",
                ("win:1#1", "mount-a", 1),
                ("tailnet:me#node-b", "mount-b"),
                1,
                (90, 30),
            ),
            NOW,
        ));
        assert_eq!(p.ghosttea_view_id, "b1");
        assert_eq!(p.client_id, "tailnet:me#node-b");
        assert_eq!(p.claimant_view_id, "mount-b");
        assert_eq!(p.base_revision, 1);
        assert!(matches!(p.op, GeometryOp::Claim { cols: 90, rows: 30 }));
        perform(t.geometry_finalize(
            &sink_b,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 6,
                cols: 90,
                rows: 30,
            },
            NOW,
        ));
        let committed = texts(&mut rx_b).pop().expect("the taker is told");
        assert_eq!(committed["type"], "GeometryCommitted");
        assert_eq!(committed["holder"]["clientId"], "tailnet:me#node-b");
        assert_eq!(committed["holder"]["viewId"], "mount-b");
        assert_eq!(committed["holder"]["holderGeneration"], 2);
        // exactly ONE step: one CAS, one committed resize
        assert_eq!(committed["geometryRevision"], 2);
        assert_eq!(committed["cols"], 90);

        // A — displaced — learns the new holder from its next verb (its own
        // pane's resize is a re-claim), and that verb resizes nothing: A renders
        // what B sized until A is focused again.
        let moved =
            refused(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-a", 100, 40, 1), NOW));
        assert_eq!(moved["code"], "STALE_REVISION");
        assert_eq!(moved["currentHolder"]["clientId"], "tailnet:me#node-b");
        assert_eq!(moved["currentHolder"]["holderGeneration"], 2);
        assert_eq!(moved["geometryRevision"], 2);
        let moved =
            refused(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-a", 100, 40, 2), NOW));
        assert_eq!(moved["code"], "SEAT_HELD");

        // Focus back on A takes it back the same way — one step again.
        let p = proceed(t.transfer_geometry(
            &a,
            take(
                "a1",
                ("tailnet:me#node-b", "mount-b", 2),
                ("win:1#1", "mount-a"),
                2,
                (100, 40),
            ),
            NOW,
        ));
        assert_eq!(p.ghosttea_view_id, "a1");
        perform(t.geometry_finalize(
            &sink_a,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 7,
                cols: 100,
                rows: 40,
            },
            NOW,
        ));
        let back = texts(&mut rx_a).pop().unwrap();
        assert_eq!(back["holder"]["clientId"], "win:1#1");
        assert_eq!(back["holder"]["holderGeneration"], 3);
        assert_eq!(back["geometryRevision"], 3);

        // A STALE take is refused with the seat as it is — the holder and the
        // revision a runtime needs to try once more — and moves nothing.
        let stale = refused(t.transfer_geometry(
            &b,
            take(
                "b1",
                ("win:1#1", "mount-a", 3),
                ("tailnet:me#node-b", "mount-b"),
                2,
                (90, 30),
            ),
            NOW,
        ));
        assert_eq!(stale["code"], "STALE_REVISION");
        assert_eq!(stale["currentHolder"]["holderGeneration"], 3);
        assert_eq!(stale["geometryRevision"], 3);
        // …and so is a take naming a holder generation that is gone.
        let gone = refused(t.transfer_geometry(
            &b,
            take(
                "b1",
                ("win:1#1", "mount-a", 1),
                ("tailnet:me#node-b", "mount-b"),
                3,
                (90, 30),
            ),
            NOW,
        ));
        assert_eq!(gone["code"], "NOT_HOLDER");
        assert_eq!(gone["currentHolder"]["clientId"], "win:1#1");
        assert_eq!(gone["currentHolder"]["holderGeneration"], 3);
        assert_eq!(gone["geometryRevision"], 3);

        // A take needs a presenting view of the caller's own: with B's view
        // detached (demand none) there is nothing to resize.
        t.view_detached("b1");
        assert_eq!(
            refused(t.transfer_geometry(
                &b,
                take(
                    "b1",
                    ("win:1#1", "mount-a", 3),
                    ("tailnet:me#node-b", "mount-b"),
                    3,
                    (90, 30)
                ),
                NOW
            ))["code"],
            "DESTINATION_INELIGIBLE"
        );

        // Through all of it the seat is A's at generation 3: A's own re-claim is
        // still a RESIZE of that seat.
        let p =
            proceed(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-a", 110, 40, 3), NOW));
        assert!(matches!(
            p.op,
            GeometryOp::Resize {
                control_epoch: 7,
                ..
            }
        ));
    }

    /// The take is the `geometry` right's, and ONLY its: a grant without it —
    /// a read-only viewer, or a pre-DS-4 phone minted `[input, read]` (TM-D3 as
    /// first landed) — cannot take the seat for itself, and is told nothing.
    #[test]
    fn geometry_take_without_the_geometry_right_is_not_holder_and_moves_nothing() {
        let mut t = ActivationTable::new("cb");
        let a = attach_live_with_view(
            &mut t,
            "win:1#1",
            "s1",
            "a1",
            1,
            &[AttachRight::Read, AttachRight::Input, AttachRight::Geometry],
        );
        let viewer = attach_live_with_view(&mut t, "win:5#1", "s1", "r1", 5, &[AttachRight::Read]);
        let typist = attach_live_with_view(
            &mut t,
            "tailnet:me#node-p",
            "s1",
            "p1",
            6,
            &[AttachRight::Read, AttachRight::Input],
        );
        let (sink_a, _rx_a) = leg(1);
        let p =
            proceed(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-a", 100, 40, 0), NOW));
        perform(t.geometry_finalize(
            &sink_a,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 5,
                cols: 100,
                rows: 40,
            },
            NOW,
        ));

        for (leg_ref, activation, client) in [
            (&viewer, "r1", "win:5#1"),
            (&typist, "p1", "tailnet:me#node-p"),
        ] {
            let refusal = refused(t.transfer_geometry(
                leg_ref,
                take(
                    activation,
                    ("win:1#1", "mount-a", 1),
                    (client, "mount-x"),
                    1,
                    (80, 24),
                ),
                NOW,
            ));
            assert_eq!(refusal["code"], "NOT_HOLDER", "{client}");
            assert!(refusal.get("currentHolder").is_none(), "{client}");
            assert!(refusal.get("geometryRevision").is_none(), "{client}");
        }

        // the seat is A's, untouched: revision 1, generation 1, a re-claim resizes
        let p =
            proceed(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-a", 120, 40, 1), NOW));
        assert_eq!(p.base_revision, 1);
        assert!(matches!(
            p.op,
            GeometryOp::Resize {
                control_epoch: 5,
                ..
            }
        ));
    }

    /// DS-4d (the wave-1 review: "finalize never re-checks the destination
    /// activation — a grant expiring mid-flight leaves a ghost holder, SEAT_HELD
    /// until a take"). The door runs the engine op between the precheck and the
    /// finalize, so a destination can lapse IN FLIGHT: its grant expires, or its
    /// client goes away. By then the engine's claim has displaced the old holder,
    /// so committing would seat a holder that can never resize again and every
    /// other pane would read SEAT_HELD. The finalize re-checks the destination
    /// and commits NO holder: the seat is empty and claimable, and the caller is
    /// told why. The same holds for the holder's own resize when its grant lapses
    /// mid-flight.
    #[test]
    fn geometry_a_destination_that_lapses_mid_flight_leaves_an_empty_seat_never_a_ghost() {
        let full = [AttachRight::Read, AttachRight::Input, AttachRight::Geometry];
        let held = |t: &mut ActivationTable, a: &LegRef| {
            let (sink, mut rx) = leg(1);
            let p = proceed(t.claim_geometry(
                a,
                claim("win:1#1", "s1", "a1", "mount-a", 100, 40, 0),
                NOW,
            ));
            perform(t.geometry_finalize(
                &sink,
                p,
                GeometryOutcome::Claimed {
                    control_epoch: 5,
                    cols: 100,
                    rows: 40,
                },
                NOW,
            ));
            assert_eq!(texts(&mut rx).pop().unwrap()["type"], "GeometryCommitted");
        };
        let b_takes = || {
            take(
                "b1",
                ("win:1#1", "mount-a", 1),
                ("tailnet:me#node-b", "mount-b"),
                1,
                (90, 30),
            )
        };

        // (1) B's GRANT lapses between the precheck and the finalize.
        let mut t = ActivationTable::new("cb");
        let a = attach_live_with_view(&mut t, "win:1#1", "s1", "a1", 1, &full);
        let b = attach_live_expiring(&mut t, "tailnet:me#node-b", "s1", "b1", 2, &full, 5_000);
        held(&mut t, &a);
        let p = proceed(t.transfer_geometry(&b, b_takes(), 4_999));
        let (sink_b, mut rx_b) = leg(2);
        // the door's engine claim seated B — and B's grant lapsed meanwhile
        perform(t.geometry_finalize(
            &sink_b,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 6,
                cols: 90,
                rows: 30,
            },
            5_000,
        ));
        let told = texts(&mut rx_b).pop().expect("the taker is told");
        assert_eq!(told["type"], "GeometryRefused", "{told}");
        assert_eq!(told["code"], "DESTINATION_INELIGIBLE");
        assert!(
            told.get("currentHolder").is_none(),
            "no ghost holder: {told}"
        );
        assert_eq!(told["geometryRevision"], 2);
        // the seat is EMPTY and claimable — a claim establishes it, never SEAT_HELD
        let p = proceed(t.claim_geometry(
            &a,
            claim("win:1#1", "s1", "a1", "mount-a", 100, 40, 2),
            5_000,
        ));
        assert!(matches!(
            p.op,
            GeometryOp::Claim {
                cols: 100,
                rows: 40
            }
        ));

        // (2) B's CLIENT goes away between the precheck and the finalize.
        let mut t = ActivationTable::new("cb");
        let a = attach_live_with_view(&mut t, "win:1#1", "s1", "a1", 1, &full);
        let b = attach_live_with_view(&mut t, "tailnet:me#node-b", "s1", "b1", 2, &full);
        held(&mut t, &a);
        let p = proceed(t.transfer_geometry(&b, b_takes(), NOW));
        perform(t.leg_closed(2));
        let (sink_b, mut rx_b) = leg(2);
        perform(t.geometry_finalize(
            &sink_b,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 6,
                cols: 90,
                rows: 30,
            },
            NOW,
        ));
        let told = texts(&mut rx_b).pop().expect("the caller is told");
        assert_eq!(told["code"], "DESTINATION_INELIGIBLE", "{told}");
        assert!(
            told.get("currentHolder").is_none(),
            "no ghost holder: {told}"
        );
        assert_eq!(told["geometryRevision"], 2);
        let refusal =
            refused(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-a", 100, 40, 1), NOW));
        assert_eq!(refusal["code"], "STALE_REVISION");
        assert!(refusal.get("currentHolder").is_none(), "the seat is empty");

        // (3) the HOLDER's own grant lapses mid-resize: the seat is released, the
        // way the tick would release it, rather than left to a holder that lapsed.
        let mut t = ActivationTable::new("cb");
        let a = attach_live_expiring(&mut t, "win:1#1", "s1", "a1", 1, &full, 5_000);
        held(&mut t, &a);
        let p = proceed(t.claim_geometry(
            &a,
            claim("win:1#1", "s1", "a1", "mount-a", 120, 40, 1),
            4_999,
        ));
        assert!(matches!(p.op, GeometryOp::Resize { .. }));
        let (sink_a, mut rx_a) = leg(1);
        perform(t.geometry_finalize(
            &sink_a,
            p,
            GeometryOutcome::Resized {
                cols: 120,
                rows: 40,
            },
            5_000,
        ));
        let told = texts(&mut rx_a).pop().expect("the holder is told");
        assert_eq!(told["code"], "DESTINATION_INELIGIBLE", "{told}");
        assert!(
            told.get("currentHolder").is_none(),
            "no ghost holder: {told}"
        );
        assert_eq!(told["geometryRevision"], 2);
    }

    /// DS-4d — the same rule at the PRECHECK: a lapsed grant has no standing. A
    /// take on a lapsed grant is refused before it can displace a live holder
    /// (and told nothing, like any caller without standing); a claim on one is
    /// RIGHT_MISSING; a hand-off TO a lapsed grant is DESTINATION_INELIGIBLE. The
    /// door's tick would invalidate it within a tick — the verb no longer races it.
    #[test]
    fn geometry_a_lapsed_grant_has_no_standing_at_the_precheck() {
        let full = [AttachRight::Read, AttachRight::Input, AttachRight::Geometry];
        let mut t = ActivationTable::new("cb");
        let a = attach_live_with_view(&mut t, "win:1#1", "s1", "a1", 1, &full);
        let b = attach_live_expiring(&mut t, "tailnet:me#node-b", "s1", "b1", 2, &full, 5_000);
        let (sink_a, _rx_a) = leg(1);
        let p =
            proceed(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "mount-a", 100, 40, 0), NOW));
        perform(t.geometry_finalize(
            &sink_a,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 5,
                cols: 100,
                rows: 40,
            },
            NOW,
        ));

        // B's take, at the moment its grant lapses: no standing, told nothing
        let refusal = refused(t.transfer_geometry(
            &b,
            take(
                "b1",
                ("win:1#1", "mount-a", 1),
                ("tailnet:me#node-b", "mount-b"),
                1,
                (90, 30),
            ),
            5_000,
        ));
        assert_eq!(refusal["code"], "NOT_HOLDER");
        assert!(refusal.get("currentHolder").is_none());
        assert!(refusal.get("geometryRevision").is_none());
        // B's claim on a lapsed grant
        assert_eq!(
            refused(t.claim_geometry(
                &b,
                claim("tailnet:me#node-b", "s1", "b1", "mount-b", 90, 30, 1),
                5_000,
            ))["code"],
            "RIGHT_MISSING"
        );
        // the holder handing the seat TO the lapsed grant
        assert_eq!(
            refused(t.transfer_geometry(
                &a,
                take(
                    "a1",
                    ("win:1#1", "mount-a", 1),
                    ("tailnet:me#node-b", "mount-b"),
                    1,
                    (90, 30),
                ),
                5_000,
            ))["code"],
            "DESTINATION_INELIGIBLE"
        );
        // A's seat is untouched: generation 1, revision 1, a re-claim resizes
        let p = proceed(t.claim_geometry(
            &a,
            claim("win:1#1", "s1", "a1", "mount-a", 120, 40, 1),
            5_000,
        ));
        assert!(matches!(
            p.op,
            GeometryOp::Resize {
                control_epoch: 5,
                ..
            }
        ));
        // …and one millisecond earlier the same take would have been a take
        assert!(matches!(
            t.transfer_geometry(
                &b,
                take(
                    "b1",
                    ("win:1#1", "mount-a", 1),
                    ("tailnet:me#node-b", "mount-b"),
                    1,
                    (90, 30),
                ),
                4_999,
            ),
            GeometryDecision::Proceed(_)
        ));
    }

    #[test]
    fn geometry_auto_releases_on_detach_leg_loss_and_a_renewal_that_drops_it() {
        // (1) view detach (demand none) frees the seat and bumps the revision.
        let mut t = ActivationTable::new("cb");
        let a = attach_live_with_view(
            &mut t,
            "win:1#1",
            "s1",
            "a1",
            1,
            &[AttachRight::Read, AttachRight::Input, AttachRight::Geometry],
        );
        let (sink, _rx) = leg(1);
        let p = proceed(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "m", 100, 40, 0), NOW));
        perform(t.geometry_finalize(
            &sink,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 5,
                cols: 100,
                rows: 40,
            },
            NOW,
        ));
        t.view_detached("a1"); // demand-none parks the view ⇒ seat revoked
        t.view_attached("a1", "a1", 8); // demand-live re-attaches a fresh view
                                        // the OLD revision is now stale (release bumped it) …
        assert_eq!(
            refused(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "m", 100, 40, 0), NOW))
                ["code"],
            "STALE_REVISION"
        );
        // … and a claim at the new revision (claim bumped to 1, the release to 2)
        // succeeds on the freed seat.
        assert!(matches!(
            t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "m", 100, 40, 2), NOW),
            GeometryDecision::Proceed(_)
        ));

        // (2) a control-leg loss (connection death) frees the seat.
        let mut t = ActivationTable::new("cb");
        let a = attach_live_with_view(
            &mut t,
            "win:1#1",
            "s1",
            "a1",
            1,
            &[AttachRight::Read, AttachRight::Input, AttachRight::Geometry],
        );
        let p = proceed(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "m", 100, 40, 0), NOW));
        perform(t.geometry_finalize(
            &leg(1).0,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 5,
                cols: 100,
                rows: 40,
            },
            NOW,
        ));
        t.leg_closed(1); // the activation is invalidated → seat auto-released
        let b = attach_live_with_view(
            &mut t,
            "win:2#1",
            "s1",
            "b1",
            2,
            &[AttachRight::Read, AttachRight::Geometry],
        );
        // the seat is free: B claims it (revision advanced 1→2 by the release).
        assert!(matches!(
            t.claim_geometry(&b, claim("win:2#1", "s1", "b1", "mb", 80, 24, 2), NOW),
            GeometryDecision::Proceed(_)
        ));

        // (3) a renewal that DROPS the geometry right revokes the seat.
        let mut t = ActivationTable::new("cb");
        let a = attach_live_with_view(
            &mut t,
            "win:1#1",
            "s1",
            "a1",
            1,
            &[AttachRight::Read, AttachRight::Input, AttachRight::Geometry],
        );
        let p = proceed(t.claim_geometry(&a, claim("win:1#1", "s1", "a1", "m", 100, 40, 0), NOW));
        perform(t.geometry_finalize(
            &leg(1).0,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 5,
                cols: 100,
                rows: 40,
            },
            NOW,
        ));
        // renew A at a higher generation WITHOUT geometry.
        t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set_for("win:1#1"),
            leg: &a,
            msg: AttachControlLeg {
                activation_id: "a1".into(),
                attach_grant: serde_json::json!({}),
                replaces_activation_id: None,
                initial_demand: SourceDemand {
                    mode: SourceDemandMode::Live,
                    cadence_class: None,
                    urgency: None,
                },
            },
            claims: claims_for("win:1#1", "s1", 2, &[AttachRight::Read, AttachRight::Input]),
            session_known: true,
        });
        // the seat is revoked: A (were it still geometry-capable) would re-claim
        // on an EMPTY seat — proven by a fresh claimant succeeding at the bumped
        // revision rather than meeting SEAT_HELD.
        let c = attach_live_with_view(
            &mut t,
            "win:3#1",
            "s1",
            "c1",
            3,
            &[AttachRight::Read, AttachRight::Geometry],
        );
        assert!(matches!(
            t.claim_geometry(&c, claim("win:3#1", "s1", "c1", "mc", 60, 20, 2), NOW),
            GeometryDecision::Proceed(_)
        ));
    }

    // --- item 42 — the seat announced --------------------------------------
    // `GeometryState` to the control leg of every activation of the session that
    // negotiated `geometry-events`: after every change of the holder or of the
    // committed size, and once to a leg an attach puts an activation of the
    // session on. These rows keep their legs' receivers (the rows above drop
    // theirs), so a leg's silence is a verdict, not a closed channel.

    const FULL: [AttachRight; 3] = [AttachRight::Read, AttachRight::Input, AttachRight::Geometry];

    /// A control leg whose hello negotiated `geometry-events`.
    fn negotiated(connection_id: u64) -> (LegRef, tokio::sync::mpsc::UnboundedReceiver<Outbound>) {
        let (mut control, rx) = leg(connection_id);
        control.geometry_events = true;
        (control, rx)
    }

    fn face(kind: &str, name: &str) -> GeometryHolderFace {
        GeometryHolderFace {
            kind: kind.into(),
            name: name.into(),
            os: None,
        }
    }

    /// Attach a live activation with every right on a leg the row KEEPS, its
    /// grant carrying `face` and lapsing at `expires_at`; the door's view attach
    /// is simulated. Returns the attach's own effects (its reply, and any seat
    /// state the leg is told).
    fn attach_on_until(
        t: &mut ActivationTable,
        control: &LegRef,
        (client, session, activation_id): (&str, &str, &str),
        face: Option<GeometryHolderFace>,
        expires_at: u64,
    ) -> Vec<Effect> {
        let mut claims = claims_for(client, session, 1, &FULL);
        claims.face = face;
        claims.expires_at = expires_at;
        let effects = t.attach_control(AttachControlInput {
            now_ms: 1_000,
            set: &set_for(client),
            leg: control,
            msg: control_msg(activation_id, None, true),
            claims,
            session_known: true,
        });
        t.view_attached(activation_id, activation_id, 7);
        effects
    }

    /// `attach_on_until` with the fixture grant's ten-minute lifetime.
    fn attach_on(
        t: &mut ActivationTable,
        control: &LegRef,
        who: (&str, &str, &str),
        face: Option<GeometryHolderFace>,
    ) -> Vec<Effect> {
        attach_on_until(t, control, who, face, 1_000 + 600_000)
    }

    /// Claim the EMPTY seat of s1 for an activation on its own leg and commit it
    /// as the engine would, performing the reply and the announcements.
    fn hold(
        t: &mut ActivationTable,
        control: &LegRef,
        (client, activation_id, view): (&str, &str, &str),
        (cols, rows): (u16, u16),
        expect_revision: u64,
    ) {
        let p = proceed(t.claim_geometry(
            control,
            claim(
                client,
                "s1",
                activation_id,
                view,
                cols,
                rows,
                expect_revision,
            ),
            NOW,
        ));
        assert!(
            matches!(p.op, GeometryOp::Claim { .. }),
            "hold claims an empty seat"
        );
        perform(t.geometry_finalize(
            control,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 5,
                cols,
                rows,
            },
            NOW,
        ));
    }

    /// The `GeometryState`s a leg heard, in order (every other text skipped).
    fn seat_states(
        rx: &mut tokio::sync::mpsc::UnboundedReceiver<Outbound>,
    ) -> Vec<serde_json::Value> {
        texts(rx)
            .into_iter()
            .filter(|m| m["type"] == "GeometryState")
            .collect()
    }

    /// The empty seat of s1 as every negotiated leg must hear it.
    fn empty_seat(revision: u64, (cols, rows): (u16, u16)) -> serde_json::Value {
        serde_json::json!({
            "type": "GeometryState",
            "sessionId": "s1",
            "holder": null,
            "geometryRevision": revision,
            "cols": cols,
            "rows": rows,
        })
    }

    /// A claim, and then a TAKE by another client, each announced to the control
    /// leg of every activation of the session that negotiated `geometry-events`
    /// — the caller's after its own reply, the displaced holder's included, with
    /// the face from the attach claims of the activation now holding the seat —
    /// and to no other: never an un-negotiated leg, never another session's.
    #[test]
    fn geometry_a_seat_change_is_announced_to_every_negotiated_leg_after_the_reply() {
        let mut t = ActivationTable::new("cb");
        let (a_leg, mut a_rx) = negotiated(1);
        let (b_leg, mut b_rx) = negotiated(2);
        let (c_leg, mut c_rx) = leg(3); // a pre-item-42 client: never negotiated
        let (d_leg, mut d_rx) = negotiated(4); // negotiated, but attached to s2
        let studio = Some(face("window", "Studio"));
        let phone = Some(face("phone", "iPhone 16 Pro"));
        perform(attach_on(&mut t, &a_leg, ("win:1#1", "s1", "a1"), studio));
        perform(attach_on(
            &mut t,
            &b_leg,
            ("tailnet:me#node-b", "s1", "b1"),
            phone,
        ));
        perform(attach_on(&mut t, &c_leg, ("win:3#1", "s1", "c1"), None));
        perform(attach_on(&mut t, &d_leg, ("win:4#1", "s2", "d1"), None));
        // no pane ever sized s1: no attach was told a seat
        for rx in [&mut a_rx, &mut b_rx, &mut c_rx, &mut d_rx] {
            assert!(seat_states(rx).is_empty());
        }

        // the phone claims the empty seat at its own size
        let p = proceed(t.claim_geometry(
            &b_leg,
            claim("tailnet:me#node-b", "s1", "b1", "mount-b", 46, 30, 0),
            NOW,
        ));
        let effects = t.geometry_finalize(
            &b_leg,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 5,
                cols: 46,
                rows: 30,
            },
            NOW,
        );
        // the reply leads; then exactly one state per negotiated leg of s1
        let sent: Vec<(u64, serde_json::Value)> = effects
            .iter()
            .map(|e| match e {
                Effect::Send(to, text) => (to.connection_id, serde_json::from_str(text).unwrap()),
                other => panic!("a finalize only sends: {other:?}"),
            })
            .collect();
        assert_eq!(sent[0].0, 2);
        assert_eq!(sent[0].1["type"], "GeometryCommitted");
        let mut told: Vec<u64> = sent[1..]
            .iter()
            .map(|(to, m)| {
                assert_eq!(m["type"], "GeometryState", "{m}");
                *to
            })
            .collect();
        told.sort_unstable();
        assert_eq!(
            told,
            vec![1, 2],
            "A and B — never C (un-negotiated) or D (s2)"
        );
        perform(effects);
        let b_heard = texts(&mut b_rx);
        let kinds: Vec<&str> = b_heard
            .iter()
            .map(|m| m["type"].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds,
            ["GeometryCommitted", "GeometryState"],
            "the reply is never displaced"
        );
        let held = &b_heard[1];
        assert_eq!(held["sessionId"], "s1");
        assert_eq!(held["holder"]["clientId"], "tailnet:me#node-b");
        assert_eq!(held["holder"]["viewId"], "mount-b");
        assert_eq!(held["holder"]["holderGeneration"], 1);
        assert_eq!(
            held["holder"]["face"],
            serde_json::json!({ "kind": "phone", "name": "iPhone 16 Pro" })
        );
        assert_eq!(held["geometryRevision"], 1);
        assert_eq!(
            (held["cols"].as_u64(), held["rows"].as_u64()),
            (Some(46), Some(30))
        );
        assert_eq!(seat_states(&mut a_rx), vec![held.clone()]);
        assert!(
            texts(&mut c_rx).is_empty(),
            "an un-negotiated leg never hears the verb"
        );
        assert!(
            texts(&mut d_rx).is_empty(),
            "another session's leg hears nothing of s1"
        );

        // A — focused — TAKES it: the displaced phone hears who took it, by face
        let p = proceed(t.transfer_geometry(
            &a_leg,
            take(
                "a1",
                ("tailnet:me#node-b", "mount-b", 1),
                ("win:1#1", "mount-a"),
                1,
                (120, 40),
            ),
            NOW,
        ));
        perform(t.geometry_finalize(
            &a_leg,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 6,
                cols: 120,
                rows: 40,
            },
            NOW,
        ));
        let displaced = texts(&mut b_rx);
        assert_eq!(displaced.len(), 1, "{displaced:?}");
        let taken = &displaced[0];
        assert_eq!(taken["type"], "GeometryState");
        assert_eq!(taken["holder"]["clientId"], "win:1#1");
        assert_eq!(taken["holder"]["holderGeneration"], 2);
        assert_eq!(taken["holder"]["face"]["name"], "Studio");
        assert_eq!(taken["geometryRevision"], 2);
        assert_eq!(
            (taken["cols"].as_u64(), taken["rows"].as_u64()),
            (Some(120), Some(40))
        );
        let a_heard = texts(&mut a_rx);
        assert_eq!(a_heard[0]["type"], "GeometryCommitted");
        assert_eq!(&a_heard[1], taken);
        assert!(texts(&mut c_rx).is_empty() && texts(&mut d_rx).is_empty());
    }

    /// The holder's own resize names the new size; then every way a seat EMPTIES
    /// — an explicit release (which has no reply of its own), a view detach, a
    /// control-leg loss — is announced as `holder: null` at the size the PTY was
    /// left at (a release resizes nothing), one revision on.
    #[test]
    fn geometry_a_resize_and_every_release_are_announced_at_the_committed_size() {
        let mut t = ActivationTable::new("cb");
        let (a_leg, mut a_rx) = negotiated(1);
        let (b_leg, mut b_rx) = negotiated(2);
        perform(attach_on(&mut t, &a_leg, ("win:1#1", "s1", "a1"), None));
        perform(attach_on(&mut t, &b_leg, ("win:2#1", "s1", "b1"), None));
        hold(&mut t, &a_leg, ("win:1#1", "a1", "mount-a"), (100, 40), 0);
        texts(&mut a_rx);
        texts(&mut b_rx);

        // the holder's own resize — a re-claim of its seat
        let p = proceed(t.claim_geometry(
            &a_leg,
            claim("win:1#1", "s1", "a1", "mount-a", 132, 50, 1),
            NOW,
        ));
        assert!(matches!(p.op, GeometryOp::Resize { .. }));
        perform(t.geometry_finalize(
            &a_leg,
            p,
            GeometryOutcome::Resized {
                cols: 132,
                rows: 50,
            },
            NOW,
        ));
        let resized = seat_states(&mut b_rx);
        assert_eq!(resized.len(), 1);
        assert_eq!(resized[0]["holder"]["clientId"], "win:1#1");
        assert_eq!(
            resized[0]["holder"]["holderGeneration"], 1,
            "a resize keeps the holder"
        );
        assert!(
            resized[0]["holder"].get("face").is_none(),
            "a faceless grant: no face key"
        );
        assert_eq!(resized[0]["geometryRevision"], 2);
        assert_eq!(
            (resized[0]["cols"].as_u64(), resized[0]["rows"].as_u64()),
            (Some(132), Some(50))
        );
        assert_eq!(seat_states(&mut a_rx), resized);

        // (1) an explicit release: the releaser hears it too
        perform(t.release_geometry(
            &a_leg,
            ReleaseGeometry {
                session_id: "s1".into(),
                activation_id: "a1".into(),
                lease_epoch: 0,
                holder: GeometryHolder {
                    client_id: "win:1#1".into(),
                    view_id: "mount-a".into(),
                    holder_generation: 1,
                },
            },
        ));
        assert_eq!(seat_states(&mut a_rx), vec![empty_seat(3, (132, 50))]);
        assert_eq!(seat_states(&mut b_rx), vec![empty_seat(3, (132, 50))]);

        // (2) a view detach (a demand-none parked it): the parked activation's
        // own leg hears it as well — the activation is still attached
        hold(&mut t, &b_leg, ("win:2#1", "b1", "mount-b"), (80, 24), 3);
        texts(&mut a_rx);
        texts(&mut b_rx);
        perform(t.view_detached("b1"));
        assert_eq!(seat_states(&mut a_rx), vec![empty_seat(5, (80, 24))]);
        assert_eq!(seat_states(&mut b_rx), vec![empty_seat(5, (80, 24))]);
        // a view detach of an activation that holds nothing says nothing
        assert!(t.view_detached("b1").is_empty());

        // (3) the holder's control leg dies: the activation leaves the table and
        // is told its revocation, never its seat; the others hear the empty seat
        hold(&mut t, &a_leg, ("win:1#1", "a1", "mount-a"), (90, 30), 5);
        texts(&mut a_rx);
        texts(&mut b_rx);
        perform(t.leg_closed(1));
        assert!(seat_states(&mut a_rx).is_empty());
        assert_eq!(seat_states(&mut b_rx), vec![empty_seat(7, (90, 30))]);
    }

    /// The two auto-releases a clock or a renewal drives: the expiry sweep (the
    /// tick) on a holder whose grant lapsed, and a renewal that DROPS
    /// `geometry`. A renewal on the leg the activation already rides is told no
    /// seat of its own (it heard every change) — only the release it causes.
    #[test]
    fn geometry_a_lapsed_grant_and_a_renewal_dropping_geometry_announce_the_empty_seat() {
        let mut t = ActivationTable::new("cb");
        let (a_leg, mut a_rx) = negotiated(1);
        let (b_leg, mut b_rx) = negotiated(2);
        // A outlives the sweep below; B's grant lapses at 5_000
        perform(attach_on_until(
            &mut t,
            &a_leg,
            ("win:1#1", "s1", "a1"),
            None,
            900_000,
        ));
        perform(attach_on_until(
            &mut t,
            &b_leg,
            ("win:2#1", "s1", "b1"),
            None,
            5_000,
        ));
        hold(&mut t, &b_leg, ("win:2#1", "b1", "mount-b"), (70, 20), 0);
        texts(&mut a_rx);
        texts(&mut b_rx);
        perform(t.tick(5_000));
        assert_eq!(seat_states(&mut a_rx), vec![empty_seat(2, (70, 20))]);
        assert!(
            seat_states(&mut b_rx).is_empty(),
            "the lapsed activation left the table"
        );

        // A takes the empty seat; a renewal of A WITHOUT geometry revokes it
        hold(&mut t, &a_leg, ("win:1#1", "a1", "mount-a"), (100, 40), 2);
        texts(&mut a_rx);
        let mut renewal = claims_for("win:1#1", "s1", 2, &[AttachRight::Read, AttachRight::Input]);
        renewal.expires_at = 900_000;
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set_for("win:1#1"),
            leg: &a_leg,
            msg: control_msg("a1", None, true),
            claims: renewal,
            session_known: true,
        }));
        let heard = texts(&mut a_rx);
        let kinds: Vec<&str> = heard.iter().map(|m| m["type"].as_str().unwrap()).collect();
        assert_eq!(
            kinds,
            [
                "ControlLegAttached",
                "CellActivationStatus",
                "GeometryState"
            ]
        );
        assert_eq!(heard[2], empty_seat(4, (100, 40)));
    }

    /// A finalize that EMPTIES the seat is announced at the size the engine
    /// committed: a take whose destination lapsed in flight (the holder is
    /// displaced, nobody seated, one revision on), and the same on a seat that
    /// was already empty — where DS-4d moves no revision (there is no holder to
    /// take), so the new size arrives at the revision every leg already holds,
    /// and the receiver's rule replaces on an EQUAL revision. A refusal that
    /// moved nothing announces nothing.
    #[test]
    fn geometry_a_finalize_that_empties_the_seat_announces_the_engines_size() {
        let mut t = ActivationTable::new("cb");
        let (a_leg, mut a_rx) = negotiated(1);
        let (b_leg, mut b_rx) = negotiated(2);
        perform(attach_on(&mut t, &a_leg, ("win:1#1", "s1", "a1"), None));
        perform(attach_on_until(
            &mut t,
            &b_leg,
            ("tailnet:me#node-b", "s1", "b1"),
            None,
            5_000,
        ));
        hold(&mut t, &a_leg, ("win:1#1", "a1", "mount-a"), (100, 40), 0);
        texts(&mut a_rx);
        texts(&mut b_rx);

        // (1) B's take — its grant lapses between the precheck and the finalize
        let p = proceed(t.transfer_geometry(
            &b_leg,
            take(
                "b1",
                ("win:1#1", "mount-a", 1),
                ("tailnet:me#node-b", "mount-b"),
                1,
                (46, 30),
            ),
            4_999,
        ));
        perform(t.geometry_finalize(
            &b_leg,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 6,
                cols: 46,
                rows: 30,
            },
            5_000,
        ));
        let b_heard = texts(&mut b_rx);
        assert_eq!(b_heard[0]["code"], "DESTINATION_INELIGIBLE");
        assert_eq!(b_heard[1], empty_seat(2, (46, 30)));
        assert_eq!(seat_states(&mut a_rx), vec![empty_seat(2, (46, 30))]);

        // (2) A claims the EMPTY seat and its own grant lapses in flight: the
        // engine resized the PTY, nothing was seated, and the revision stays 2
        let p = proceed(t.claim_geometry(
            &a_leg,
            claim("win:1#1", "s1", "a1", "mount-a", 100, 40, 2),
            NOW,
        ));
        perform(t.geometry_finalize(
            &a_leg,
            p,
            GeometryOutcome::Claimed {
                control_epoch: 7,
                cols: 100,
                rows: 40,
            },
            1_000 + 600_000,
        ));
        let a_heard = texts(&mut a_rx);
        assert_eq!(a_heard[0]["code"], "DESTINATION_INELIGIBLE");
        assert_eq!(
            a_heard[0]["geometryRevision"], 2,
            "DS-4d: no holder taken, no step"
        );
        assert_eq!(
            a_heard[1],
            empty_seat(2, (100, 40)),
            "the new size at the same revision"
        );
        assert_eq!(seat_states(&mut b_rx), vec![empty_seat(2, (100, 40))]);

        // (3) a refusal that moved nothing — the engine refused — says nothing
        let p = proceed(t.claim_geometry(
            &a_leg,
            claim("win:1#1", "s1", "a1", "mount-a", 90, 30, 2),
            NOW,
        ));
        perform(t.geometry_finalize(&a_leg, p, GeometryOutcome::EngineRefused, NOW));
        let kinds: Vec<serde_json::Value> = texts(&mut a_rx)
            .into_iter()
            .map(|m| m["type"].clone())
            .collect();
        assert_eq!(kinds, vec![serde_json::json!("GeometryRefused")]);
        assert!(seat_states(&mut b_rx).is_empty());
    }

    /// The lead's on-attach ruling (item 42, 2026-10-19): a pane that mounts
    /// while another device drives is told the seat at once — right after its
    /// `ControlLegAttached`, the holder, its face, the committed size — while a
    /// session no pane ever sized tells an attach nothing, an un-negotiated leg
    /// hears nothing, a retry on the leg the activation already rides hears
    /// nothing new, and an activation MOVED onto a newer leg of its set is told
    /// the seat there.
    #[test]
    fn geometry_an_attach_onto_a_negotiated_leg_is_told_the_seat_once() {
        let mut t = ActivationTable::new("cb");
        let (p_leg, mut p_rx) = negotiated(1);
        let phone = Some(face("phone", "iPhone 16 Pro"));
        perform(attach_on(
            &mut t,
            &p_leg,
            ("tailnet:me#node-p", "s1", "p1"),
            phone,
        ));
        assert!(seat_states(&mut p_rx).is_empty(), "no pane ever sized s1");
        hold(
            &mut t,
            &p_leg,
            ("tailnet:me#node-p", "p1", "mount-p"),
            (46, 30),
            0,
        );
        texts(&mut p_rx);

        // the desktop mounts while the phone drives
        let (d_leg, mut d_rx) = negotiated(2);
        perform(attach_on(&mut t, &d_leg, ("win:1#1", "s1", "d1"), None));
        let heard = texts(&mut d_rx);
        let kinds: Vec<&str> = heard.iter().map(|m| m["type"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["ControlLegAttached", "GeometryState"]);
        assert_eq!(heard[1]["holder"]["clientId"], "tailnet:me#node-p");
        assert_eq!(
            heard[1]["holder"]["face"],
            serde_json::json!({ "kind": "phone", "name": "iPhone 16 Pro" })
        );
        assert_eq!(heard[1]["geometryRevision"], 1);
        assert_eq!(
            (heard[1]["cols"].as_u64(), heard[1]["rows"].as_u64()),
            (Some(46), Some(30))
        );
        assert!(
            seat_states(&mut p_rx).is_empty(),
            "an attach is no seat change"
        );

        // an un-negotiated leg mounting the same way is told nothing
        let (e_leg, mut e_rx) = leg(3);
        perform(attach_on(&mut t, &e_leg, ("win:2#1", "s1", "e1"), None));
        assert!(seat_states(&mut e_rx).is_empty());

        // a retry on the leg d1 already rides: nothing new
        perform(attach_on(&mut t, &d_leg, ("win:1#1", "s1", "d1"), None));
        assert!(seat_states(&mut d_rx).is_empty());
        // d1 MOVED onto a newer leg of its set: told the seat there
        let (d_newer, mut d_newer_rx) = negotiated(4);
        perform(attach_on(&mut t, &d_newer, ("win:1#1", "s1", "d1"), None));
        let heard = texts(&mut d_newer_rx);
        let kinds: Vec<&str> = heard.iter().map(|m| m["type"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["ControlLegAttached", "GeometryState"]);
        assert_eq!(heard[1]["holder"]["clientId"], "tailnet:me#node-p");
        // …and from now on the announcements reach d1 THERE
        perform(t.view_detached("p1"));
        assert!(
            seat_states(&mut d_rx).is_empty(),
            "the leg d1 left hears no more of s1"
        );
        assert_eq!(seat_states(&mut d_newer_rx), vec![empty_seat(2, (46, 30))]);
    }

    /// TP-S3-input — every cell-side gate of `send_input`, walked in sequence:
    /// the Proceed carries the CELL-owned fence coordinates; a foreign leg, an
    /// unknown activation, a stale lease epoch, the renewal-margin backstop, a
    /// demand-none (view parked) and a read-only viewer all Drop, each under its
    /// own audit tag.
    #[test]
    fn send_input_gates_on_leg_lease_epoch_input_dimension_view_and_expiry() {
        let mut t = ActivationTable::new("cb");
        let (control, mut crx) = leg(1);
        let (frames, mut frx) = leg(2);
        let windows = ReceiverCapacities {
            connection_credit_bytes: 1_000,
            per_activation_credit_bytes: 500,
            staging_bytes_per_session: 0,
            staging_bytes_total: 0,
            max_concurrent_activations: 8,
            max_concurrent_seeds: 1,
        };
        t.open_credit(2, 1, windows, 0);
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set(),
            leg: &control,
            msg: control_msg("a1", None, true),
            claims: claims("s1", 1, &[AttachRight::Input, AttachRight::Read]),
            session_known: true,
        }));
        t.view_attached("a1", "a1", 7);
        perform(t.attach_frames(AttachFramesInput {
            set: &set(),
            leg: &frames,
            msg: AttachFramesLeg {
                activation_id: "a1".into(),
                attach_grant: serde_json::json!({}),
                resume: None,
            },
            claims: claims("s1", 1, &[AttachRight::Input, AttachRight::Read]),
            trf_identity: Some(TrfIdentity {
                session_handle: "77".into(),
                view_handle: "77".into(),
            }),
            resume_token: "rt".into(),
            session_epoch: 0,
        }));
        t.unit_sent("a1", 10, true);
        let epoch = t.scene_epoch(1);
        perform(t.scene_applied(
            &frames,
            SceneApplied {
                session_id: "s1".into(),
                activation_id: "a1".into(),
                lease_epoch: 0,
                applied_content: SceneContentStamp {
                    scene_epoch: epoch.clone(),
                    scene_revision: 10,
                },
            },
            3_000,
        ));
        texts(&mut crx);
        texts(&mut frx);
        let msg = |activation: &str, session: &str, lease: u64, seq: u64| SendInput {
            session_id: session.into(),
            activation_id: activation.into(),
            lease_epoch: lease,
            input_sequence: seq,
            op: InputOp::Text { text: "x".into() },
        };

        // ALLOWED → Proceed, carrying the coordinates the CELL owns (never the wire's)
        match t.send_input(&control, &msg("a1", "s1", 0, 1), 3_000) {
            InputDecision::Proceed(p) => {
                assert_eq!(p.session_id, "s1");
                assert_eq!(p.client_id, "win:1#1");
                assert_eq!(p.ghosttea_view_id, "a1");
                assert_eq!(p.attachment_epoch, 7);
                assert_eq!(p.input_sequence, 1);
            }
            InputDecision::Drop(r) => panic!("expected Proceed, dropped: {r:?}"),
        }
        // an unknown activation, a foreign leg, a session mismatch
        assert!(matches!(
            t.send_input(&control, &msg("zz", "s1", 0, 2), 3_000),
            InputDecision::Drop(InputDrop::NoActivation)
        ));
        let (foreign, _fr2) = leg(99);
        assert!(matches!(
            t.send_input(&foreign, &msg("a1", "s1", 0, 2), 3_000),
            InputDecision::Drop(InputDrop::WrongLeg)
        ));
        assert!(matches!(
            t.send_input(&control, &msg("a1", "s9", 0, 2), 3_000),
            InputDecision::Drop(InputDrop::WrongLeg)
        ));
        // the placement fence: a stale-route leaseEpoch never reaches the engine
        assert!(matches!(
            t.send_input(&control, &msg("a1", "s1", 5, 3), 3_000),
            InputDecision::Drop(InputDrop::StaleLeaseEpoch)
        ));
        // the renewal-margin backstop fires even though the lease STILL READS
        // Allowed (nothing recomputed it since 3_000): expiry 601_000, margin 60s
        assert!(matches!(
            t.send_input(&control, &msg("a1", "s1", 0, 4), 600_000),
            InputDecision::Drop(InputDrop::RightExpired)
        ));
        // demand none parks the view; the lease is untouched, but there is
        // nothing to type into — reachable, not defensive
        perform(t.declare_demand(
            &control,
            DeclareDemand {
                session_id: "s1".into(),
                activation_id: "a1".into(),
                lease_epoch: 0,
                demand_sequence: 1,
                demand: SourceDemand {
                    mode: SourceDemandMode::None,
                    cadence_class: None,
                    urgency: None,
                },
            },
        ));
        t.view_detached("a1");
        assert!(matches!(
            t.send_input(&control, &msg("a1", "s1", 0, 5), 3_000),
            InputDecision::Drop(InputDrop::NoView)
        ));

        // a read-only viewer: presenting, but input = revoked{not-granted}
        let (control2, mut crx2) = leg(3);
        let (frames2, _frx2) = leg(4);
        t.open_credit(4, 1, windows, 0);
        perform(t.attach_control(AttachControlInput {
            now_ms: 2_000,
            set: &set(),
            leg: &control2,
            msg: control_msg("a2", None, true),
            claims: claims("s2", 1, &[AttachRight::Read]),
            session_known: true,
        }));
        t.view_attached("a2", "a2", 3);
        perform(t.attach_frames(AttachFramesInput {
            set: &set(),
            leg: &frames2,
            msg: AttachFramesLeg {
                activation_id: "a2".into(),
                attach_grant: serde_json::json!({}),
                resume: None,
            },
            claims: claims("s2", 1, &[AttachRight::Read]),
            trf_identity: Some(TrfIdentity {
                session_handle: "78".into(),
                view_handle: "78".into(),
            }),
            resume_token: "rt2".into(),
            session_epoch: 0,
        }));
        t.unit_sent("a2", 5, true);
        perform(t.scene_applied(
            &frames2,
            SceneApplied {
                session_id: "s2".into(),
                activation_id: "a2".into(),
                lease_epoch: 0,
                applied_content: SceneContentStamp {
                    scene_epoch: epoch,
                    scene_revision: 5,
                },
            },
            3_000,
        ));
        let s = texts(&mut crx2);
        let status = s.last().unwrap();
        assert_eq!(status["presentation"]["state"], "presenting");
        assert_eq!(status["input"]["state"], "revoked");
        assert!(matches!(
            t.send_input(&control2, &msg("a2", "s2", 0, 1), 3_000),
            InputDecision::Drop(InputDrop::Lease("not-granted"))
        ));
    }

    /// C5 (the fixer's review, finding 7) — the stranger rule is the type's:
    /// the two drops that name no activation of the caller's own leg have no
    /// answer, every other drop answers in its own word, and a lease refusal
    /// keeps its audit tag, `input-not-allowed`.
    #[test]
    fn an_input_drop_answers_only_for_the_callers_own_activation() {
        assert_eq!(InputDrop::NoActivation.answer(), None);
        assert_eq!(InputDrop::WrongLeg.answer(), None);
        assert_eq!(
            InputDrop::StaleLeaseEpoch.answer(),
            Some("stale-lease-epoch")
        );
        assert_eq!(InputDrop::Lease("lagging").answer(), Some("lagging"));
        assert_eq!(InputDrop::Lease("exited").answer(), Some("exited"));
        assert_eq!(InputDrop::RightExpired.answer(), Some("right-expired"));
        assert_eq!(InputDrop::NoView.answer(), Some("no-view"));
        assert_eq!(InputDrop::Lease("lagging").tag(), "input-not-allowed");
        assert_eq!(InputDrop::NoActivation.tag(), "no-activation");
        assert_eq!(InputDrop::WrongLeg.tag(), "wrong-leg");
    }

    /// C5 — what the caller of a refused `SendInput` may be TOLD
    /// (`InputRefused`): the lease's own input reason when the lease refused,
    /// the fence's name when another fence did, and nothing at all for a
    /// message that names no activation of the caller's own control leg (EL7).
    #[test]
    fn a_refused_input_is_answered_in_the_leases_words_and_never_to_a_stranger() {
        fn msg(activation: &str, session: &str, lease: u64) -> SendInput {
            SendInput {
                session_id: session.into(),
                activation_id: activation.into(),
                lease_epoch: lease,
                input_sequence: 1,
                op: InputOp::Text { text: "x".into() },
            }
        }
        fn answer(
            t: &ActivationTable,
            leg: &LegRef,
            m: &SendInput,
            now_ms: u64,
        ) -> Option<&'static str> {
            match t.send_input(leg, m, now_ms) {
                InputDecision::Drop(dropped) => t.input_refusal(leg, m, dropped),
                InputDecision::Proceed(_) => panic!("expected a refusal"),
            }
        }
        let mut t = ActivationTable::new("cb");
        let (control, _crx, frames, _frx) = presenting_activation(&mut t, "a1", "s1", 10);

        // the lease refused: its own word, `lagging`
        t.unit_sent("a1", 11, false);
        t.by_id.get_mut("a1").unwrap().unacked.back_mut().unwrap().1 =
            Instant::now() - Duration::from_millis(tp::INPUT_LAG_SUSPEND_MS + 1);
        perform(t.tick(3_100));
        assert_eq!(
            answer(&t, &control, &msg("a1", "s1", 0), 3_100),
            Some("lagging")
        );

        // caught up; the placement fence names itself
        perform(applied(&mut t, &frames, "a1", "s1", 11, 3_200));
        assert_eq!(
            answer(&t, &control, &msg("a1", "s1", 5), 3_200),
            Some("stale-lease-epoch")
        );
        // the renewal-margin backstop, while the lease still reads allowed
        assert_eq!(
            answer(&t, &control, &msg("a1", "s1", 0), 600_000),
            Some("right-expired")
        );

        // strangers are never answered: an unknown id, a foreign leg, a
        // session the activation is not
        let (foreign, _rx) = leg(99);
        assert_eq!(answer(&t, &control, &msg("zz", "s1", 0), 3_200), None);
        assert_eq!(answer(&t, &foreign, &msg("a1", "s1", 0), 3_200), None);
        assert_eq!(answer(&t, &control, &msg("a1", "s9", 0), 3_200), None);

        // demand none parks the view: nothing to type into, said so
        perform(t.declare_demand(
            &control,
            DeclareDemand {
                session_id: "s1".into(),
                activation_id: "a1".into(),
                lease_epoch: 0,
                demand_sequence: 1,
                demand: SourceDemand {
                    mode: SourceDemandMode::None,
                    cadence_class: None,
                    urgency: None,
                },
            },
        ));
        t.view_detached("a1");
        assert_eq!(
            answer(&t, &control, &msg("a1", "s1", 0), 3_300),
            Some("no-view")
        );

        // an overload stop: the lease's word again
        perform(t.presentation_stopped("a1", "overload", 3_400));
        assert_eq!(
            answer(&t, &control, &msg("a1", "s1", 0), 3_400),
            Some("overload")
        );
    }

    /// C8 — the lease follows the session's life. An EXIT stops
    /// every activation of that session (`stopped{exited}`, input
    /// `revoked{exited}`) and is final: an overload stop, an applied frame, a
    /// tick and a seed that lands after it never move it, and the input gate
    /// answers with the lease's word. Another session's lease is untouched. A
    /// REMOVAL revokes (`revoked{removed}`): the view detached, the pump
    /// stopped, the activation gone.
    #[test]
    fn an_exit_stops_the_lease_for_good_and_a_removal_revokes_it() {
        let mut t = ActivationTable::new("cb");
        let (c1, mut crx1, frames1, _f1) = presenting_activation(&mut t, "a1", "s1", 10);
        let (_c2, mut crx2, _frames2, _f2) = presenting_activation(&mut t, "b1", "s2", 5);

        perform(t.session_exited("s1"));
        let s = texts(&mut crx1);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0]["presentation"]["state"], "stopped");
        assert_eq!(s[0]["presentation"]["reason"], "exited");
        assert_eq!(s[0]["input"]["state"], "revoked");
        assert_eq!(s[0]["input"]["reason"], "exited");
        // EL9 — the lease's words on the wire are the golden's, which the TS
        // schema and the kit parse (the fixer's review, finding 6)
        let golden = fixture("tp-cell-activation-status.exited.json");
        assert_eq!(s[0]["presentation"], golden["presentation"]);
        assert_eq!(s[0]["input"], golden["input"]);
        assert!(
            texts(&mut crx2).is_empty(),
            "another session's lease is untouched"
        );
        assert!(t.session_exited("s1").is_empty(), "said once");

        // final: the pump's overload, a frame applied, a tick
        assert!(t.presentation_stopped("a1", "overload", 3_100).is_empty());
        t.unit_sent("a1", 11, false);
        perform(applied(&mut t, &frames1, "a1", "s1", 11, 3_200));
        perform(t.tick(3_300));
        let a = t.get("a1").unwrap();
        assert_eq!(a.presentation, Presentation::Stopped("exited"));
        assert_eq!(a.input, Input::Revoked("exited"));
        let input = SendInput {
            session_id: "s1".into(),
            activation_id: "a1".into(),
            lease_epoch: 0,
            input_sequence: 1,
            op: InputOp::Text { text: "x".into() },
        };
        match t.send_input(&c1, &input, 3_300) {
            InputDecision::Drop(dropped) => {
                assert_eq!(t.input_refusal(&c1, &input, dropped), Some("exited"))
            }
            InputDecision::Proceed(_) => panic!("an exited session never takes input"),
        }

        // an exit while the seed was still in flight: the seed applied after
        // it does not make it presenting
        let (_c3, mut crx3, frames3, _f3) = attached_activation(&mut t, "c1", "s3");
        perform(t.session_exited("s3"));
        t.unit_sent("c1", 4, true);
        perform(applied(&mut t, &frames3, "c1", "s3", 4, 3_400));
        assert_eq!(
            t.get("c1").unwrap().presentation,
            Presentation::Stopped("exited")
        );
        assert!(texts(&mut crx3)
            .iter()
            .all(|s| s["presentation"]["state"] != "presenting"));

        // the REMOVAL: revoked, the view detached, the pump stopped, gone
        let effects = t.session_removed("s1");
        assert!(effects
            .iter()
            .any(|e| matches!(e, Effect::DetachView { .. })));
        assert!(effects.iter().any(|e| matches!(e, Effect::StopPump { .. })));
        perform(effects);
        let s = texts(&mut crx1);
        let last = s.last().expect("the removal is said");
        assert_eq!(last["presentation"]["state"], "revoked");
        assert_eq!(last["presentation"]["reason"], "removed");
        assert_eq!(last["input"]["reason"], "removed");
        let golden = fixture("tp-cell-activation-status.removed.json");
        assert_eq!(last["presentation"], golden["presentation"]);
        assert_eq!(last["input"], golden["input"]);
        assert!(t.get("a1").is_none());
        assert!(t.get("b1").is_some());
        assert_eq!(t.session_ids(), vec!["s2".to_string(), "s3".to_string()]);
    }

    /// D5 — the cell's half of a renewal, pinned: input closes at
    /// the margin (`ATTACH_RENEWAL_MARGIN_MS` before expiry) unless a renewal
    /// has landed, and a renewal reopens it IN ITS OWN REPLY — the
    /// `ControlLegAttached` and, behind it, the status that says `allowed`; no
    /// tick, no second round trip. So a client that renews AHEAD of the margin
    /// (the kit: margin + 30 s) never sees input close, and the closed window a
    /// client sees is exactly how late its renewal landed. The desktop's ~9
    /// minute blip is its runtime asking AT the margin and closing its own
    /// input first (ghosttea-react `#scheduleRoutedRenewal`) — the upstream half.
    #[test]
    fn a_renewal_before_the_margin_never_closes_input_and_one_after_reopens_it_at_once() {
        let mut t = ActivationTable::new("cb");
        let (control, mut crx, _frames, _frx) = presenting_activation(&mut t, "a1", "s1", 10);
        let renew = |t: &mut ActivationTable, generation: u64, now_ms: u64| {
            let mut renewed = claims("s1", generation, &[AttachRight::Input, AttachRight::Read]);
            renewed.issued_at = now_ms;
            renewed.expires_at = now_ms + 600_000;
            t.attach_control(AttachControlInput {
                now_ms,
                set: &set(),
                leg: &control,
                msg: control_msg("a1", None, true),
                claims: renewed,
                session_known: true,
            })
        };
        let margin_of = |t: &ActivationTable| {
            t.get("a1").unwrap().grant_expires_at_ms - tp::ATTACH_RENEWAL_MARGIN_MS
        };

        // the kit's schedule: renewed 30 s AHEAD of the margin — input never
        // closes, not at the old margin and not after it
        let ahead = margin_of(&t) - 30_000;
        assert!(t.tick(ahead).is_empty(), "nothing closes before the margin");
        perform(renew(&mut t, 2, ahead));
        let s = texts(&mut crx);
        assert_eq!(s[0]["type"], "ControlLegAttached");
        assert_eq!(s[1]["input"]["state"], "allowed");
        assert!(
            t.tick(ahead + 30_001).is_empty(),
            "a renewal in time never closes input"
        );
        assert_eq!(t.get("a1").unwrap().input, Input::Allowed);

        // the desktop's schedule (ghosttea-react at its pin): renewed AT the
        // margin — the tick has closed input by the time the renewal lands…
        let at = margin_of(&t);
        perform(t.tick(at));
        let s = texts(&mut crx);
        assert_eq!(s.last().unwrap()["input"]["state"], "suspended");
        assert_eq!(s.last().unwrap()["input"]["reason"], "right-expired");
        // …and the renewal reopens it in its own reply, with no tick between
        perform(renew(&mut t, 3, at + 50));
        let s = texts(&mut crx);
        assert_eq!(s[0]["type"], "ControlLegAttached");
        assert_eq!(s[1]["type"], "CellActivationStatus");
        assert_eq!(s[1]["input"]["state"], "allowed");
    }
}
