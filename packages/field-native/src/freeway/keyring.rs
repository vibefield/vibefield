//! FW-D1 (v0.3 §6) — the host's keyring: a phone's tickets and their renewals, fieldd's minter
//! (`terminal-grants.ts`) ported onto the host's own keys and boot. One keyring per admitted
//! phone link, whose client id (`freeway:<login>#<node>~<hostBootId>`) carries the MINTER's
//! boot: the host can restart inside a floor boot while the cells live on, and its counters
//! restart with it, so a client id of an older boot would meet its own high-water at the cell
//! (`GRANT_GENERATION_ROLLBACK`, not retryable).
//!
//! - A ticket is `FreewayOpenTicket`: the route, the cell's two legs as streams on this link, a
//!   FRESH transport grant (generation per {client, cell}, a one-shot nonce) and an attach grant
//!   (generation per {client, session}, the approval's rights, the keyring's short life).
//! - A renewal is a CAS on the generation the phone holds, idempotent by its request id, with the
//!   last few answers remembered per session (fieldd's `RENEWAL_MEMORY`).
//! - A revoke (§6's second wall) names the generation every cell must refuse below, one above every
//!   grant out, and every later mint starts there: the cell's ledger admits an EQUAL generation and
//!   refuses a lower one (`tp/ledger.rs`), so a client re-approved within the boot is never a
//!   rollback, on a cell it used or one it never did.
//!
//! The ledgers are the host BOOT's, as the client id is: the host keeps one keyring per client
//! across its links, so a phone that reconnects mints on from its own high-water.

use super::mint::{attach_grant, transport_grant, AttachMint, TransportMint};
use crate::registries::{freeway as limits, terminal_pipeline as tp};
use crate::tp::grant::{AttachRight, Channel, GrantKey};
use data_encoding::BASE64URL_NOPAD;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};

/// How many renewal answers a session remembers, as fieldd's minter does.
const RENEWAL_MEMORY: usize = 8;

/// A cell the floor handed the host: its grant key, route revision, and its two loopback doors
/// (the route row's `doors`), which the host dials for the phone's legs.
pub struct CellRoute {
    pub key: GrantKey,
    pub route_revision: u64,
    pub control_url: String,
    pub frames_url: String,
}

/// A session the floor placed: its cell, and custody's lease epoch once it is exposed.
pub struct SessionRoute {
    pub cell_boot_id: String,
    pub lease_epoch: Option<u64>,
}

/// What the host knows of its cells and sessions (stdin line 1, then its updates).
#[derive(Default)]
pub struct Placement {
    pub cells: HashMap<String, CellRoute>,
    pub sessions: HashMap<String, SessionRoute>,
}

/// A row's or a renewal's refusal (contracts `FreewayTicketRefusal`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Refusal {
    pub code: &'static str,
    pub message: &'static str,
    pub retryable: bool,
}

impl Refusal {
    pub fn json(&self) -> Value {
        json!({ "code": self.code, "message": self.message, "retryable": self.retryable })
    }
}

const NO_SESSION: Refusal = Refusal {
    code: "SESSION_NOT_FOUND",
    message: "no such session on this desktop",
    retryable: false,
};
const NO_CELL: Refusal = Refusal {
    code: "UNAVAILABLE",
    message: "the session's terminal host is not serving",
    retryable: true,
};
const STALE: Refusal = Refusal {
    code: "CONFLICT",
    message: "the session's grant is at another generation",
    retryable: false,
};

pub struct Keyring {
    client_id: String,
    rights: Vec<AttachRight>,
    /// Every mint is above this: a revoke's `beforeGeneration`, less one.
    floor: u64,
    transport_generations: HashMap<String, u64>,
    attach_generations: HashMap<String, u64>,
    renewals: HashMap<String, VecDeque<(String, Value)>>,
}

