//! The cell-side ACTIVATION table (terminal-pipeline-v3 §5.4, TP-D22; the
//! contracts' ACTIVATION / CREDIT_ACCOUNT machines as the cell sees them):
//! one pending-or-active activation per `{clientId, sessionId}`, attached on
//! the control leg (`AttachControlLeg` → `ControlLegAttached`, carrying the
//! initial demand) and then on the frames leg (`AttachFramesLeg` →
//! `FramesLegAttached` with the TRF1 identity), the two-dimensional LEASE
//! (`presentation × input`) answered to every `SceneApplied`, `DeclareDemand
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
    tagged, AttachControlLeg, AttachFramesLeg, AttachRefused, CellActivationStatus,
    ControlLegAttached, DeclareDemand, DemandAccepted, FramesAttachOutcome, FramesLegAttached,
    LeaseDimension, ReceiverCapacities, SceneApplied, SceneContentStamp, SceneEpoch,
    SourceDemandMode, TransportCredit, TrfIdentity,
};
use crate::registries::terminal_pipeline as tp;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::UnboundedSender;

/// What a leg's writer task receives.
#[derive(Debug)]
pub enum Outbound {
    Text(String),
    Binary(Vec<u8>),
    Close(u16, String),
}

/// A handle on one accepted leg: enough to address it and to write to it.
#[derive(Debug, Clone)]
pub struct LegRef {
    pub connection_id: u64,
    pub leg_generation: u64,
    pub out: UnboundedSender<Outbound>,
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
    /// the newest revision the pump has SENT (the worker's eventual current)
    pub newest_sent: Option<u64>,
    /// the revision of the first seed sent — presenting once applied
    pub seed_revision: Option<u64>,
    pub pump_running: bool,
    pub last_unit_sent_at: Option<Instant>,
    pub last_scene_applied_at: Option<Instant>,
}

