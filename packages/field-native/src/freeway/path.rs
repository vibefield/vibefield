//! FW (v0.3 §5) — the path the link's writer paces to. The peer's answers say two things about
//! it: a `Pong` to this side's own `Ping` is a round trip (its `sentAtMs` is this side's clock,
//! echoed), and every `Ack` — or a Pong's `ackBytes` — is the peer's cumulative delivered bytes,
//! whose growth over time is the delivery rate. From the smallest round trip and the largest rate
//! of the last `WINDOW_MS`, the writer gets its in-flight cap — max(`FREEWAY.WATERMARK_BYTES`,
//! 1.25 × min-RTT × delivery rate) — and its fragment size, about `FRAGMENT_MS` of the path,
//! clamped to `FREEWAY.MIN_FRAGMENT_BYTES`…`FREEWAY.FRAGMENT_BYTES`.
//!
//! The 1.25 is the probe: at the floor the rate the acks show is the floor's own (one cap a round
//! trip), so the cap grows a quarter a round trip until the path stops delivering faster. A rate
//! measured while the link was idle (app-limited) is low and the max filter passes over it, as a
//! round trip that queued behind a burst is long and the min filter passes over that. Pure:
//! samples in, numbers out; the link feeds it and sets the writer.

use crate::registries::freeway as limits;
use std::collections::VecDeque;

/// How long a sample stands in either filter.
pub const WINDOW_MS: u64 = 10_000;
/// The fragment's share of the path, in time.
pub const FRAGMENT_MS: u64 = 5;

#[derive(Debug, Default)]
pub struct Path {
    /// (at, rtt ms), rtt strictly increasing front to back: the front is the window's minimum.
    rtts: VecDeque<(u64, u64)>,
    /// (at, bytes a second), rate strictly decreasing front to back: the front is the maximum.
    rates: VecDeque<(u64, u64)>,
    /// The last delivered count, and when it came.
    last: Option<(u64, u64)>,
}

impl Path {
    pub fn new() -> Self {
        Self::default()
    }

    /// A round trip measured at `now`.
    pub fn rtt(&mut self, now: u64, rtt_ms: u64) {
        while self.rtts.back().is_some_and(|&(_, rtt)| rtt >= rtt_ms) {
            self.rtts.pop_back();
        }
        self.rtts.push_back((now, rtt_ms));
        Self::expire(&mut self.rtts, now);
    }

    /// The peer's cumulative delivered bytes at `now`. An older or equal count is a reorder or
    /// a repeat and says nothing about the rate.
    pub fn delivered(&mut self, now: u64, delivered: u64) {
        match self.last {
            Some((at, before)) if delivered > before && now > at => {
                let rate = (delivered - before).saturating_mul(1_000) / (now - at);
                while self.rates.back().is_some_and(|&(_, r)| r <= rate) {
                    self.rates.pop_back();
                }
                self.rates.push_back((now, rate));
                self.last = Some((now, delivered));
            }
            Some((_, before)) if delivered <= before => {}
            _ => self.last = Some((now, delivered)),
        }
        Self::expire(&mut self.rates, now);
    }

    /// The smallest round trip of the window, if one was measured.
    pub fn min_rtt(&self) -> Option<u64> {
        self.rtts.front().map(|&(_, rtt)| rtt)
    }

    /// The largest delivery rate of the window (bytes a second), if one was measured.
    pub fn rate(&self) -> Option<u64> {
        self.rates.front().map(|&(_, rate)| rate)
    }

    /// The writer's in-flight cap: 1.25 bandwidth-delay products, never below the floor.
    pub fn cap(&self) -> u64 {
        let product = match (self.min_rtt(), self.rate()) {
            (Some(rtt), Some(rate)) => rate.saturating_mul(rtt) / 1_000,
            _ => 0,
        };
        (product.saturating_mul(5) / 4).max(limits::WATERMARK_BYTES)
    }

    /// The writer's fragment size: about `FRAGMENT_MS` of the path at its rate, in the registry's
    /// bounds; the largest until a rate is known.
    pub fn fragment_bytes(&self) -> usize {
        let (floor, ceiling) = (limits::MIN_FRAGMENT_BYTES, limits::FRAGMENT_BYTES);
        let bytes = self
            .rate()
            .map_or(ceiling, |rate| rate.saturating_mul(FRAGMENT_MS) / 1_000);
        bytes.clamp(floor, ceiling) as usize
    }

