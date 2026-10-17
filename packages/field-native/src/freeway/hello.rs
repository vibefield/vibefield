//! FW (v0.3 §3, §4.4) — the link's first frame, decided. Pure: the door hands it the identity the
//! sidecar injected on the secret path, the host's admit table and approval key, and the hello's
//! payload; it answers the welcome, or the refusal and the close code that follows it.
//!
//! In order: the hello must be one of the two forms (4400 `PROTOCOL`) at this protocol major
//! (4426 `PROTOCOL_VERSION`); the node must be admitted (4403 `NOT_ADMITTED`), and open with its
//! role's form — a phone with the phone's hello and its approval, a desktop with the peer hello
//! (4403 `IDENTITY_MISMATCH`); a phone's approval must verify (4401 `APPROVAL_INVALID` /
//! `APPROVAL_EXPIRED`) and name THIS connection's node and login (4403 `IDENTITY_MISMATCH`), so
//! an approval copied to another node is useless there. The link's client id is the minter's:
//! `freeway:<login>#<node>~<hostBootId>` (§6) — built from the transport's identity, never a claim.

use super::approval::{self, ApprovalClaims, ApprovalKey, ApprovalRefusal};
use crate::registries::{freeway as limits, freeway_codes as codes};
use crate::tp::grant::AttachRight;
use serde_json::{json, Value};
use std::collections::HashMap;

/// What the sidecar injected on the secret path (`Tailscale-User-Login`, `Tailscale-Node-Id`). It
/// strips inbound `Tailscale-*` first, so on that path alone these are the WhoIs truth.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub login: String,
    pub node_id: String,
}

/// What an admitted node is to this desktop (contracts `FreewayAdmitRow.role`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeerRole {
    Desktop,
    Phone,
}

/// fieldd's declaration (`admit`), joined with the floor's peer rows: a node id → its roster
/// device and role. A node in no row is no one's.
#[derive(Debug, Clone, Default)]
pub struct Admit {
    nodes: HashMap<String, (String, PeerRole)>,
}

impl Admit {
    pub fn insert(&mut self, node_id: &str, device_id: &str, role: PeerRole) {
        self.nodes
            .insert(node_id.to_owned(), (device_id.to_owned(), role));
    }
}

/// This host, as its welcome names it.
pub struct Host<'a> {
    pub link_id: &'a str,
    pub host_boot_id: &'a str,
    pub floor_boot_id: &'a str,
    /// THIS desktop's roster device id: the dialer's consistency check (FW-L9).
    pub device_id: &'a str,
}

/// A link admitted: who is on it, and the welcome to send.
#[derive(Debug, Clone)]
pub struct Admitted {
    pub device_id: String,
    pub role: PeerRole,
    /// Who the sidecar said is on it: a phone's renewal must name the same node and login.
    pub identity: Identity,
    /// The phone's, for its grants; a desktop link mints none.
    pub client_id: Option<String>,
    pub rights: Vec<AttachRight>,
    pub approval_expires_at: Option<u64>,
    /// `FreewayWelcome`.
    pub welcome: Value,
}

/// A hello refused: the `FreewayRefused` to send, then the link's close code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Refused {
    /// The contracts' `FreewayRefusalCode`.
    pub code: &'static str,
    pub close: u16,
    pub retryable: bool,
    pub message: &'static str,
}

impl Refused {
    /// `FreewayRefused`, for the LINK frame before the close.
    pub fn payload(&self) -> Value {
        json!({
            "type": "FreewayRefused",
            "code": self.code,
            "retryable": self.retryable,
            "message": self.message,
        })
    }
}

const fn refused(
    code: &'static str,
    close: u16,
    retryable: bool,
    message: &'static str,
) -> Refused {
    Refused {
        code,
        close,
        retryable,
        message,
    }
}

const NOT_A_HELLO: Refused = refused(
    "PROTOCOL",
    codes::PROTOCOL,
    false,
    "the first frame on a link is a hello",
);
const WRONG_MAJOR: Refused = refused(
    "PROTOCOL_VERSION",
    codes::PROTOCOL_VERSION,
    false,
    "this desktop speaks another protocol",
);
const NOT_ADMITTED: Refused = refused(
    "NOT_ADMITTED",
    codes::NOT_ADMITTED,
    false,
    "this device is not admitted to this desktop",
);
const WRONG_FORM: Refused = refused(
    "IDENTITY_MISMATCH",
    codes::NOT_ADMITTED,
    false,
    "this device opened with another kind of device's hello",
);
const NOT_THIS_NODE: Refused = refused(
    "IDENTITY_MISMATCH",
    codes::NOT_ADMITTED,
    false,
    "the approval names another device",
);
const APPROVAL_INVALID: Refused = refused(
    "APPROVAL_INVALID",
    codes::APPROVAL,
    true,
    "the approval did not verify; ask for a new one",
);
const APPROVAL_EXPIRED: Refused = refused(
    "APPROVAL_EXPIRED",
    codes::APPROVAL,
    true,
    "the approval lapsed; renew it over the product door",
);