impl Activation {
    fn has_right(&self, right: AttachRight) -> bool {
        self.rights.contains(&right)
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
    pub accounts: HashMap<String, Window>,
}

impl CreditLedger {
    pub fn new(credit_epoch: u64, windows: ReceiverCapacities) -> Self {
        Self {
            credit_epoch,
            last_sequence: None,
            connection: Window {
                admitted: 0,
                returned: 0,
                limit: windows.connection_credit_bytes,
            },
            per_activation_limit: windows.per_activation_credit_bytes,
            accounts: HashMap::new(),
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

    /// Non-mutating: would `bytes` be admissible now? `None` = no such account.
    pub fn can_admit(&self, activation_id: &str, bytes: u64) -> Option<bool> {
        let account = self.accounts.get(activation_id)?;
        Some(self.connection.can_admit(bytes) && account.can_admit(bytes))
    }

    pub fn try_admit(&mut self, activation_id: &str, bytes: u64) -> bool {
        let Some(account) = self.accounts.get(activation_id) else {
            return false;
        };
        if !self.connection.can_admit(bytes) || !account.can_admit(bytes) {
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
    credit: HashMap<u64, CreditLedger>,
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
}

impl ActivationTable {
    pub fn new(cell_boot_id: &str) -> Self {
        Self {
            cell_boot_id: cell_boot_id.to_string(),
            by_id: HashMap::new(),
            by_key: HashMap::new(),
            credit: HashMap::new(),
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
        SceneEpoch {
            cell_boot_id: self.cell_boot_id.clone(),
            model_generation,
        }
    }

    /// A frames leg was accepted: its credit epoch opens with these windows.
    pub fn open_credit(
        &mut self,
        connection_id: u64,
        credit_epoch: u64,
        windows: ReceiverCapacities,
    ) {
        self.credit
            .insert(connection_id, CreditLedger::new(credit_epoch, windows));
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
        } else if a.presentation != Presentation::Presenting {
            a.input = Input::Suspended("pending");
        } else if now_ms + tp::ATTACH_RENEWAL_MARGIN_MS >= a.grant_expires_at_ms {
            a.input = Input::Suspended("right-expired");
        } else if Self::lagging(a) {
            // the cell's own lag call, two ways: too many revisions ahead of the
            // last applied, OR a unit sent with no SceneApplied within the delay
            a.input = Input::Suspended("lagging");
        } else {
            a.input = Input::Allowed;
        }
        a.input != before
    }

    /// The cell's lag call: revisions ahead of the last applied, or a unit sent
    /// with no SceneApplied within the delay bound (§5.4 — the LAG decision is
    /// the cell's alone).
    fn lagging(a: &Activation) -> bool {
        let by_revisions = a.newest_sent.is_some_and(|newest| {
            a.accepted
                .as_ref()
                .map(|s| s.scene_revision)
                .is_none_or(|applied| {
                    newest.saturating_sub(applied) > tp::INPUT_LAG_SUSPEND_REVISIONS
                })
        });
        let by_time = a
            .last_unit_sent_at
            .zip(a.last_scene_applied_at)
            .is_some_and(|(sent, applied)| {
                sent > applied
                    && sent.elapsed() > Duration::from_millis(tp::MAX_SCENE_APPLIED_DELAY_MS)
            });
        by_revisions || by_time
    }

    /// `AttachControlLeg` after the grant VERIFIED and the attach high-water
    /// ADMITTED it (the door does both first — they need the verifier and the
    /// transport ledger). Returns the effects: one reply, maybe a view attach.
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
                if renewed {
                    let had_input = a.has_right(AttachRight::Input);
                    a.rights = claims.rights.clone();
                    a.grant_generation = claims.grant_generation;
                    a.grant_expires_at_ms = claims.expires_at;
                    if had_input && !a.has_right(AttachRight::Input) {
                        a.input = Input::Revoked("right-revoked");
                    } else if matches!(a.input, Input::Suspended("right-expired")) {
                        // a renewal in time reopens what the margin closed
                        a.input = Input::Suspended("pending");
                    }
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
                if renewed {
                    Self::recompute_input(a, now_ms);
                    effects.push(Self::status_effect(a));
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
            newest_sent: None,
            seed_revision: None,
            pump_running: false,
            last_unit_sent_at: None,
            last_scene_applied_at: None,
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
        if wants_view {
            effects.push(Effect::AttachView {
                activation_id: activation_id.clone(),
                session_id,
                client_id: set.client_id.clone(),
                view_id: activation_id,
                read_write: has_input,
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
        let Some(a) = self.by_id.get_mut(&activation_id) else {
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
        // A replaced frames leg: the old one's pump stops with its leg (the door
        // invalidates activations on a closed leg); a re-attach on the same leg
        // is idempotent.
        let already = a
            .frames
            .as_ref()
            .is_some_and(|f| f.connection_id == leg.connection_id);
        a.frames = Some(leg.clone());
        if a.resume_token.is_none() {
            a.resume_token = Some(resume_token);
        }
        a.trf_identity = Some(trf.clone());
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
                        reason: Some(if msg.resume.is_some() {
                            "no-resume-capability".to_string()
                        } else {
                            "no-cursor".to_string()
                        }),
                    },
                },
            ),
        )];
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

    pub fn view_detached(&mut self, activation_id: &str) {
        if let Some(a) = self.by_id.get_mut(activation_id) {
            a.view = None;
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
                        read_write: a.has_right(AttachRight::Input),
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
        a.last_scene_applied_at = Some(Instant::now());
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
        if a.presentation == Presentation::Pending {
            if let Some(seed) = a.seed_revision {
                if msg.applied_content.scene_revision >= seed {
                    a.presentation = Presentation::Presenting;
                }
            }
        }
        Self::recompute_input(a, now_ms);
        vec![Self::status_effect(a)]
    }

    /// The pump sent a unit (a seed/catch-up transfer or a delta) ending at `revision`.
    pub fn unit_sent(&mut self, activation_id: &str, revision: u64, seed: bool) -> Vec<Effect> {
        let Some(a) = self.by_id.get_mut(activation_id) else {
            return Vec::new();
        };
        a.newest_sent = Some(revision);
        a.last_unit_sent_at = Some(Instant::now());
        if seed && a.seed_revision.is_none() {
            a.seed_revision = Some(revision);
        }
        Vec::new()
    }

    /// The pump reports an overload stop (§8: recovery terminates bounded).
    pub fn presentation_stopped(
        &mut self,
        activation_id: &str,
        reason: &'static str,
        now_ms: u64,
    ) -> Vec<Effect> {
        let Some(a) = self.by_id.get_mut(activation_id) else {
            return Vec::new();
        };
        a.presentation = Presentation::Stopped(reason);
        Self::recompute_input(a, now_ms);
        vec![Self::status_effect(a)]
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

    /// The pump asks to admit `bytes` for an activation on a frames connection.
    pub fn try_admit(&mut self, connection_id: u64, activation_id: &str, bytes: u64) -> bool {
        self.credit
            .get_mut(&connection_id)
            .is_some_and(|l| l.try_admit(activation_id, bytes))
    }

    /// Non-mutating twin: `None` when the connection's ledger or the account is gone.
    pub fn can_admit(&self, connection_id: u64, activation_id: &str, bytes: u64) -> Option<bool> {
        self.credit
            .get(&connection_id)
            .and_then(|l| l.can_admit(activation_id, bytes))
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
        let mut effects = Vec::new();
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
    use super::*;
    use crate::tp::wire::SourceDemand;
    use tokio::sync::mpsc::unbounded_channel;

    fn leg(connection_id: u64) -> (LegRef, tokio::sync::mpsc::UnboundedReceiver<Outbound>) {
        let (tx, rx) = unbounded_channel();
        (
            LegRef {
                connection_id,
                leg_generation: 1,
                out: tx,
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
        });
        assert!(matches!(e[1], Effect::StartPump { .. }));
        perform(e);
        let r = texts(&mut frx);
        assert_eq!(r[0]["type"], "FramesLegAttached");
        assert_eq!(r[0]["trfIdentity"]["sessionHandle"], "77");
        assert_eq!(r[0]["outcome"]["kind"], "seed-required");
        // credit: the account opened with the per-activation window
        assert!(t.try_admit(2, "a1", 400));
        assert!(
            !t.try_admit(2, "a1", 200),
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
        // lag: the pump is 100 revisions ahead of the last applied ⇒ suspended{lagging}
        t.unit_sent("a1", 120, false);
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

    #[test]
    fn a_read_only_grant_never_reaches_input_allowed_and_renewal_downgrades_at_once() {
        let mut t = ActivationTable::new("cb");
        let (control, mut crx) = leg(1);
        let (frames, _frx) = leg(2);
        t.open_credit(2, 1, ReceiverCapacities::CELL_CAPS);
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
        );
        l.open_account("a");
        l.open_account("b");
        assert!(l.try_admit("a", 60));
        assert!(!l.try_admit("a", 1), "a's window is full");
        assert!(l.try_admit("b", 40));
        assert!(
            !l.try_admit("b", 1),
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
        assert!(l.try_admit("a", 60));
        // a duplicate / reordered return is harmless
        assert!(l.returned(&credit(3, 1, 60, vec![("a", 60)])).is_empty());
        assert!(l.returned(&credit(3, 0, 10, vec![("a", 10)])).is_empty());
        // cumulative totals never go down
        l.returned(&credit(3, 2, 30, vec![("a", 10)]));
        assert_eq!(l.connection.returned, 60);
        assert_eq!(l.accounts["a"].returned, 60);
    }
}
