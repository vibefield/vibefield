//! The authenticated grant envelope and its verification (terminal-pipeline-v3
//! §5.1, TP-D21): `{ protected: {v, typ, iss, alg, kid}, claims, mac }` with
//! `mac = base64url(HMAC-SHA256(key, JCS({protected, claims})))`. fieldd MINTS
//! (`packages/fieldd/src/terminal-grants.ts`); the cell VERIFIES — here — with
//! the per-cell-boot key the floor minted beside the cell token and delivered at
//! spawn. The trust boundary is stated in the spec: the key is symmetric, so a
//! cell could mint grants for ITSELF — which it already fully owns; the real
//! boundaries (cell vs cell, cell vs same-uid agents) hold by per-boot keys and
//! by the key never entering an agent environment.
//!
//! Two outcome classes (§5.1, v0.7) and ONE ordering rule: the MAC is checked
//! over the RECEIVED JSON values of `protected` and `claims` (unknown fields
//! included — a typed re-serialization would silently drop them and break the
//! MAC; the tolerant reader logs unknowns, it never rejects them), and no claim
//! is trusted before the MAC verifies. The silent class closes `1008` with no
//! body; the structured class (`GRANT_GENERATION_ROLLBACK`, `GRANT_NONCE_REPLAYED`,
//! `CHANNEL_NOT_ALLOWED`, …) is the LEDGER's business (`ledger.rs`), because a
//! grant can be perfectly valid and still not admissible right now.

use super::jcs::canonical_json;
use crate::registries::terminal_pipeline as tp;
use data_encoding::BASE64URL_NOPAD;
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// The per-cell-boot key under every grant fieldd issues for this cell.
#[derive(Clone)]
pub struct GrantKey {
    pub cell_boot_id: String,
    pub key_generation: u64,
    pub key: Vec<u8>,
}

impl std::fmt::Debug for GrantKey {
    // The key bytes never reach a log line (EL7) — not even via `{:?}`.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GrantKey")
            .field("cell_boot_id", &self.cell_boot_id)
            .field("key_generation", &self.key_generation)
            .field("key", &format_args!("<{} bytes>", self.key.len()))
            .finish()
    }
}

/// §5.1 validity bounds — the same numbers fieldd mints within (registries).
#[derive(Debug, Clone, Copy)]
pub struct GrantValidityLimits {
    pub max_clock_skew_ms: u64,
    pub max_grant_lifetime_ms: u64,
}

impl Default for GrantValidityLimits {
    fn default() -> Self {
        Self {
            max_clock_skew_ms: tp::MAX_CLOCK_SKEW_MS,
            max_grant_lifetime_ms: tp::MAX_GRANT_LIFETIME_MS,
        }
    }
}

/// The SILENT class (contracts `PreAuthFailureCode`): the socket closes `1008`
/// with no body and no code on the wire; the code exists for the audit line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PreAuthFailureCode {
    GrantBadMac,
    GrantKeyUnknown,
    GrantTypeMismatch,
    GrantAudienceMismatch,
    GrantExpired,
    GrantNotYetValid,
    GrantLifetimeExceeded,
    OriginRejected,
    HelloMalformed,
    PreAuthLimit,
}

impl PreAuthFailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::GrantBadMac => "GRANT_BAD_MAC",
            Self::GrantKeyUnknown => "GRANT_KEY_UNKNOWN",
            Self::GrantTypeMismatch => "GRANT_TYPE_MISMATCH",
            Self::GrantAudienceMismatch => "GRANT_AUDIENCE_MISMATCH",
            Self::GrantExpired => "GRANT_EXPIRED",
            Self::GrantNotYetValid => "GRANT_NOT_YET_VALID",
            Self::GrantLifetimeExceeded => "GRANT_LIFETIME_EXCEEDED",
            Self::OriginRejected => "ORIGIN_REJECTED",
            Self::HelloMalformed => "HELLO_MALFORMED",
            Self::PreAuthLimit => "PRE_AUTH_LIMIT",
        }
    }
}

