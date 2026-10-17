//! FW-D1 (v0.3 §5.1, §6) — the host mints a phone's two cell grants from the keys the floor
//! generated. They are TPv3's envelopes (`tp::grant`'s shape) with `iss: "field-native"` — honest
//! provenance, never a host signing as fieldd — and the MAC over the JCS signing input with the
//! CELL's own key, so the cell verifies them exactly as it verifies fieldd's (`GrantVerifier`).
//! The contracts name the shape `FreewayOpenTicket`'s grants. Keys never reach a log (EL7).

use crate::tp::grant::{AttachRight, Channel, GrantKey};
use crate::tp::jcs::canonical_json;
use data_encoding::BASE64URL_NOPAD;
use hmac::{Hmac, KeyInit, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

/// The issuer the host's grants name.
pub const ISSUER: &str = "field-native";

/// What a `CellTransportGrant` the host mints claims (contracts `CellTransportGrantClaims`).
pub struct TransportMint<'a> {
    pub client_id: &'a str,
    pub connection_set_id: &'a str,
    pub channels: &'a [Channel],
    pub generation: u64,
    pub issued_at: u64,
    pub expires_at: u64,
    pub nonce: &'a str,
}

/// What a `SessionAttachGrant` the host mints claims (contracts `SessionAttachGrantClaims`).
pub struct AttachMint<'a> {
    pub client_id: &'a str,
    pub session_id: &'a str,
    pub lease_epoch: Option<u64>,
    pub route_revision: u64,
    pub generation: u64,
    pub rights: &'a [AttachRight],
    pub issued_at: u64,
    pub expires_at: u64,
}

/// A transport grant for `key`'s cell.
pub fn transport_grant(key: &GrantKey, mint: &TransportMint<'_>) -> Value {
    let mut channels = mint.channels.to_vec();
    channels.sort();
    channels.dedup();
    let channels: Vec<&str> = channels.iter().map(|channel| channel.as_str()).collect();
    let claims = json!({
        "audienceCellBootId": key.cell_boot_id,
        "clientId": mint.client_id,
        "connectionSetId": mint.connection_set_id,
        "allowedChannels": channels,
        "transportGrantGeneration": mint.generation,
        "issuedAt": mint.issued_at,
        "expiresAt": mint.expires_at,
        "nonce": mint.nonce,
    });
    envelope(key, "CellTransportGrant", claims)
}

/// An attach grant for `key`'s cell. `rights` is a SET on the wire — sorted by codepoint and
/// unique — which `AttachRight`'s declaration order already is.
pub fn attach_grant(key: &GrantKey, mint: &AttachMint<'_>) -> Value {
    let mut rights = mint.rights.to_vec();
    rights.sort();
    rights.dedup();
    let mut claims = json!({
        "audienceCellBootId": key.cell_boot_id,
        "clientId": mint.client_id,
        "sessionId": mint.session_id,
        "routeRevision": mint.route_revision,
        "grantGeneration": mint.generation,
        "rights": rights,
        "issuedAt": mint.issued_at,
        "expiresAt": mint.expires_at,
    });
    if let Some(epoch) = mint.lease_epoch {
        claims["leaseEpoch"] = json!(epoch);
    }
    envelope(key, "SessionAttachGrant", claims)
}

fn envelope(key: &GrantKey, typ: &str, claims: Value) -> Value {
    let protected = json!({
        "v": 1,
        "typ": typ,
        "iss": ISSUER,
        "alg": "HS256",
        "kid": { "cellBootId": key.cell_boot_id, "keyGeneration": key.key_generation },
    });
    // Every value above is a string, an integer or a set of strings: JCS cannot refuse them.
    let input = canonical_json(&json!({ "protected": protected, "claims": claims }))
        .expect("a grant's values are JCS-canonical");
    let mut mac = Hmac::<Sha256>::new_from_slice(&key.key).expect("hmac accepts any key length");
    mac.update(input.as_bytes());
    let mac = BASE64URL_NOPAD.encode(&mac.finalize().into_bytes());
    json!({ "protected": protected, "claims": claims, "mac": mac })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tp::grant::{GrantValidityLimits, GrantVerifier, PreAuthFailureCode};

    const NOW: u64 = 1_787_788_800_000;

    fn key() -> GrantKey {
        GrantKey {
            cell_boot_id: "cb-7f3a9c1e-2026".into(),
            key_generation: 1,
            key: vec![7; 32],
        }
    }

    fn transport() -> Value {
        transport_grant(
            &key(),
            &TransportMint {
                client_id: "freeway:person@example.com#nKMW~hb-01J9F",
                connection_set_id: "cs-freeway-nKMW-cb-7f3a9c1e-2026",
                channels: &[Channel::Frames, Channel::Control, Channel::Frames],
                generation: 1,
                issued_at: NOW,
                expires_at: NOW + 60_000,
                nonce: "RldBWS1UUkFOU1BPUlQ",
            },
        )
    }

    #[test]
    fn the_cell_verifies_the_hosts_grants_as_it_verifies_fieldds() {
        let verifier = GrantVerifier::new(key(), GrantValidityLimits::default());
        let claims = verifier
            .verify_transport(&transport(), NOW)
            .expect("a host grant verifies");
        assert_eq!(
            claims.allowed_channels,
            vec![Channel::Control, Channel::Frames]
        );
        let attach = attach_grant(
            &key(),
            &AttachMint {
                client_id: "freeway:person@example.com#nKMW~hb-01J9F",
                session_id: "sess-01J8Z3K9",
                lease_epoch: Some(4),
                route_revision: 12,
                generation: 1,
                rights: &[AttachRight::Read, AttachRight::Input, AttachRight::Geometry],
                issued_at: NOW,
                expires_at: NOW + 120_000,
            },
        );
        assert_eq!(attach["protected"]["iss"], json!(ISSUER));
        let claims = verifier
            .verify_attach(&attach, NOW)
            .expect("a host attach verifies");
        assert_eq!(
            claims.rights,
            vec![AttachRight::Geometry, AttachRight::Input, AttachRight::Read]
        );
        assert_eq!(claims.lease_epoch, Some(4));
    }

    #[test]
    fn the_cell_takes_the_two_issuers_it_knows_and_no_third() {
        let verifier = GrantVerifier::new(key(), GrantValidityLimits::default());
        let resign = |grant: &mut Value| {
            let input = canonical_json(&json!({
                "protected": grant["protected"], "claims": grant["claims"]
            }))
            .unwrap();
            let mut mac = Hmac::<Sha256>::new_from_slice(&key().key).unwrap();
            mac.update(input.as_bytes());
            grant["mac"] = json!(BASE64URL_NOPAD.encode(&mac.finalize().into_bytes()));
        };
        let mut fieldd = transport();
        fieldd["protected"]["iss"] = json!("fieldd");
        resign(&mut fieldd);
        assert!(verifier.verify_transport(&fieldd, NOW).is_ok());
        let mut third = transport();
        third["protected"]["iss"] = json!("field-freeway-host");
        resign(&mut third);
        assert_eq!(
            verifier.verify_transport(&third, NOW).unwrap_err().code,
            PreAuthFailureCode::GrantKeyUnknown
        );
        // The issuer is under the MAC: changing it unsigned is a forgery, not a new issuer.
        let mut forged = transport();
        forged["protected"]["iss"] = json!("fieldd");
        assert!(verifier.verify_transport(&forged, NOW).is_err());
    }
}
