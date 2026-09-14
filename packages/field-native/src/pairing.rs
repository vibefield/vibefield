//! D8 — per-boot pairing tokens. Canonical MAC message (pinned by the
//! cross-language vector `packages/contracts/fixtures/pairing.vector.json`):
//!   mac = hex(HMAC-SHA256(secret, "fn-boot" 0x00 bootId 0x00 decimal(ts)))
//! Verifier: |now − ts| ≤ 300s. Leaked boot tokens expire with the boot;
//! rotating = delete the pairing file + restart both daemons (doctor action).

use anyhow::{Context, Result};
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;
use std::fs;
use std::io::Write as _;
use std::path::Path;

type HmacSha256 = Hmac<Sha256>;

pub const PAIRING_CONTEXT: &[u8] = b"fn-boot";
/// WIN-10 — the SERVER's context. Distinct from `fn-boot` so neither direction's
/// transcript can be replayed as the other's.
pub const ACK_CONTEXT: &[u8] = b"fn-ack";
pub const WINDOW_SECS: i64 = 300;

/// Load the 0600 pairing secret, creating it on first boot (fieldd waits/retries).
pub fn load_or_create_secret(path: &Path) -> Result<[u8; 32]> {
    if path.exists() {
        return read_secret(path);
    }
    let mut secret = [0u8; 32];
    rand::fill(&mut secret);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    // 0600 AT BIRTH, and never through a link. `fs::write` + `set_permissions`
    // left the secret world-readable for one syscall and followed a symlink
    // planted at the path; `create_private` opens with O_EXCL and the mode
    // (MF-2f — the same fix landed at the mirror-write capability, which TM-3
    // deleted on 2026-09-14; this secret is the class's only member now).
    // WIN-D4 unchanged: on windows the profile's inherited ACLs carry the
    // other-user boundary, and on every OS the same-uid adversary is held out
    // by the token discipline rather than by the file mode.
    let mut file = match crate::secret_file::create_private(path) {
        Ok(file) => file,
        // Another boot created it between the check above and this create —
        // fieldd's own retry loop makes that reachable. Its secret is the one
        // on disk and both planes must agree on it, so read it back.
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return read_secret(path);
        }
        Err(error) => {
            return Err(anyhow::Error::new(error))
                .with_context(|| format!("create {}", path.display()))
        }
    };
    file.write_all(hex::encode(secret).as_bytes())
        .with_context(|| format!("write {}", path.display()))?;
    file.sync_all()
        .with_context(|| format!("sync {}", path.display()))?;
    Ok(secret)
}

fn read_secret(path: &Path) -> Result<[u8; 32]> {
    let raw = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let bytes = hex::decode(raw.trim()).context("pairing file is not hex")?;
    bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("pairing secret must be 32 bytes"))
}

fn mac_message(boot_id: &str, ts: i64) -> Vec<u8> {
    let ts_str = ts.to_string();
    let mut m = Vec::with_capacity(PAIRING_CONTEXT.len() + boot_id.len() + ts_str.len() + 2);
    m.extend_from_slice(PAIRING_CONTEXT);
    m.push(0);
    m.extend_from_slice(boot_id.as_bytes());
    m.push(0);
    m.extend_from_slice(ts_str.as_bytes());
    m
}

pub fn compute_mac(secret: &[u8], boot_id: &str, ts: i64) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac accepts any key length");
    mac.update(&mac_message(boot_id, ts));
    hex::encode(mac.finalize().into_bytes())
}

/// WIN-10 — this daemon's proof that it holds the pairing secret, answering the
/// client's per-connection nonce:
///   serverMac = hex(HMAC-SHA256(secret, "fn-ack" 0x00 nonce 0x00 bootId))
///
/// The client's MAC proves the CLIENT. On unix nothing had to prove the server:
/// the socket sat inside a 0700 run directory, so only the owner could have
/// created the thing answering. The Windows pipe namespace is flat and
/// machine-wide (WIN-D1), so another local account can publish our name before
/// we do — and fieldd's connect probe would read that squatter as "alive",
/// spawn no real native, and believe whatever ack came back, terminal endpoints
/// and auth token included. This is what makes the answer checkable.
pub fn compute_ack_mac(secret: &[u8], nonce: &str, boot_id: &str) -> String {
    let mut m = Vec::with_capacity(ACK_CONTEXT.len() + nonce.len() + boot_id.len() + 2);
    m.extend_from_slice(ACK_CONTEXT);
    m.push(0);
    m.extend_from_slice(nonce.as_bytes());
    m.push(0);
    m.extend_from_slice(boot_id.as_bytes());
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac accepts any key length");
    mac.update(&m);
    hex::encode(mac.finalize().into_bytes())
}

/// Constant-time verification (hmac::verify_slice) + freshness window.
pub fn verify(secret: &[u8], boot_id: &str, ts: i64, mac_hex: &str, now: i64) -> bool {
    if (now - ts).abs() > WINDOW_SECS {
        return false;
    }
    let Ok(given) = hex::decode(mac_hex) else {
        return false;
    };
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac accepts any key length");
    mac.update(&mac_message(boot_id, ts));
    mac.verify_slice(&given).is_ok()
}

pub fn now_epoch_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock before epoch")
        .as_secs() as i64
}