    fn expire(samples: &mut VecDeque<(u64, u64)>, now: u64) {
        // The newest sample stays whatever its age: a filter is never left empty by time alone.
        while samples.len() > 1
            && samples
                .front()
                .is_some_and(|&(at, _)| now.saturating_sub(at) > WINDOW_MS)
        {
            samples.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_nothing_measured_the_cap_is_the_floor_and_the_fragment_the_largest() {
        let path = Path::new();
        assert_eq!(path.cap(), limits::WATERMARK_BYTES);
        assert_eq!(path.fragment_bytes(), limits::FRAGMENT_BYTES as usize);
        let mut half = Path::new();
        half.rtt(0, 20);
        assert_eq!(
            half.cap(),
            limits::WATERMARK_BYTES,
            "a round trip and no rate"
        );
    }

    #[test]
    fn the_cap_is_a_quarter_over_one_bandwidth_delay_product() {
        let mut path = Path::new();
        path.rtt(0, 20);
        // 10 MB/s: 1 MB delivered in 100 ms
        path.delivered(0, 0);
        path.delivered(100, 1_000_000);
        assert_eq!(path.rate(), Some(10_000_000));
        // BDP = 10 MB/s × 20 ms = 200 KB; × 1.25
        assert_eq!(path.cap(), 250_000);
        // 5 ms of 10 MB/s = 50 KB
        assert_eq!(path.fragment_bytes(), 50_000);
    }

    #[test]
    fn the_filters_keep_the_smallest_round_trip_and_the_largest_rate_of_the_window() {
        let mut path = Path::new();
        for (at, rtt) in [(0, 30), (100, 12), (200, 45), (300, 18)] {
            path.rtt(at, rtt);
        }
        assert_eq!(path.min_rtt(), Some(12));
        path.delivered(0, 0);
        path.delivered(1_000, 2_000_000); // 2 MB/s
        path.delivered(1_100, 2_100_000); // 1 MB/s: app-limited, passed over
        assert_eq!(path.rate(), Some(2_000_000));
        // past the window the old minimum and maximum leave
        path.rtt(10_101, 25);
        assert_eq!(
            path.min_rtt(),
            Some(18),
            "12 aged out; 18 at 300 still stands"
        );
        path.rtt(10_301, 40);
        assert_eq!(path.min_rtt(), Some(25));
        // 100 KB over 10 001 ms, in whole bytes a second; the 2 MB/s and 1 MB/s samples aged out
        path.delivered(11_101, 2_200_000);
        assert_eq!(path.rate(), Some(9_999));
    }

    #[test]
    fn a_repeated_or_older_count_says_nothing_and_the_cap_grows_by_its_gain() {
        let mut path = Path::new();
        path.rtt(0, 10);
        path.delivered(0, 1_000);
        path.delivered(5, 1_000);
        path.delivered(6, 900);
        assert_eq!(path.rate(), None, "no growth, no rate");
        // one cap a round trip at the floor: the rate the floor allows
        let floor = limits::WATERMARK_BYTES;
        path.delivered(10, 1_000 + floor);
        let first = path.cap();
        assert_eq!(first, floor * 100 * 5 / 4 / 100);
        // the next round trip moves what the new cap allows: a quarter again
        path.delivered(20, 1_000 + floor + first);
        assert!(
            path.cap() > first,
            "the probe grows the cap round trip by round trip"
        );
    }

    #[test]
    fn the_fragment_is_held_to_the_registry_bounds() {
        let mut slow = Path::new();
        slow.delivered(0, 0);
        slow.delivered(1_000, 1_000); // 1 KB/s: 5 ms is 5 bytes
        assert_eq!(slow.fragment_bytes(), limits::MIN_FRAGMENT_BYTES as usize);
        let mut fast = Path::new();
        fast.delivered(0, 0);
        fast.delivered(1, 1_000_000_000); // 1 TB/s
        assert_eq!(fast.fragment_bytes(), limits::FRAGMENT_BYTES as usize);
    }
}
