//! The cell-side TRANSPORT rules with anti-rollback (terminal-pipeline-v3 §5.1
//! "Cell-side transport rules" + "Ledger bounds and TOMBSTONES"), as one
//! in-memory ledger the door consults under its registry lock:
//!
//! - `highestAcceptedTransportGeneration[connectionSetId]` — a generation BELOW
//!   the set's high-water is `GRANT_GENERATION_ROLLBACK`; ABOVE it advances the
//!   high-water and may replace either channel's leg; EQUAL may establish the
//!   OTHER channel, or replace a channel's leg only with a NEWER grant (a later
//!   `issuedAt`) whose `(nonce, channel)` is unconsumed — else `SET_CHANNEL_BUSY`.
//! - `usedNonceChannels[(nonce, channel)]` — held until `expiresAt + skew`;
//!   a reuse is `GRANT_NONCE_REPLAYED`. One generation may establish BOTH
//!   channels (two nonces would be two grants; one grant, two channels, one
//!   nonce consumed per channel).
//! - TOMBSTONES: a high-water record is retained at least until every grant
//!   minted below it has expired — `firstAcceptedAt + maxGrantLifetimeMs +
//!   maxClockSkewMs` (fieldd raises a generation BEFORE minting it, so every
//!   lower-generation grant was issued before that instant); client death or
//!   set death never shortens it. After that it may be pruned: fieldd's counter
//!   is monotonic per {clientId, cellBootId} and a fieldd restart changes the
//!   clientId (TP-R21), so no lower generation can arrive later.
//!
//! The attach high-water (`{clientId, sessionId}`) lives here too for TP-S3b
//! — same shape, same tombstone rule; unused by the S3a door.

use super::grant::{Channel, TransportClaims};
use crate::registries::terminal_pipeline as tp;
use std::collections::HashMap;

/// The STRUCTURED refusal class for a verified-but-inadmissible transport grant
/// (contracts `ConnectionRefusalCode`); answered by `ConnectionRefused {code,
/// retryable}` on the wire. `VERSION_UNSUPPORTED` and `CAPACITY` are the door's
/// (not the ledger's) and are defined beside these for one enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportRefusal {
    GrantGenerationRollback,
    GrantNonceReplayed,
    ChannelNotAllowed,
    VersionUnsupported,
    SetChannelBusy,
    Capacity,
}

impl TransportRefusal {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::GrantGenerationRollback => "GRANT_GENERATION_ROLLBACK",
            Self::GrantNonceReplayed => "GRANT_NONCE_REPLAYED",
            Self::ChannelNotAllowed => "CHANNEL_NOT_ALLOWED",
            Self::VersionUnsupported => "VERSION_UNSUPPORTED",
            Self::SetChannelBusy => "SET_CHANNEL_BUSY",
            Self::Capacity => "CAPACITY",
        }
    }

    /// Every GRANT code is terminal for that grant (a retry with the same grant
    /// can never succeed — the renderer re-mints); busy/capacity are transient.
    pub fn retryable(self) -> bool {
        matches!(self, Self::SetChannelBusy | Self::Capacity)
    }
}

/// What the door needs to know about the leg currently holding a channel, to
/// decide an equal-generation replacement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CurrentLeg {
    pub transport_grant_generation: u64,
    pub grant_issued_at: u64,
}

/// The ledger's verdict for an admissible hello.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Admission {
    /// The high-water rises to this grant's generation (strictly above before).
    pub raises_high_water: bool,
    /// A live leg on this channel is superseded by this one.
    pub replaces_current_leg: bool,
}

#[derive(Debug, Clone, Copy)]
struct HighWater {
    generation: u64,
    first_accepted_at_ms: u64,
}

/// Clock-agnostic: every method takes `now_ms` (wall-clock ms, the only clock
/// the grant layer reads) so tests drive time.
#[derive(Debug)]
pub struct TransportLedger {
    max_clock_skew_ms: u64,
    max_grant_lifetime_ms: u64,
    transport_high_water: HashMap<String, HighWater>,
    attach_high_water: HashMap<(String, String), HighWater>,
    /// (nonce, channel) → retain-until (expiresAt + skew)
    nonces: HashMap<(String, Channel), u64>,
}

impl Default for TransportLedger {
    fn default() -> Self {
        Self::new(tp::MAX_CLOCK_SKEW_MS, tp::MAX_GRANT_LIFETIME_MS)
    }
}

impl TransportLedger {
    pub fn new(max_clock_skew_ms: u64, max_grant_lifetime_ms: u64) -> Self {
        Self {
            max_clock_skew_ms,
            max_grant_lifetime_ms,
            transport_high_water: HashMap::new(),
            attach_high_water: HashMap::new(),
            nonces: HashMap::new(),
        }
    }