/// One silent failure: the code for the audit line plus a detail that names the
/// field or rule — never a claim value, never the key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreAuthFailure {
    pub code: PreAuthFailureCode,
    pub detail: String,
}

impl PreAuthFailure {
    pub fn new(code: PreAuthFailureCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for PreAuthFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.code.as_str(), self.detail)
    }
}

/// Which of the two grants a message requires (`protected.typ` — domain
/// separation: a transport grant can never be presented as an attach grant).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrantType {
    CellTransportGrant,
    SessionAttachGrant,
}

impl GrantType {
    fn as_str(self) -> &'static str {
        match self {
            Self::CellTransportGrant => "CellTransportGrant",
            Self::SessionAttachGrant => "SessionAttachGrant",
        }
    }
}

/// The two transport channels (contracts `TransportChannel`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Control,
    Frames,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Control => "control",
            Self::Frames => "frames",
        }
    }
}

/// Attach rights (contracts `SessionAttachRight`); sorted unique on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum AttachRight {
    Geometry,
    GeometryAdmin,
    Input,
    Read,
}

/// `CellTransportGrant.claims` (contracts `CellTransportGrantClaims`), typed
/// AFTER the MAC verified. Unknown fields are tolerated by serde's default.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportClaims {
    pub audience_cell_boot_id: String,
    pub client_id: String,
    pub connection_set_id: String,
    pub allowed_channels: Vec<Channel>,
    pub transport_grant_generation: u64,
    pub issued_at: u64,
    pub expires_at: u64,
    pub nonce: String,
}

/// `SessionAttachGrant.claims` (contracts `SessionAttachGrantClaims`).
/// `lease_epoch` is OPTIONAL until the floor exposes custody's per-session
/// epoch (spec §5.1 as built) — absent is "not exposed", never 0.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachClaims {
    pub audience_cell_boot_id: String,
    pub client_id: String,
    pub session_id: String,
    #[serde(default)]
    pub lease_epoch: Option<u64>,
    pub route_revision: u64,
    pub grant_generation: u64,
    pub rights: Vec<AttachRight>,
    pub issued_at: u64,
    pub expires_at: u64,
}

/// Verifies grants for ONE cell boot with ONE key (rotation = a new boot = a new
/// `kid`; a stale `kid` is `GRANT_KEY_UNKNOWN`).
#[derive(Debug, Clone)]
pub struct GrantVerifier {
    key: GrantKey,
    limits: GrantValidityLimits,
}

impl GrantVerifier {
    pub fn new(key: GrantKey, limits: GrantValidityLimits) -> Self {
        Self { key, limits }
    }

    pub fn cell_boot_id(&self) -> &str {
        &self.key.cell_boot_id
    }

    pub fn limits(&self) -> GrantValidityLimits {
        self.limits
    }

    /// Verify a `CellTransportGrant` as received (a JSON value) at `now_ms`.
    pub fn verify_transport(
        &self,
        grant: &Value,
        now_ms: u64,
    ) -> Result<TransportClaims, PreAuthFailure> {
        let claims = self.verify_envelope(grant, GrantType::CellTransportGrant, now_ms)?;
        let typed: TransportClaims = serde_json::from_value(claims).map_err(|e| {
            PreAuthFailure::new(
                PreAuthFailureCode::HelloMalformed,
                format!("transport claims: {e}"),
            )
        })?;
        if !is_sorted_unique(&typed.allowed_channels) {
            return Err(PreAuthFailure::new(
                PreAuthFailureCode::HelloMalformed,
                "allowedChannels is not a sorted unique array",
            ));
        }
        Ok(typed)
    }