/// Decide the hello `payload` (stream 0's first message) from `identity` at `now_ms`.
pub fn decide(
    payload: &[u8],
    identity: &Identity,
    admit: &Admit,
    key: &ApprovalKey,
    host: &Host<'_>,
    now_ms: u64,
) -> Result<Admitted, Refused> {
    let hello: Value = serde_json::from_slice(payload).map_err(|_| NOT_A_HELLO)?;
    let phone_form = match hello.get("type").and_then(Value::as_str) {
        Some("FreewayHello") => true,
        Some("FreewayPeerHello") => false,
        _ => return Err(NOT_A_HELLO),
    };
    if hello["protocol"]["major"].as_u64() != Some(limits::PROTOCOL_MAJOR) {
        return Err(WRONG_MAJOR);
    }
    let (device_id, role) = admit.nodes.get(&identity.node_id).ok_or(NOT_ADMITTED)?;
    if (*role == PeerRole::Phone) != phone_form {
        return Err(WRONG_FORM);
    }
    let mut welcome = json!({
        "type": "FreewayWelcome",
        "linkId": host.link_id,
        "hostBootId": host.host_boot_id,
        "floorBootId": host.floor_boot_id,
        "deviceId": host.device_id,
        "rights": [],
        "limits": {
            "fragmentBytes": limits::FRAGMENT_BYTES,
            "streamWindowBytes": limits::STREAM_WINDOW_BYTES,
            "maxStreams": limits::MAX_STREAMS,
        },
        "heartbeatMs": limits::HEARTBEAT_MS,
    });
    if *role == PeerRole::Desktop {
        return Ok(Admitted {
            device_id: device_id.clone(),
            role: *role,
            identity: identity.clone(),
            client_id: None,
            rights: Vec::new(),
            approval_expires_at: None,
            welcome,
        });
    }
    let approval = hello.get("approval").ok_or(APPROVAL_INVALID)?;
    let claims = check_approval(approval, identity, key, now_ms)?;
    let client_id = format!(
        "freeway:{}#{}~{}",
        identity.login, identity.node_id, host.host_boot_id
    );
    welcome["clientId"] = json!(client_id);
    welcome["rights"] = json!(claims.rights);
    welcome["approvalExpiresAt"] = json!(claims.expires_at);
    Ok(Admitted {
        device_id: device_id.clone(),
        role: *role,
        identity: identity.clone(),
        client_id: Some(client_id),
        rights: claims.rights,
        approval_expires_at: Some(claims.expires_at),
        welcome,
    })
}