    /// The tombstone TTL of a high-water record accepted at `first_accepted_at`.
    pub fn tombstone_until(&self, first_accepted_at_ms: u64) -> u64 {
        first_accepted_at_ms + self.max_grant_lifetime_ms + self.max_clock_skew_ms
    }

    /// Decide a VERIFIED transport grant's admission for `channel`, given the
    /// leg currently holding that channel in its connection set (if any). Pure:
    /// nothing is recorded until `commit_transport`.
    pub fn check_transport(
        &self,
        claims: &TransportClaims,
        channel: Channel,
        current: Option<CurrentLeg>,
    ) -> Result<Admission, TransportRefusal> {
        if !claims.allowed_channels.contains(&channel) {
            return Err(TransportRefusal::ChannelNotAllowed);
        }
        let high_water = self
            .transport_high_water
            .get(&claims.connection_set_id)
            .map(|h| h.generation);
        if let Some(hw) = high_water {
            if claims.transport_grant_generation < hw {
                return Err(TransportRefusal::GrantGenerationRollback);
            }
        }
        if self.nonces.contains_key(&(claims.nonce.clone(), channel)) {
            return Err(TransportRefusal::GrantNonceReplayed);
        }
        let above = high_water.is_none_or(|hw| claims.transport_grant_generation > hw);
        match current {
            None => Ok(Admission {
                raises_high_water: above,
                replaces_current_leg: false,
            }),
            Some(leg) => {
                if above || claims.grant_issued_at_newer_than(leg) {
                    Ok(Admission {
                        raises_high_water: above,
                        replaces_current_leg: true,
                    })
                } else {
                    Err(TransportRefusal::SetChannelBusy)
                }
            }
        }
    }

    /// Record an admission: raise the high-water (first acceptance stamps the
    /// tombstone clock) and consume `(nonce, channel)` until expiry + skew.
    pub fn commit_transport(&mut self, claims: &TransportClaims, channel: Channel, now_ms: u64) {
        let entry = self
            .transport_high_water
            .entry(claims.connection_set_id.clone())
            .or_insert(HighWater {
                generation: claims.transport_grant_generation,
                first_accepted_at_ms: now_ms,
            });
        if claims.transport_grant_generation > entry.generation {
            *entry = HighWater {
                generation: claims.transport_grant_generation,
                first_accepted_at_ms: now_ms,
            };
        }
        self.nonces.insert(
            (claims.nonce.clone(), channel),
            claims.expires_at.saturating_add(self.max_clock_skew_ms),
        );
    }

    /// The attach high-water per {clientId, sessionId} (TP-S3b's door uses it;
    /// exposed now so the tombstone rule has one home). Returns false on a
    /// rollback (the caller answers `GRANT_GENERATION_ROLLBACK`).
    pub fn accept_attach_generation(
        &mut self,
        client_id: &str,
        session_id: &str,
        grant_generation: u64,
        now_ms: u64,
    ) -> bool {
        let key = (client_id.to_string(), session_id.to_string());
        match self.attach_high_water.get_mut(&key) {
            Some(h) if grant_generation < h.generation => false,
            Some(h) => {
                if grant_generation > h.generation {
                    *h = HighWater {
                        generation: grant_generation,
                        first_accepted_at_ms: now_ms,
                    };
                }
                true
            }
            None => {
                self.attach_high_water.insert(
                    key,
                    HighWater {
                        generation: grant_generation,
                        first_accepted_at_ms: now_ms,
                    },
                );
                true
            }
        }
    }

    /// The set's current high-water, if any (tests and the door's snapshot).
    pub fn transport_high_water(&self, connection_set_id: &str) -> Option<u64> {
        self.transport_high_water
            .get(connection_set_id)
            .map(|h| h.generation)
    }

    /// Drop what the rules let go: expired nonces, and high-water records past
    /// their tombstone TTL. Bounded memory follows from bounded lifetimes.
    pub fn prune(&mut self, now_ms: u64) {
        self.nonces.retain(|_, until| *until > now_ms);
        let ttl = |h: &HighWater| {
            h.first_accepted_at_ms + self.max_grant_lifetime_ms + self.max_clock_skew_ms
        };
        self.transport_high_water.retain(|_, h| ttl(h) > now_ms);
        self.attach_high_water.retain(|_, h| ttl(h) > now_ms);
    }

    /// Sizes, for the door's snapshot and the bounded-memory rows.
    pub fn sizes(&self) -> (usize, usize, usize) {
        (
            self.transport_high_water.len(),
            self.attach_high_water.len(),
            self.nonces.len(),
        )
    }
}