    /// Verify a `SessionAttachGrant` as received (a JSON value) at `now_ms`.
    pub fn verify_attach(
        &self,
        grant: &Value,
        now_ms: u64,
    ) -> Result<AttachClaims, PreAuthFailure> {
        let claims = self.verify_envelope(grant, GrantType::SessionAttachGrant, now_ms)?;
        let typed: AttachClaims = serde_json::from_value(claims).map_err(|e| {
            PreAuthFailure::new(
                PreAuthFailureCode::HelloMalformed,
                format!("attach claims: {e}"),
            )
        })?;
        if !is_sorted_unique(&typed.rights) {
            return Err(PreAuthFailure::new(
                PreAuthFailureCode::HelloMalformed,
                "rights is not a sorted unique array",
            ));
        }
        Ok(typed)
    }

    /// The shared half: shape → typ → header → kid → MAC → audience → validity.
    /// Returns the RECEIVED claims value for typed parsing by the caller.
    fn verify_envelope(
        &self,
        grant: &Value,
        expect: GrantType,
        now_ms: u64,
    ) -> Result<Value, PreAuthFailure> {
        use PreAuthFailureCode as C;
        let malformed =
            |what: &str| PreAuthFailure::new(C::HelloMalformed, format!("grant.{what}"));
        let obj = grant
            .as_object()
            .ok_or_else(|| malformed("not an object"))?;
        let protected = obj
            .get("protected")
            .and_then(Value::as_object)
            .ok_or_else(|| malformed("protected"))?;
        let claims = obj
            .get("claims")
            .filter(|c| c.is_object())
            .ok_or_else(|| malformed("claims"))?;
        let mac_text = obj
            .get("mac")
            .and_then(Value::as_str)
            .ok_or_else(|| malformed("mac"))?;

        // typ FIRST (§5.1): "a receiver checks protected.typ against the grant
        // the message requires before anything else".
        let typ = protected
            .get("typ")
            .and_then(Value::as_str)
            .ok_or_else(|| malformed("protected.typ"))?;
        if typ != expect.as_str() {
            return Err(PreAuthFailure::new(
                C::GrantTypeMismatch,
                format!("expected {}", expect.as_str()),
            ));
        }
        // The rest of the protected header: an envelope this verifier does not
        // speak (another version, issuer or algorithm) has no key here.
        if protected.get("v").and_then(Value::as_u64) != Some(1) {
            return Err(PreAuthFailure::new(C::GrantKeyUnknown, "protected.v"));
        }
        if protected.get("iss").and_then(Value::as_str) != Some("fieldd") {
            return Err(PreAuthFailure::new(C::GrantKeyUnknown, "protected.iss"));
        }
        if protected.get("alg").and_then(Value::as_str) != Some("HS256") {
            return Err(PreAuthFailure::new(C::GrantKeyUnknown, "protected.alg"));
        }
        let kid = protected
            .get("kid")
            .and_then(Value::as_object)
            .ok_or_else(|| malformed("protected.kid"))?;
        let kid_boot = kid.get("cellBootId").and_then(Value::as_str);
        let kid_gen = kid.get("keyGeneration").and_then(Value::as_u64);
        if kid_boot != Some(self.key.cell_boot_id.as_str())
            || kid_gen != Some(self.key.key_generation)
        {
            return Err(PreAuthFailure::new(C::GrantKeyUnknown, "protected.kid"));
        }

        // The MAC over the RECEIVED protected + claims values, canonicalized.
        let signing_input = canonical_json(&json!({ "protected": protected, "claims": claims }))
            .map_err(|e| malformed(&format!("canonical: {e}")))?;
        let given = BASE64URL_NOPAD
            .decode(mac_text.as_bytes())
            .map_err(|_| PreAuthFailure::new(C::GrantBadMac, "mac is not base64url"))?;
        let mut mac =
            HmacSha256::new_from_slice(&self.key.key).expect("hmac accepts any key length");
        mac.update(signing_input.as_bytes());
        if mac.verify_slice(&given).is_err() {
            return Err(PreAuthFailure::new(C::GrantBadMac, "mac"));
        }

        // Only now are the claims trusted enough to READ.
        let audience = claims.get("audienceCellBootId").and_then(Value::as_str);
        if audience != Some(self.key.cell_boot_id.as_str()) {
            return Err(PreAuthFailure::new(
                C::GrantAudienceMismatch,
                "audienceCellBootId",
            ));
        }
        let issued_at = claims
            .get("issuedAt")
            .and_then(Value::as_u64)
            .ok_or_else(|| malformed("claims.issuedAt"))?;
        let expires_at = claims
            .get("expiresAt")
            .and_then(Value::as_u64)
            .ok_or_else(|| malformed("claims.expiresAt"))?;
        self.check_validity(issued_at, expires_at, now_ms)?;
        Ok(claims.clone())
    }