/// A phone's approval, checked: it verifies (4401 `APPROVAL_INVALID` / `APPROVAL_EXPIRED`) and
/// names THIS connection's node and login (4403 `IDENTITY_MISMATCH`). The hello's check, and the
/// link's at every `Renew`, so a renewal can never move a link to another device.
pub fn check_approval(
    approval: &Value,
    identity: &Identity,
    key: &ApprovalKey,
    now_ms: u64,
) -> Result<ApprovalClaims, Refused> {
    let claims = approval::verify(key, approval, now_ms).map_err(|refusal| match refusal {
        ApprovalRefusal::Invalid(_) => APPROVAL_INVALID,
        ApprovalRefusal::Expired => APPROVAL_EXPIRED,
    })?;
    if claims.principal.tailscale_id != identity.node_id || claims.principal.login != identity.login
    {
        return Err(NOT_THIS_NODE);
    }
    Ok(claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        key: ApprovalKey,
        approval: Value,
        identity: Identity,
        now: u64,
    }

    fn fixture() -> Fixture {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures/freeway-approval-mac.vector.json");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let a = &v["approval"];
        Fixture {
            key: ApprovalKey {
                floor_boot_id: a["protected"]["kid"]["floorBootId"]
                    .as_str()
                    .unwrap()
                    .into(),
                key_generation: 1,
                key: hex::decode(v["keyHex"].as_str().unwrap()).unwrap(),
            },
            approval: json!({ "protected": a["protected"], "claims": a["claims"], "mac": a["mac"] }),
            identity: Identity {
                login: a["claims"]["principal"]["login"].as_str().unwrap().into(),
                node_id: a["claims"]["principal"]["tailscaleId"]
                    .as_str()
                    .unwrap()
                    .into(),
            },
            now: a["claims"]["issuedAt"].as_u64().unwrap() + 1_000,
        }
    }

    const HOST: Host<'static> = Host {
        link_id: "lk-01J9F2A",
        host_boot_id: "hb-01J9F",
        floor_boot_id: "fb-0191b04e-2026",
        device_id: "dev-desktop-a",
    };

    fn phone_hello(approval: &Value, major: u64) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "type": "FreewayHello",
            "protocol": { "major": major, "minor": 0 },
            "approval": approval,
            "capabilities": [],
        }))
        .unwrap()
    }

    fn peer_hello() -> Vec<u8> {
        br#"{"type":"FreewayPeerHello","protocol":{"major":1,"minor":0},"capabilities":[]}"#
            .to_vec()
    }

    fn admit(f: &Fixture, role: PeerRole) -> Admit {
        let mut admit = Admit::default();
        admit.insert(&f.identity.node_id, "dev-phone-1", role);
        admit
    }

    #[test]
    fn an_admitted_phone_with_its_approval_is_welcomed_with_the_minters_client_id() {
        let f = fixture();
        let hello = phone_hello(&f.approval, 1);
        let admitted = decide(
            &hello,
            &f.identity,
            &admit(&f, PeerRole::Phone),
            &f.key,
            &HOST,
            f.now,
        )
        .unwrap();
        let client = format!(
            "freeway:{}#{}~hb-01J9F",
            f.identity.login, f.identity.node_id
        );
        assert_eq!(admitted.client_id.as_deref(), Some(client.as_str()));
        assert_eq!(admitted.welcome["clientId"], json!(client));
        assert_eq!(admitted.welcome["deviceId"], json!("dev-desktop-a"));
        assert_eq!(
            admitted.welcome["rights"],
            json!(["geometry", "input", "read"])
        );
        assert_eq!(
            admitted.welcome["limits"]["maxStreams"],
            json!(limits::MAX_STREAMS)
        );
        assert!(admitted.welcome["approvalExpiresAt"].is_u64());
        // The welcome carries every field the contracts' fixture of it does.
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures/freeway-welcome.phone.json");
        let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for field in fixture.as_object().unwrap().keys().filter(|k| *k != "path") {
            assert!(
                admitted.welcome.get(field).is_some(),
                "the welcome lacks {field}"
            );
        }
    }

    #[test]
    fn a_desktop_is_welcomed_on_the_peer_hello_with_no_rights_and_no_client() {
        let f = fixture();
        let admitted = decide(
            &peer_hello(),
            &f.identity,
            &admit(&f, PeerRole::Desktop),
            &f.key,
            &HOST,
            f.now,
        )
        .unwrap();
        assert_eq!(admitted.client_id, None);
        assert_eq!(admitted.welcome["rights"], json!([]));
        assert!(admitted.welcome.get("clientId").is_none());
    }

    #[test]
    fn every_refusal_says_its_code_and_closes_with_its_number() {
        let f = fixture();
        let phone = admit(&f, PeerRole::Phone);
        let check = |payload: &[u8], admit: &Admit, identity: &Identity, at: u64| {
            decide(payload, identity, admit, &f.key, &HOST, at).unwrap_err()
        };
        assert_eq!(check(b"not json", &phone, &f.identity, f.now), NOT_A_HELLO);
        assert_eq!(
            check(br#"{"type":"Ping"}"#, &phone, &f.identity, f.now),
            NOT_A_HELLO
        );
        assert_eq!(
            check(&phone_hello(&f.approval, 2), &phone, &f.identity, f.now),
            WRONG_MAJOR
        );
        assert_eq!(
            check(
                &phone_hello(&f.approval, 1),
                &Admit::default(),
                &f.identity,
                f.now
            ),
            NOT_ADMITTED
        );
        // a phone node on the desktop's hello, a desktop node on the phone's
        assert_eq!(check(&peer_hello(), &phone, &f.identity, f.now), WRONG_FORM);
        let desktop = admit(&f, PeerRole::Desktop);
        assert_eq!(
            check(&phone_hello(&f.approval, 1), &desktop, &f.identity, f.now),
            WRONG_FORM
        );
        // an approval copied to another admitted node is useless there
        let other = Identity {
            login: f.identity.login.clone(),
            node_id: "nOTHER".into(),
        };
        let mut both = phone.clone();
        both.insert("nOTHER", "dev-phone-2", PeerRole::Phone);
        assert_eq!(
            check(&phone_hello(&f.approval, 1), &both, &other, f.now),
            NOT_THIS_NODE
        );
        let mut forged = f.approval.clone();
        forged["claims"]["rights"] = json!(["geometry", "geometryAdmin", "input", "read"]);
        assert_eq!(
            check(&phone_hello(&forged, 1), &phone, &f.identity, f.now),
            APPROVAL_INVALID
        );
        let late = f.approval["claims"]["expiresAt"].as_u64().unwrap() + 3_600_000;
        assert_eq!(
            check(&phone_hello(&f.approval, 1), &phone, &f.identity, late),
            APPROVAL_EXPIRED
        );
        assert_eq!(APPROVAL_EXPIRED.close, 4401);
        assert_eq!(NOT_THIS_NODE.close, 4403);
        assert_eq!(WRONG_MAJOR.payload()["code"], json!("PROTOCOL_VERSION"));
    }
}
