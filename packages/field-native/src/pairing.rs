//! D8 — per-boot pairing tokens. Canonical MAC message (pinned by the
//! cross-language vector `packages/contracts/fixtures/pairing.vector.json`):
//!   mac = hex(HMAC-SHA256(secret, "fn-boot" 0x00 bootId 0x00 decimal(ts)))
//! Verifier: |now − ts| ≤ 300s. Leaked boot tokens expire with the boot;
//! rotating = delete the pairing file + restart both daemons (doctor action).

use anyhow::{Context, Result};
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

type HmacSha256 = Hmac<Sha256>;

pub const PAIRING_CONTEXT: &[u8] = b"fn-boot";
pub const WINDOW_SECS: i64 = 300;

/// Load the 0600 pairing secret, creating it on first boot (fieldd waits/retries).
pub fn load_or_create_secret(path: &Path) -> Result<[u8; 32]> {
    if path.exists() {
        let raw = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
        let bytes = hex::decode(raw.trim()).context("pairing file is not hex")?;
        let arr: [u8; 32] = bytes
            .try_into()
            .map_err(|_| anyhow::anyhow!("pairing secret must be 32 bytes"))?;
        Ok(arr)
    } else {
        let mut secret = [0u8; 32];
        rand::fill(&mut secret);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, hex::encode(secret))?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        Ok(secret)
    }
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
