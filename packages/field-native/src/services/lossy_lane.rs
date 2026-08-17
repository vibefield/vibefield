//! Versioned fragmentation/reassembly for lossy MeshData lanes.
//!
//! Every UDP packet is independently bounded; one logical ICE snapshot may use
//! several packets. A receiver retains at most ONE incomplete (newest) message
//! per lane, so loss costs one snapshot rather than unbounded memory. The next
//! full snapshot heals it, and the QUIC terminal replay uses the same sequence
//! comparison before graceful lane retirement.

use crate::services::mesh_bridge::{LOSSY_MAX_LOGICAL_BYTES, LOSSY_MAX_PAYLOAD_BYTES};

const MAGIC: [u8; 2] = *b"VP";
const VERSION: u8 = 1;
pub const DATAGRAM_HEADER_BYTES: usize = 20;
pub const DATAGRAM_BODY_BYTES: usize = LOSSY_MAX_PAYLOAD_BYTES - DATAGRAM_HEADER_BYTES;

#[derive(Debug)]
pub struct Datagram<'a> {
    pub origin_lane_id: u32,
    pub sequence: u32,
    pub chunk_index: u16,
    pub chunk_count: u16,
    pub total_len: usize,
    pub payload: &'a [u8],
}

pub fn encode_datagrams(
    origin_lane_id: u32,
    sequence: u32,
    payload: &[u8],
) -> anyhow::Result<Vec<Vec<u8>>> {
    anyhow::ensure!(
        payload.len() <= LOSSY_MAX_LOGICAL_BYTES,
        "lossy logical payload {} exceeds {LOSSY_MAX_LOGICAL_BYTES}",
        payload.len()
    );
    let chunk_count = payload.len().div_ceil(DATAGRAM_BODY_BYTES).max(1);
    anyhow::ensure!(chunk_count <= u16::MAX as usize, "too many lossy fragments");
    let mut packets = Vec::with_capacity(chunk_count);
    for chunk_index in 0..chunk_count {
        let start = chunk_index * DATAGRAM_BODY_BYTES;
        let end = (start + DATAGRAM_BODY_BYTES).min(payload.len());
        let body = &payload[start..end];
        let mut packet = Vec::with_capacity(DATAGRAM_HEADER_BYTES + body.len());
        packet.extend_from_slice(&MAGIC);
        packet.push(VERSION);
        packet.push(0); // flags/reserved; nonzero belongs to a future version
        packet.extend_from_slice(&origin_lane_id.to_be_bytes());
        packet.extend_from_slice(&sequence.to_be_bytes());
        packet.extend_from_slice(&(chunk_index as u16).to_be_bytes());
        packet.extend_from_slice(&(chunk_count as u16).to_be_bytes());
        packet.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        packet.extend_from_slice(body);
        debug_assert!(packet.len() <= LOSSY_MAX_PAYLOAD_BYTES);
        packets.push(packet);
    }
    Ok(packets)
}

pub fn decode_datagram(packet: &[u8]) -> anyhow::Result<Datagram<'_>> {
    anyhow::ensure!(
        (DATAGRAM_HEADER_BYTES..=LOSSY_MAX_PAYLOAD_BYTES).contains(&packet.len()),
        "lossy datagram has invalid length {}",
        packet.len()
    );
    anyhow::ensure!(packet[0..2] == MAGIC, "lossy datagram has bad magic");
    anyhow::ensure!(packet[2] == VERSION, "unknown lossy datagram version");
    anyhow::ensure!(packet[3] == 0, "unknown lossy datagram flags");
    let origin_lane_id = u32::from_be_bytes(packet[4..8].try_into()?);
    let sequence = u32::from_be_bytes(packet[8..12].try_into()?);
    let chunk_index = u16::from_be_bytes(packet[12..14].try_into()?);
    let chunk_count = u16::from_be_bytes(packet[14..16].try_into()?);
    let total_len = u32::from_be_bytes(packet[16..20].try_into()?) as usize;
    anyhow::ensure!(
        total_len <= LOSSY_MAX_LOGICAL_BYTES,
        "lossy datagram declares oversized logical message"
    );
    let expected_count = total_len.div_ceil(DATAGRAM_BODY_BYTES).max(1);
    anyhow::ensure!(
        chunk_count as usize == expected_count,
        "lossy datagram has inconsistent chunk count"
    );
    anyhow::ensure!(
        chunk_index < chunk_count,
        "lossy datagram chunk rank is out of range"
    );
    let expected_body = if chunk_index as usize + 1 == expected_count {
        total_len.saturating_sub((expected_count - 1) * DATAGRAM_BODY_BYTES)
    } else {
        DATAGRAM_BODY_BYTES
    };
    anyhow::ensure!(
        packet.len() - DATAGRAM_HEADER_BYTES == expected_body,
        "lossy datagram chunk has inconsistent length"
    );
    Ok(Datagram {
        origin_lane_id,
        sequence,
        chunk_index,
        chunk_count,
        total_len,
        payload: &packet[DATAGRAM_HEADER_BYTES..],
    })
}

#[derive(Debug)]
struct Pending {
    sequence: u32,
    total_len: usize,
    chunks: Vec<Option<Vec<u8>>>,
    received: usize,
}

#[derive(Debug, Default)]
pub struct Reassembler {
    completed: Option<u32>,
    pending: Option<Pending>,
}

