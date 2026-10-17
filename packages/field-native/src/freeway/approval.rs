//! FW-D1 (v0.3 §3, §5.1) — the phone's approval, verified at its hello. fieldd mints it
//! (`freeway.approve`) for a node its roster correlates to a phone row: TPv3's envelope
//! (`protected {v: 1, typ: "FreewayApproval", iss: "fieldd", alg: HS256, kid: {floorBootId,
//! keyGeneration}}`), the MAC over the JCS signing input with the floor's freeway key. The host
//! holds that key (stdin line 1) and checks every term here; whether the principal is the node on
//! THIS connection is the door's admit check, beside it. Pinned by
//! `freeway-approval-mac.vector.json` with fieldd's side. The key reaches no log (EL7).

use crate::registries::{freeway as limits, terminal_pipeline as tp};
use crate::tp::grant::AttachRight;
use crate::tp::jcs::canonical_json;
use data_encoding::BASE64URL_NOPAD;
use hmac::{Hmac, KeyInit, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;

/// The floor's freeway key, under every approval fieldd mints for this floor boot.
#[derive(Clone)]
pub struct ApprovalKey {
    pub floor_boot_id: String,
    pub key_generation: u64,
    pub key: Vec<u8>,
}

impl std::fmt::Debug for ApprovalKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ApprovalKey")
            .field("floor_boot_id", &self.floor_boot_id)
            .field("key_generation", &self.key_generation)
            .field("key", &format_args!("<{} bytes>", self.key.len()))
            .finish()
    }
}

/// Who fieldd approved (contracts `FreewayApprovalClaims.principal`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Principal {
    pub kind: String,
    pub login: String,
    pub tailscale_id: String,
}

/// An approval's claims, typed AFTER its MAC verified (contracts `FreewayApprovalClaims`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalClaims {
    pub audience_floor_boot_id: String,
    pub client_id: String,
    pub principal: Principal,
    pub rights: Vec<AttachRight>,
    pub issued_at: u64,
    pub expires_at: u64,
    pub nonce: String,
}

/// Why an approval was refused — the hello's `FreewayRefused` code (4401 `APPROVAL`), and a
/// detail for the audit line that never carries a claim value or the key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalRefusal {
    /// `APPROVAL_INVALID`: not this floor's, not well formed, or not signed with its key.
    Invalid(&'static str),
    /// `APPROVAL_EXPIRED`: valid once; renew it over the product door.
    Expired,
}

impl ApprovalRefusal {
    /// The contracts' `FreewayRefusalCode`.
    pub fn code(self) -> &'static str {
        match self {
            Self::Invalid(_) => "APPROVAL_INVALID",
            Self::Expired => "APPROVAL_EXPIRED",
        }
    }
}