    /// §5.1 (normative): lifetime first (it makes the tombstone math finite),
    /// then the skew-bounded window.
    pub fn check_validity(
        &self,
        issued_at: u64,
        expires_at: u64,
        now_ms: u64,
    ) -> Result<(), PreAuthFailure> {
        use PreAuthFailureCode as C;
        if expires_at < issued_at || expires_at - issued_at > self.limits.max_grant_lifetime_ms {
            return Err(PreAuthFailure::new(
                C::GrantLifetimeExceeded,
                "expiresAt - issuedAt > maxGrantLifetimeMs",
            ));
        }
        if now_ms < issued_at.saturating_sub(self.limits.max_clock_skew_ms) {
            return Err(PreAuthFailure::new(
                C::GrantNotYetValid,
                "now < issuedAt - skew",
            ));
        }
        if now_ms >= expires_at.saturating_add(self.limits.max_clock_skew_ms) {
            return Err(PreAuthFailure::new(
                C::GrantExpired,
                "now >= expiresAt + skew",
            ));
        }
        Ok(())
    }
}

/// Every set-valued claim is a SORTED (codepoint order) UNIQUE JSON array —
/// JCS has no sets (§5.1). The serde enums derive `Ord` in their wire order.
fn is_sorted_unique<T: Ord>(items: &[T]) -> bool {
    items.windows(2).all(|w| w[0] < w[1])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures")
            .join(name);
        serde_json::from_str(&std::fs::read_to_string(&p).expect("fixture read")).expect("json")
    }

    fn verifier_for(v: &Value) -> GrantVerifier {
        let key = hex::decode(v["keyHex"].as_str().unwrap()).unwrap();
        GrantVerifier::new(
            GrantKey {
                cell_boot_id: v["transport"]["protected"]["kid"]["cellBootId"]
                    .as_str()
                    .unwrap()
                    .to_string(),
                key_generation: 1,
                key,
            },
            GrantValidityLimits::default(),
        )
    }

    fn grant(v: &Value, which: &str) -> Value {
        json!({
            "protected": v[which]["protected"],
            "claims": v[which]["claims"],
            "mac": v[which]["mac"],
        })
    }

    #[test]
    fn the_grant_mac_vector_verifies_on_the_cell_side() {
        let v = fixture("tp-grant-mac.vector.json");
        let verifier = verifier_for(&v);
        let now = v["transport"]["claims"]["issuedAt"].as_u64().unwrap() + 1_000;
        let t = verifier
            .verify_transport(&grant(&v, "transport"), now)
            .unwrap();
        assert_eq!(t.connection_set_id, "cs-win-3c4d-2-cb-7f3a9c1e");
        assert_eq!(t.allowed_channels, vec![Channel::Control, Channel::Frames]);
        assert_eq!(t.transport_grant_generation, 3);
        let a = verifier.verify_attach(&grant(&v, "attach"), now).unwrap();
        assert_eq!(a.session_id, "sess-01J8Z3K9");
        assert_eq!(a.lease_epoch, Some(4));
        assert_eq!(
            a.rights,
            vec![AttachRight::Geometry, AttachRight::Input, AttachRight::Read]
        );
    }

    #[test]
    fn every_silent_code_has_its_trigger() {
        use PreAuthFailureCode as C;
        let v = fixture("tp-grant-mac.vector.json");
        let verifier = verifier_for(&v);
        let issued = v["transport"]["claims"]["issuedAt"].as_u64().unwrap();
        let now = issued + 1_000;
        let ok = grant(&v, "transport");

        // type mismatch: an attach grant where a transport grant is required
        let a = grant(&v, "attach");
        assert_eq!(
            verifier.verify_transport(&a, now).unwrap_err().code,
            C::GrantTypeMismatch
        );
        // bad mac: one claim byte changed after minting
        let mut tampered = ok.clone();
        tampered["claims"]["clientId"] = json!("win-EVIL");
        assert_eq!(
            verifier.verify_transport(&tampered, now).unwrap_err().code,
            C::GrantBadMac
        );
        // an extra unknown claim also breaks the MAC (the MAC covers what was RECEIVED)
        let mut extra = ok.clone();
        extra["claims"]["surprise"] = json!(1);
        assert_eq!(
            verifier.verify_transport(&extra, now).unwrap_err().code,
            C::GrantBadMac
        );
        // key unknown: another boot's kid
        let mut stale = ok.clone();
        stale["protected"]["kid"]["keyGeneration"] = json!(2);
        assert_eq!(
            verifier.verify_transport(&stale, now).unwrap_err().code,
            C::GrantKeyUnknown
        );
        let mut alg = ok.clone();
        alg["protected"]["alg"] = json!("none");
        assert_eq!(
            verifier.verify_transport(&alg, now).unwrap_err().code,
            C::GrantKeyUnknown
        );
        // audience mismatch: a grant minted for this key but naming another cell
        // (re-signed with the same key — what a cell could do for ITSELF only)
        let other = {
            let mut g = ok.clone();
            g["claims"]["audienceCellBootId"] = json!("cb-other");
            let input =
                canonical_json(&json!({"protected": g["protected"], "claims": g["claims"]}))
                    .unwrap();
            let mut mac = HmacSha256::new_from_slice(&verifier.key.key).unwrap();
            mac.update(input.as_bytes());
            g["mac"] = json!(BASE64URL_NOPAD.encode(&mac.finalize().into_bytes()));
            g
        };
        assert_eq!(
            verifier.verify_transport(&other, now).unwrap_err().code,
            C::GrantAudienceMismatch
        );
        // validity: expired / not yet valid / lifetime
        let expires = v["transport"]["claims"]["expiresAt"].as_u64().unwrap();
        assert_eq!(
            verifier
                .verify_transport(&ok, expires + tp::MAX_CLOCK_SKEW_MS)
                .unwrap_err()
                .code,
            C::GrantExpired
        );
        assert!(verifier
            .verify_transport(&ok, expires + tp::MAX_CLOCK_SKEW_MS - 1)
            .is_ok());
        assert_eq!(
            verifier
                .verify_transport(&ok, issued - tp::MAX_CLOCK_SKEW_MS - 1)
                .unwrap_err()
                .code,
            C::GrantNotYetValid
        );
        assert!(verifier
            .verify_transport(&ok, issued - tp::MAX_CLOCK_SKEW_MS)
            .is_ok());
        assert_eq!(
            verifier
                .check_validity(issued, issued + tp::MAX_GRANT_LIFETIME_MS + 1, now)
                .unwrap_err()
                .code,
            C::GrantLifetimeExceeded
        );
        // malformed: no mac at all
        let mut no_mac = ok.clone();
        no_mac.as_object_mut().unwrap().remove("mac");
        assert_eq!(
            verifier.verify_transport(&no_mac, now).unwrap_err().code,
            C::HelloMalformed
        );
    }

    #[test]
    fn grant_key_debug_never_prints_the_key() {
        let k = GrantKey {
            cell_boot_id: "cb".into(),
            key_generation: 1,
            key: vec![0x5e; 32],
        };
        let shown = format!("{k:?}");
        assert!(shown.contains("<32 bytes>"));
        assert!(!shown.contains("5e"));
    }
}