impl Reassembler {
    pub fn ingest(&mut self, datagram: &Datagram<'_>) -> Option<(u32, Vec<u8>)> {
        if let Some(completed) = self.completed {
            if datagram.sequence == completed || !sequence_is_newer(datagram.sequence, completed) {
                return None;
            }
        }
        let replace = match self.pending.as_ref() {
            None => true,
            Some(pending) if pending.sequence == datagram.sequence => {
                if pending.total_len != datagram.total_len
                    || pending.chunks.len() != datagram.chunk_count as usize
                {
                    return None;
                }
                false
            }
            Some(pending) => sequence_is_newer(datagram.sequence, pending.sequence),
        };
        if !replace
            && self
                .pending
                .as_ref()
                .is_some_and(|pending| pending.sequence != datagram.sequence)
        {
            return None;
        }
        if replace {
            self.pending = Some(Pending {
                sequence: datagram.sequence,
                total_len: datagram.total_len,
                chunks: vec![None; datagram.chunk_count as usize],
                received: 0,
            });
        }
        let pending = self.pending.as_mut()?;
        let slot = &mut pending.chunks[datagram.chunk_index as usize];
        if slot.is_none() {
            *slot = Some(datagram.payload.to_vec());
            pending.received += 1;
        }
        if pending.received != pending.chunks.len() {
            return None;
        }
        let pending = self.pending.take()?;
        let mut payload = Vec::with_capacity(pending.total_len);
        for chunk in pending.chunks {
            payload.extend_from_slice(chunk?.as_slice());
        }
        if payload.len() != pending.total_len {
            return None;
        }
        self.completed = Some(pending.sequence);
        Some((pending.sequence, payload))
    }

    /** Apply the reliable close replay. Equal-to-completed is a duplicate;
     * equal-to-pending completes the message without waiting on lost UDP. */
    pub fn ingest_final(&mut self, sequence: u32, payload: &[u8]) -> Option<Vec<u8>> {
        if payload.len() > LOSSY_MAX_LOGICAL_BYTES {
            return None;
        }
        if let Some(completed) = self.completed {
            if sequence == completed || !sequence_is_newer(sequence, completed) {
                return None;
            }
        }
        if self
            .pending
            .as_ref()
            .is_some_and(|pending| sequence_is_newer(pending.sequence, sequence))
        {
            return None;
        }
        self.pending = None;
        self.completed = Some(sequence);
        Some(payload.to_vec())
    }
}

pub fn sequence_is_newer(candidate: u32, current: u32) -> bool {
    let distance = candidate.wrapping_sub(current);
    distance != 0 && distance < (1 << 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_large_snapshot_fragments_below_the_ceiling_and_reassembles_out_of_order() {
        let payload = vec![0x5a; 4_242];
        let mut packets = encode_datagrams(7, 9, &payload).unwrap();
        assert_eq!(packets.len(), 4);
        assert!(packets
            .iter()
            .all(|packet| packet.len() <= LOSSY_MAX_PAYLOAD_BYTES));
        packets.reverse();
        let mut reassembler = Reassembler::default();
        let mut complete = None;
        for packet in packets {
            complete = complete.or_else(|| reassembler.ingest(&decode_datagram(&packet).unwrap()));
        }
        assert_eq!(complete, Some((9, payload)));
    }

    #[test]
    fn a_newer_snapshot_abandons_an_incomplete_older_one_and_sequence_wraps() {
        let older = encode_datagrams(1, u32::MAX, &vec![1; 2_000]).unwrap();
        let newer = encode_datagrams(1, 0, &vec![2; 2_000]).unwrap();
        let mut reassembler = Reassembler::default();
        assert!(reassembler
            .ingest(&decode_datagram(&older[0]).unwrap())
            .is_none());
        let mut complete = None;
        for packet in newer {
            complete = complete.or_else(|| reassembler.ingest(&decode_datagram(&packet).unwrap()));
        }
        assert_eq!(complete.map(|(_, payload)| payload), Some(vec![2; 2_000]));
        assert!(reassembler
            .ingest(&decode_datagram(&older[1]).unwrap())
            .is_none());
    }

    #[test]
    fn terminal_replay_heals_missing_udp_and_deduplicates_completed_udp() {
        let payload = vec![3; 2_000];
        let packets = encode_datagrams(4, 11, &payload).unwrap();
        let mut missing = Reassembler::default();
        assert!(missing
            .ingest(&decode_datagram(&packets[0]).unwrap())
            .is_none());
        assert_eq!(missing.ingest_final(11, &payload), Some(payload.clone()));
        assert_eq!(missing.ingest_final(11, &payload), None);

        let mut complete = Reassembler::default();
        for packet in packets {
            let _ = complete.ingest(&decode_datagram(&packet).unwrap());
        }
        assert_eq!(complete.ingest_final(11, &payload), None);
    }

    #[test]
    fn malformed_and_oversized_packets_fail_closed() {
        assert!(decode_datagram(&[0; DATAGRAM_HEADER_BYTES - 1]).is_err());
        let mut packet = encode_datagrams(1, 1, b"ok").unwrap().remove(0);
        packet[2] = 99;
        assert!(decode_datagram(&packet).is_err());
        assert!(encode_datagrams(1, 1, &vec![0; LOSSY_MAX_LOGICAL_BYTES + 1]).is_err());
    }
}
