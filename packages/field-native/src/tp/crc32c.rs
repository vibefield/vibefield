//! CRC-32C (Castagnoli, reflected polynomial 0x82F63B78) — the transfer
//! checksum (terminal-pipeline-v3 §8: `checksum: {alg: "crc32c", value}` over
//! the concatenated chunk bytes; integrity only — the channel is already
//! authenticated). Table-driven, ~40 lines, no new crate: the lockfile carries
//! no crc32c and a checksum is not a reason to move it (EL8).

const POLY: u32 = 0x82F6_3B78;

const fn make_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut crc = i as u32;
        let mut j = 0;
        while j < 8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ POLY
            } else {
                crc >> 1
            };
            j += 1;
        }
        table[i] = crc;
        i += 1;
    }
    table
}

static TABLE: [u32; 256] = make_table();

/// Incremental CRC-32C: feed chunks in order, `finish` when done.
#[derive(Debug, Clone, Copy)]
pub struct Crc32c(u32);

impl Default for Crc32c {
    fn default() -> Self {
        Self::new()
    }
}

impl Crc32c {
    pub fn new() -> Self {
        Self(0xFFFF_FFFF)
    }

    pub fn update(&mut self, bytes: &[u8]) {
        let mut crc = self.0;
        for &b in bytes {
            crc = TABLE[((crc ^ b as u32) & 0xFF) as usize] ^ (crc >> 8);
        }
        self.0 = crc;
    }

    pub fn finish(self) -> u32 {
        self.0 ^ 0xFFFF_FFFF
    }
}

/// One-shot.
pub fn crc32c(bytes: &[u8]) -> u32 {
    let mut c = Crc32c::new();
    c.update(bytes);
    c.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_check_value_and_chunked_equivalence() {
        // The standard CRC-32C check value (RFC 3720 §B.4 / the "123456789" vector).
        assert_eq!(crc32c(b"123456789"), 0xE306_9283);
        // RFC 3720's 32 bytes of zeros and 32 bytes of 0xFF.
        assert_eq!(crc32c(&[0u8; 32]), 0x8A91_36AA);
        assert_eq!(crc32c(&[0xFFu8; 32]), 0x62A8_AB43);
        // incremental == one-shot
        let data: Vec<u8> = (0..=255u8).cycle().take(10_000).collect();
        let mut inc = Crc32c::new();
        for chunk in data.chunks(777) {
            inc.update(chunk);
        }
        assert_eq!(inc.finish(), crc32c(&data));
        assert_eq!(crc32c(b""), 0);
    }
}