/// Verify `approval` (a JSON value, as received) at `now_ms`.
pub fn verify(
    key: &ApprovalKey,
    approval: &Value,
    now_ms: u64,
) -> Result<ApprovalClaims, ApprovalRefusal> {
    use ApprovalRefusal::Invalid;
    let protected = approval.get("protected").ok_or(Invalid("protected"))?;
    let claims = approval.get("claims").ok_or(Invalid("claims"))?;
    let mac = approval
        .get("mac")
        .and_then(Value::as_str)
        .ok_or(Invalid("mac"))?;
    let header = |field: &str| protected.get(field);
    if header("typ").and_then(Value::as_str) != Some("FreewayApproval") {
        return Err(Invalid("protected.typ"));
    }
    if header("v").and_then(Value::as_u64) != Some(1)
        || header("iss").and_then(Value::as_str) != Some("fieldd")
        || header("alg").and_then(Value::as_str) != Some("HS256")
    {
        return Err(Invalid("protected"));
    }
    let kid = header("kid").ok_or(Invalid("protected.kid"))?;
    if kid.get("floorBootId").and_then(Value::as_str) != Some(key.floor_boot_id.as_str())
        || kid.get("keyGeneration").and_then(Value::as_u64) != Some(key.key_generation)
    {
        return Err(Invalid("protected.kid"));
    }
    let input = canonical_json(&json!({ "protected": protected, "claims": claims }))
        .map_err(|_| Invalid("canonical"))?;
    let given = BASE64URL_NOPAD
        .decode(mac.as_bytes())
        .map_err(|_| Invalid("mac"))?;
    let mut expected =
        Hmac::<Sha256>::new_from_slice(&key.key).expect("hmac accepts any key length");
    expected.update(input.as_bytes());
    // `verify_slice` compares in constant time.
    expected.verify_slice(&given).map_err(|_| Invalid("mac"))?;

    let typed: ApprovalClaims =
        serde_json::from_value(claims.clone()).map_err(|_| Invalid("claims"))?;
    if typed.audience_floor_boot_id != key.floor_boot_id {
        return Err(Invalid("claims.audienceFloorBootId"));
    }
    if typed.principal.kind != "tailnet" {
        return Err(Invalid("claims.principal"));
    }
    if typed.rights.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(Invalid("claims.rights"));
    }
    // TPv3's validity rules (§5.1), with the approval's own lifetime bound.
    let skew = tp::MAX_CLOCK_SKEW_MS;
    if typed.expires_at.saturating_sub(typed.issued_at) > limits::APPROVAL_TTL_MS {
        return Err(Invalid("claims.lifetime"));
    }
    if now_ms.saturating_add(skew) < typed.issued_at {
        return Err(Invalid("claims.issuedAt"));
    }
    if now_ms >= typed.expires_at.saturating_add(skew) {
        return Err(ApprovalRefusal::Expired);
    }
    Ok(typed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vector() -> Value {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures/freeway-approval-mac.vector.json");
        serde_json::from_str(&std::fs::read_to_string(&path).expect("vector read")).expect("json")
    }

    fn key(v: &Value) -> ApprovalKey {
        ApprovalKey {
            floor_boot_id: v["approval"]["protected"]["kid"]["floorBootId"]
                .as_str()
                .unwrap()
                .into(),
            key_generation: 1,
            key: hex::decode(v["keyHex"].as_str().unwrap()).unwrap(),
        }
    }

    fn approval(v: &Value) -> Value {
        let a = &v["approval"];
        json!({ "protected": a["protected"], "claims": a["claims"], "mac": a["mac"] })
    }

    fn now(v: &Value) -> u64 {
        v["approval"]["claims"]["issuedAt"].as_u64().unwrap() + 1_000
    }

    #[test]
    fn fieldds_approval_verifies_here_byte_for_byte() {
        let v = vector();
        let signing = v["approval"]["signingInput"].as_str().unwrap();
        let rebuilt = canonical_json(&json!({
            "protected": v["approval"]["protected"], "claims": v["approval"]["claims"]
        }))
        .unwrap();
        assert_eq!(rebuilt, signing, "the host's JCS is fieldd's");
        let claims = verify(&key(&v), &approval(&v), now(&v)).expect("the vector verifies");
        assert_eq!(claims.principal.kind, "tailnet");
        assert_eq!(
            claims.rights,
            vec![AttachRight::Geometry, AttachRight::Input, AttachRight::Read]
        );
    }

    #[test]
    fn every_term_is_checked() {
        let v = vector();
        let (key, ok, at) = (key(&v), approval(&v), now(&v));
        let refused = |approval: &Value, at: u64| verify(&key, approval, at).unwrap_err();
        let mut forged = ok.clone();
        forged["claims"]["rights"] = json!(["geometry", "geometryAdmin", "input", "read"]);
        assert_eq!(refused(&forged, at), ApprovalRefusal::Invalid("mac"));
        let mut retyped = ok.clone();
        retyped["protected"]["typ"] = json!("SessionAttachGrant");
        assert_eq!(
            refused(&retyped, at),
            ApprovalRefusal::Invalid("protected.typ")
        );
        let mut other_floor = ApprovalKey {
            floor_boot_id: "fb-other".into(),
            ..key.clone()
        };
        assert_eq!(
            verify(&other_floor, &ok, at).unwrap_err(),
            ApprovalRefusal::Invalid("protected.kid")
        );
        other_floor.floor_boot_id = key.floor_boot_id.clone();
        other_floor.key = vec![0; 32];
        assert_eq!(
            verify(&other_floor, &ok, at).unwrap_err(),
            ApprovalRefusal::Invalid("mac")
        );
        let expires = v["approval"]["claims"]["expiresAt"].as_u64().unwrap();
        let expired = refused(&ok, expires + tp::MAX_CLOCK_SKEW_MS);
        assert_eq!(expired, ApprovalRefusal::Expired);
        assert_eq!(expired.code(), "APPROVAL_EXPIRED");
        assert!(verify(&key, &ok, expires + tp::MAX_CLOCK_SKEW_MS - 1).is_ok());
        let early =
            v["approval"]["claims"]["issuedAt"].as_u64().unwrap() - tp::MAX_CLOCK_SKEW_MS - 1;
        assert_eq!(
            refused(&ok, early),
            ApprovalRefusal::Invalid("claims.issuedAt")
        );
    }

    #[test]
    fn the_key_never_prints() {
        let key = ApprovalKey {
            floor_boot_id: "fb".into(),
            key_generation: 1,
            key: vec![0xa5; 32],
        };
        let printed = format!("{key:?}");
        assert!(printed.contains("<32 bytes>"));
        assert!(!printed.contains("a5") && !printed.contains("165"));
    }
}