impl TransportClaims {
    fn grant_issued_at_newer_than(&self, leg: CurrentLeg) -> bool {
        self.issued_at > leg.grant_issued_at
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims(set: &str, generation: u64, nonce: &str, issued_at: u64) -> TransportClaims {
        TransportClaims {
            audience_cell_boot_id: "cb".into(),
            client_id: "win:1#1".into(),
            connection_set_id: set.into(),
            allowed_channels: vec![Channel::Control, Channel::Frames],
            transport_grant_generation: generation,
            issued_at,
            expires_at: issued_at + 60_000,
            nonce: nonce.into(),
        }
    }

    #[test]
    fn one_generation_establishes_both_channels_and_a_replay_is_refused() {
        let mut l = TransportLedger::default();
        let g1 = claims("s", 1, "n1", 1_000);
        assert_eq!(
            l.check_transport(&g1, Channel::Control, None).unwrap(),
            Admission {
                raises_high_water: true,
                replaces_current_leg: false
            }
        );
        l.commit_transport(&g1, Channel::Control, 1_000);
        // the same grant may open the OTHER channel (its (nonce, frames) is unconsumed)
        assert!(l.check_transport(&g1, Channel::Frames, None).is_ok());
        l.commit_transport(&g1, Channel::Frames, 1_000);
        // but never the same channel again
        assert_eq!(
            l.check_transport(&g1, Channel::Control, None).unwrap_err(),
            TransportRefusal::GrantNonceReplayed
        );
        assert_eq!(l.transport_high_water("s"), Some(1));
    }

    #[test]
    fn rollback_above_and_equal_rules() {
        let mut l = TransportLedger::default();
        let g2 = claims("s", 2, "n2", 1_000);
        l.commit_transport(&g2, Channel::Control, 1_000);
        let leg = CurrentLeg {
            transport_grant_generation: 2,
            grant_issued_at: 1_000,
        };
        // below the high-water: rollback, even with a fresh nonce
        assert_eq!(
            l.check_transport(&claims("s", 1, "n1", 500), Channel::Frames, None)
                .unwrap_err(),
            TransportRefusal::GrantGenerationRollback
        );
        // above: admitted and replaces the live leg
        let g3 = claims("s", 3, "n3", 2_000);
        assert_eq!(
            l.check_transport(&g3, Channel::Control, Some(leg)).unwrap(),
            Admission {
                raises_high_water: true,
                replaces_current_leg: true
            }
        );
        // equal generation, channel busy, OLDER grant: busy
        let g2_old = claims("s", 2, "n2b", 900);
        assert_eq!(
            l.check_transport(&g2_old, Channel::Control, Some(leg))
                .unwrap_err(),
            TransportRefusal::SetChannelBusy
        );
        // equal generation, channel busy, NEWER grant: replaces
        let g2_new = claims("s", 2, "n2c", 1_500);
        assert_eq!(
            l.check_transport(&g2_new, Channel::Control, Some(leg))
                .unwrap(),
            Admission {
                raises_high_water: false,
                replaces_current_leg: true
            }
        );
        // a channel the grant does not allow
        let mut control_only = claims("s", 4, "n4", 3_000);
        control_only.allowed_channels = vec![Channel::Control];
        assert_eq!(
            l.check_transport(&control_only, Channel::Frames, None)
                .unwrap_err(),
            TransportRefusal::ChannelNotAllowed
        );
    }

    #[test]
    fn tombstones_outlive_every_lower_grant_then_prune() {
        let mut l = TransportLedger::new(5_000, 600_000);
        let g5 = claims("s", 5, "n5", 10_000);
        l.commit_transport(&g5, Channel::Control, 10_000);
        let until = l.tombstone_until(10_000);
        assert_eq!(until, 10_000 + 600_000 + 5_000);
        // a nonce is held until expiresAt + skew, not a moment longer
        assert_eq!(l.sizes().2, 1);
        l.prune(10_000 + 60_000 + 5_000 - 1);
        assert_eq!(l.sizes().2, 1, "nonce retained until expiry + skew");
        l.prune(10_000 + 60_000 + 5_000);
        assert_eq!(l.sizes().2, 0, "nonce pruned at expiry + skew");
        // the high-water outlives it: every lower grant has expired only at the TTL
        l.prune(until - 1);
        assert_eq!(
            l.transport_high_water("s"),
            Some(5),
            "retained until the TTL"
        );
        l.prune(until);
        assert_eq!(l.transport_high_water("s"), None, "pruned at the TTL");
    }

    #[test]
    fn attach_high_water_refuses_rollback() {
        let mut l = TransportLedger::default();
        assert!(l.accept_attach_generation("c", "s", 3, 1));
        assert!(!l.accept_attach_generation("c", "s", 2, 2));
        assert!(
            l.accept_attach_generation("c", "s", 3, 3),
            "equal is idempotent"
        );
        assert!(l.accept_attach_generation("c", "s", 4, 4));
        assert!(
            l.accept_attach_generation("c", "other", 1, 5),
            "per session"
        );
    }
}