impl Keyring {
    pub fn new(client_id: String, rights: Vec<AttachRight>) -> Self {
        Self {
            client_id,
            rights,
            floor: 0,
            transport_generations: HashMap::new(),
            attach_generations: HashMap::new(),
            renewals: HashMap::new(),
        }
    }

    /// A renewal's rights are the next mints' (the grants already out keep theirs until they
    /// lapse).
    pub fn set_rights(&mut self, rights: Vec<AttachRight>) {
        self.rights = rights;
    }

    pub fn rights(&self) -> &[AttachRight] {
        &self.rights
    }

    /// A revoke: the `beforeGeneration` for every cell's `RevokeClient`, one above every grant
    /// this keyring minted. Later mints start there, and no remembered renewal (a grant from
    /// before) is handed out again.
    pub fn revoke(&mut self) -> u64 {
        let minted = (self.transport_generations.values())
            .chain(self.attach_generations.values())
            .copied()
            .max()
            .unwrap_or(0);
        let before = minted.max(self.floor) + 1;
        self.floor = before - 1;
        self.renewals.clear();
        before
    }

    /// `terminal-tickets {sessionIds}` → the `FreewayOpened {tickets}` answer, a row per session.
    pub fn tickets(&mut self, session_ids: &[String], placement: &Placement, now_ms: u64) -> Value {
        let rows: Vec<Value> = session_ids
            .iter()
            .map(
                |session_id| match self.ticket(session_id, placement, now_ms) {
                    Ok(ticket) => json!({ "sessionId": session_id, "ticket": ticket }),
                    Err(refusal) => json!({ "sessionId": session_id, "refusal": refusal.json() }),
                },
            )
            .collect();
        json!({ "tickets": rows })
    }

    /// `terminal-renew` → the `FreewayOpened {attachGrant}` answer, or `{refusal}`.
    pub fn renew(
        &mut self,
        session_id: &str,
        expect_generation: u64,
        request_id: &str,
        placement: &Placement,
        now_ms: u64,
    ) -> Value {
        if let Some(remembered) = self
            .renewals
            .get(session_id)
            .and_then(|memory| memory.iter().find(|(id, _)| id == request_id))
        {
            return json!({ "attachGrant": remembered.1 });
        }
        let current = self
            .attach_generations
            .get(session_id)
            .copied()
            .unwrap_or(0);
        if current != expect_generation {
            return json!({ "refusal": STALE.json() });
        }
        let grant = match self.attach(session_id, placement, now_ms) {
            Ok(grant) => grant,
            Err(refusal) => return json!({ "refusal": refusal.json() }),
        };
        let memory = self.renewals.entry(session_id.to_owned()).or_default();
        memory.push_back((request_id.to_owned(), grant.clone()));
        while memory.len() > RENEWAL_MEMORY {
            memory.pop_front();
        }
        json!({ "attachGrant": grant })
    }

    fn ticket(
        &mut self,
        session_id: &str,
        placement: &Placement,
        now_ms: u64,
    ) -> Result<Value, Refusal> {
        let (session, cell) = route(session_id, placement)?;
        let cell_boot_id = &cell.key.cell_boot_id;
        let generation = bump(&mut self.transport_generations, cell_boot_id, self.floor);
        let nonce = BASE64URL_NOPAD.encode(&rand::random::<[u8; 16]>());
        let connection_set_id = format!("{}@{}", self.client_id, cell_boot_id);
        let transport = transport_grant(
            &cell.key,
            &TransportMint {
                client_id: &self.client_id,
                connection_set_id: &connection_set_id,
                channels: &[Channel::Control, Channel::Frames],
                generation,
                issued_at: now_ms,
                expires_at: now_ms + tp::TRANSPORT_GRANT_TTL_MS,
                nonce: &nonce,
            },
        );
        let attach = self.attach(session_id, placement, now_ms)?;
        let mut route = json!({ "cellBootId": cell_boot_id, "routeRevision": cell.route_revision });
        if let Some(epoch) = session.lease_epoch {
            route["leaseEpoch"] = json!(epoch);
        }
        Ok(json!({
            "route": route,
            "endpoints": {
                "controlUrl": format!("freeway://cell/{cell_boot_id}/control"),
                "framesUrl": format!("freeway://cell/{cell_boot_id}/frames"),
            },
            "transportGrant": transport,
            "attachGrant": attach,
        }))
    }

    fn attach(
        &mut self,
        session_id: &str,
        placement: &Placement,
        now_ms: u64,
    ) -> Result<Value, Refusal> {
        let (session, cell) = route(session_id, placement)?;
        let generation = bump(&mut self.attach_generations, session_id, self.floor);
        Ok(attach_grant(
            &cell.key,
            &AttachMint {
                client_id: &self.client_id,
                session_id,
                lease_epoch: session.lease_epoch,
                route_revision: cell.route_revision,
                generation,
                rights: &self.rights,
                issued_at: now_ms,
                expires_at: now_ms + limits::KEYRING_ATTACH_TTL_MS,
            },
        ))
    }
}

fn route<'a>(
    session_id: &str,
    placement: &'a Placement,
) -> Result<(&'a SessionRoute, &'a CellRoute), Refusal> {
    let session = placement.sessions.get(session_id).ok_or(NO_SESSION)?;
    let cell = placement.cells.get(&session.cell_boot_id).ok_or(NO_CELL)?;
    Ok((session, cell))
}

fn bump(generations: &mut HashMap<String, u64>, key: &str, floor: u64) -> u64 {
    let generation = generations.entry(key.to_owned()).or_insert(0);
    *generation = (*generation).max(floor) + 1;
    *generation
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tp::grant::{GrantValidityLimits, GrantVerifier};

    const NOW: u64 = 1_787_788_800_000;
    const CELL: &str = "cb-7f3a9c1e-2026";
    const CLIENT: &str = "freeway:person@example.com#nKMW~hb-01J9F";

    fn key() -> GrantKey {
        GrantKey {
            cell_boot_id: CELL.into(),
            key_generation: 1,
            key: vec![7; 32],
        }
    }

    fn placement() -> Placement {
        let mut placement = Placement::default();
        placement.cells.insert(
            CELL.into(),
            CellRoute {
                key: key(),
                route_revision: 12,
                control_url: "ws://127.0.0.1:9/control".into(),
                frames_url: "ws://127.0.0.1:9/frames".into(),
            },
        );
        placement.sessions.insert(
            "sess-a".into(),
            SessionRoute {
                cell_boot_id: CELL.into(),
                lease_epoch: Some(4),
            },
        );
        placement.sessions.insert(
            "sess-gone".into(),
            SessionRoute {
                cell_boot_id: "cb-gone".into(),
                lease_epoch: None,
            },
        );
        placement
    }

    fn keyring() -> Keyring {
        Keyring::new(
            CLIENT.into(),
            vec![AttachRight::Geometry, AttachRight::Input, AttachRight::Read],
        )
    }

    #[test]
    fn a_ticket_is_the_link_s_own_and_the_cell_takes_both_its_grants() {
        let mut ring = keyring();
        let answer = ring.tickets(&["sess-a".into()], &placement(), NOW);
        let ticket = &answer["tickets"][0]["ticket"];
        assert_eq!(
            ticket["endpoints"]["framesUrl"],
            json!(format!("freeway://cell/{CELL}/frames"))
        );
        assert_eq!(
            ticket["route"],
            json!({ "cellBootId": CELL, "routeRevision": 12, "leaseEpoch": 4 })
        );
        let verifier = GrantVerifier::new(key(), GrantValidityLimits::default());
        let transport = verifier
            .verify_transport(&ticket["transportGrant"], NOW)
            .unwrap();
        assert_eq!(transport.connection_set_id, format!("{CLIENT}@{CELL}"));
        assert_eq!(transport.transport_grant_generation, 1);
        let attach = verifier.verify_attach(&ticket["attachGrant"], NOW).unwrap();
        assert_eq!(attach.client_id, CLIENT);
        assert_eq!(attach.expires_at, NOW + limits::KEYRING_ATTACH_TTL_MS);
        // Every ticket carries a FRESH transport grant: the next generation, another nonce.
        let again = ring.tickets(&["sess-a".into()], &placement(), NOW + 1);
        let next = verifier
            .verify_transport(&again["tickets"][0]["ticket"]["transportGrant"], NOW + 1)
            .unwrap();
        assert_eq!(next.transport_grant_generation, 2);
        assert_ne!(next.nonce, transport.nonce);
    }

    #[test]
    fn a_session_it_cannot_mint_for_is_a_row_that_says_why() {
        let mut ring = keyring();
        let answer = ring.tickets(
            &["sess-a".into(), "sess-none".into(), "sess-gone".into()],
            &placement(),
            NOW,
        );
        let rows = answer["tickets"].as_array().unwrap();
        assert!(rows[0]["ticket"].is_object());
        assert_eq!(rows[1]["refusal"], NO_SESSION.json());
        assert_eq!(rows[2]["refusal"], NO_CELL.json());
    }

    #[test]
    fn a_renewal_is_a_cas_on_the_generation_held_and_idempotent_by_its_request() {
        let mut ring = keyring();
        ring.tickets(&["sess-a".into()], &placement(), NOW);
        let verifier = GrantVerifier::new(key(), GrantValidityLimits::default());
        let renewed = ring.renew("sess-a", 1, "rq-1", &placement(), NOW + 60_000);
        let grant = verifier
            .verify_attach(&renewed["attachGrant"], NOW + 60_000)
            .unwrap();
        assert_eq!(grant.grant_generation, 2);
        // The same request again is the same answer, the generation untouched.
        assert_eq!(
            ring.renew("sess-a", 1, "rq-1", &placement(), NOW + 61_000),
            renewed
        );
        // A stale expectation is CONFLICT: the phone re-reads what it holds.
        assert_eq!(
            ring.renew("sess-a", 1, "rq-2", &placement(), NOW + 62_000),
            json!({ "refusal": STALE.json() })
        );
        assert_eq!(
            ring.renew("sess-none", 0, "rq-3", &placement(), NOW),
            json!({ "refusal": NO_SESSION.json() })
        );
    }

    #[test]
    fn a_revoke_names_one_above_every_grant_out_and_every_later_mint_starts_there() {
        let mut ring = keyring();
        ring.tickets(&["sess-a".into()], &placement(), NOW);
        ring.renew("sess-a", 1, "rq-1", &placement(), NOW);
        // Out: transport 1 on the cell, attach 1 and 2 on sess-a.
        assert_eq!(ring.revoke(), 3);
        // A remembered renewal is a grant from before the revoke: never handed out again.
        assert_eq!(
            ring.renew("sess-a", 1, "rq-1", &placement(), NOW),
            json!({ "refusal": STALE.json() })
        );
        // Both counters mint at the floor now — the transport one jumps from 1 to 3 — so the
        // cells, told to refuse below 3, take them.
        let verifier = GrantVerifier::new(key(), GrantValidityLimits::default());
        let answer = ring.tickets(&["sess-a".into()], &placement(), NOW + 1);
        let ticket = &answer["tickets"][0]["ticket"];
        let transport = verifier
            .verify_transport(&ticket["transportGrant"], NOW + 1)
            .unwrap();
        let attach = verifier
            .verify_attach(&ticket["attachGrant"], NOW + 1)
            .unwrap();
        assert_eq!(
            (
                transport.transport_grant_generation,
                attach.grant_generation
            ),
            (3, 3)
        );
        // A second revoke with nothing minted since is still above everything out.
        assert_eq!(ring.revoke(), 4);
    }
}
