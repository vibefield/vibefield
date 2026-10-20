//! UA-P-4 (RFC 025) — THE LOGIN GATE, ON A REAL TAILNET.
//!
//! The unit rows in `mesh_unit.rs` witness the floor's DECISION: which
//! allow-list a posture hands truffle, and that a gated bring-up against a
//! pre-protocol-5 sidecar degrades loudly. They cannot witness the gate itself,
//! because a node cannot be built headlessly. This one can, and it is the live
//! half. Two rows, asking two different questions:
//!
//! 1. `a_gated_node_sees_its_own_login_and_a_walled_one_sees_nobody` — three
//!    ephemeral nodes on ONE auth key: one ungated, one gated on the account's
//!    REAL login, one gated on a glob that cannot match. Every node carries the
//!    SAME login, so the only refusal this row can show is a gate that matches
//!    NOBODY.
//! 2. `a_foreign_login_is_refused_at_the_gate_and_never_enters_it` (UA-P-4d) —
//!    the witness the first row cannot construct: a fourth node on a SECOND
//!    auth key, minted by a SECOND USER of the same tailnet, so its login is
//!    genuinely foreign. It answers what the roadmap has owed since UA-4 — a
//!    colleague's login stays out of a gated node's roster, never receives a
//!    slice, and is refused at the hello with close code 4004 — headlessly, on
//!    one machine, with no second device and no human in the loop.
//!
//! WHY IT LIVES HERE AND NOT ONLY UPSTREAM. truffle has its own real-tailnet
//! row for RFC 025 §5. This one runs in VibeField's tree, against the truffle
//! this repo PINS, through the same `NodeBuilder` the floor calls — so it
//! answers "does the gate work for us, at our pin" rather than "does the gate
//! work". While the petition window is open those are different questions. Row
//! 2 is more than a re-ask: upstream's §5 row cannot construct it at all (one
//! key yields one login), and upstream's own 4004 rows are loopback fixtures
//! driving a MOCK bridge identity. Here the refused login is carried by a real
//! tailnet's own WhoIs, about a real second person.
//!
//! `#[ignore]`d and gated on the keys, for the reasons in `common/mod.rs`. Run
//! them deliberately. The keys come from the SHELL — nothing here reads a
//! `.env` outside this checkout, and no secret is ever copied between trees:
//!
//! ```sh
//! set -a; . ./.env; set +a
//! cargo test -p field-native --test mesh_login_gate_probe -- --ignored --nocapture
//! ```
//!
//! THE SECOND KEY (`TRUFFLE_TEST_AUTHKEY_GUEST`) is what row 2 needs and what
//! no machine has by default. It must be:
//!
//! - generated while signed in AS THE SECOND USER of the same tailnet — a key
//!   names its minter, and that is the entire mechanism by which a foreign
//!   login reaches this tailnet from one machine;
//! - a HUMAN login, therefore **untagged**: a tagged key registers its node
//!   under Tailscale's `tagged-devices` pseudo-user (RFC 025 §3.3), which owns
//!   no login at all — it would exercise the gate's "caller has no login" row
//!   instead of its "caller is someone else" row, and fieldd's own capture
//!   refuses such a node outright (`packages/fieldd/src/link-service.ts`,
//!   `login_unavailable`);
//! - ephemeral and reusable, like the account's own key.
//!
//! Row 2 asserts every one of those before it measures anything: a key minted
//! by the same user, or by a tag, fails the row BY NAME rather than quietly
//! turning its absences into theatre.
//!
//! **Errata (2026-09-20, UA-P-4d).** The run line above used to carry
//! `FIELD_NATIVE_SIDECAR_PATH=target/debug/sidecar-slim`, with the note that
//! `common::sidecar()` prefers the VENDORED npm sidecar, which was pre-RFC-025
//! while the petition window was open, "and a gated node refuses to start
//! against it (correctly, loudly)". UA-P-X closed the npm half of that window
//! (`apps/desktop` installed 0.7.14's protocol-5 sidecar), and the truffle bump
//! moved the install to 0.7.19, whose sidecar speaks 8, so the vendored
//! preference resolves the RIGHT binary and the override is no longer needed.
//! The window stays open on the SwiftPM plane only (CLAUDE.md is the
//! authority). `Node` publishes no sidecar protocol version, so the protocol-5
//! assertion here is indirect: a gated node REFUSES TO START below 5, so
//! `build_gated_node` returning `Ok` IS the witness that it speaks at least 5,
//! the gate's floor, which is all a gated build can witness.
//!
//! The 0.7.19 pin brings its session rewrite (9eb8ddc), and with it two new
//! answers a dial can give:
//! - a dial that never completes reads "WS dial timed out after 45s"
//!   (SESSION_DIAL_TIMEOUT), which `dial_verdict` files as Inconclusive;
//! - an ungated hello now REFUSES (4003) a WhoIs that is empty, unparseable or
//!   has no nodeId, where 0.7.14 admitted it unverified. A real tailnet's WhoIs
//!   carries the nodeId, so neither row expects it, but a flaky WhoIs now reads
//!   as a refusal rather than an admission.

mod common;

use common::{
    authkey, build_gated_node, build_node, guest_authkey, probe_app_id, redact, sidecar,
    try_build_node, AUTHKEY_ENV, GUEST_AUTHKEY_ENV,
};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use truffle_core::network::tailscale::TailscaleProvider;
use truffle_core::{Node, Peer, SyncedStore};

/// A glob no tailnet login can match. Not a typo'd address — `path.Match` has
/// no escape that would make this equal a real login, and a login cannot
/// contain `/`.
const IMPOSSIBLE: &str = "nobody-at-all@invalid.example";

/// Tailscale's pseudo-user for a TAGGED node: it owns no human login at all
/// (RFC 025 §3.3). Named here so the guest row can refuse to run against one.
const TAGGED_DEVICES: &str = "tagged-devices";

const STORE: &str = "field.gate.probe.v1";

/// UA-P-4d's own store id. Separate from `STORE` so neither row can ever read
/// the other's slices and call it convergence.
const GUEST_STORE: &str = "field.gate.foreign.probe.v1";

/// The namespace UA-P-4d's dials carry. The BYTES are irrelevant: the dial is
/// the experiment, and it is decided inside `send_bytes` — at the hello —
/// before any payload moves.
const DIAL_NS: &str = "field.gate.probe.dial";

/// Both rows stand three ephemeral tailnet nodes each, and the test harness
/// runs them in PARALLEL by default. Six sidecars, six tsnet stacks and four
/// discovery measurements on one machine would make every window in both rows
/// a statement about load rather than about the gate. They take turns.
static ONE_AT_A_TIME: Mutex<()> = Mutex::const_new(());

async fn peer_hostnames(node: &Arc<Node<TailscaleProvider>>) -> Vec<String> {
    node.peers().await.into_iter().map(|p| p.hostname).collect()
}

/// Wait until `from` sees `host`, answering with how long it took. Returns
/// `None` on timeout rather than panicking: one call here is a CONTROL whose
/// duration the later settle window is derived from, and another is a row that
/// must NOT succeed — the caller decides which a timeout means.
async fn wait_for_peer(
    from: &Arc<Node<TailscaleProvider>>,
    host: &str,
    limit: Duration,
) -> Option<Duration> {
    let started = Instant::now();
    loop {
        if peer_hostnames(from).await.iter().any(|h| h == host) {
            return Some(started.elapsed());
        }
        if started.elapsed() > limit {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// The peer row `from` holds for `host`, if it holds one.
async fn peer_of(from: &Node<TailscaleProvider>, host: &str) -> Option<Peer> {
    from.peers().await.into_iter().find(|p| p.hostname == host)
}

/// Wait for Layer 3 to name this node's OWN owner and answer with it.
///
/// RFC 025 §3.3 puts the node's own `loginName` on the status event at sidecar
/// protocol 5, so this is read from the tailnet rather than configured — which
/// is what makes it the live T4 witness. A node that never learns it is talking
/// to a sidecar below 5, and nothing measured afterwards would mean anything.
async fn await_login(node: &Node<TailscaleProvider>, whose: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if let Some(l) = node
            .local_info()
            .login_name
            .clone()
            .filter(|l| !l.is_empty())
        {
            return l;
        }
        assert!(
            Instant::now() < deadline,
            "{whose} never learned its own login — is this sidecar protocol 5 or newer? \
             `common::sidecar()` prefers the vendored npm one, which is protocol 8 at the \
             0.7.19 pin, so check that FIELD_NATIVE_SIDECAR_PATH is not pointing at an older \
             build (an explicit override outranks the vendored pin)"
        );
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// Name a node in a log by the trailing segment of its hostname.
///
/// A truffle hostname is `truffle-{app_id}-{slug(device_name)}`, so the tail is
/// the device name THIS run chose — it identifies the node in a log without
/// printing a string the tailnet owns. Anything that does not look like one of
/// ours is redacted instead: a hostname that did not come from this run is not
/// ours to print.
fn role(host: &str) -> String {
    match host.rsplit_once('-') {
        Some((_, slug)) if !slug.is_empty() && host.starts_with("truffle-") => slug.to_string(),
        _ => redact(host),
    }
}

/// Does this store hold a slice whose `from` marker is `who`? `all()` includes
/// the node's OWN slice, so slices are asked for by marker rather than counted.
async fn holds(store: &SyncedStore<Value>, who: &str) -> bool {
    store.all().await.values().any(|s| s.data["from"] == who)
}

/// Wait for `holds`, answering with how long it took, or `None` at `limit`.
/// Like `wait_for_peer`, a timeout is returned rather than panicked: one caller
/// is a control that must converge and another is a row that must not.
async fn wait_for_slice(
    store: &SyncedStore<Value>,
    who: &str,
    limit: Duration,
) -> Option<Duration> {
    let started = Instant::now();
    loop {
        if holds(store, who).await {
            return Some(started.elapsed());
        }
        if started.elapsed() > limit {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// What a dial found out at the far end's hello.
enum Verdict {
    /// The hello completed and the session plane is open.
    Admitted,
    /// The remote closed with an application code before its hello — RFC 025
    /// §4: 4001 not my app, 4002 hello protocol, 4003 identity, 4004 login.
    Refused { code: u16, reason: String },
    /// Nothing conclusive inside the limit. Carries the last error so a
    /// timeout names what it kept hitting instead of saying only "timed out".
    Inconclusive(String),
}

impl std::fmt::Display for Verdict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Verdict::Admitted => write!(f, "admitted"),
            Verdict::Refused { code, reason } => write!(f, "refused, close code {code} ({reason})"),
            Verdict::Inconclusive(e) => write!(f, "inconclusive, last error: {e}"),
        }
    }
}

/// Dial `peer_id` over the SESSION plane — the one RFC 025 §3.4's hello gate
/// guards — and answer with the first outcome that is actually about the hello.
///
/// WHY A LOOP AND NOT ONE CALL. Every node here runs with RFC 022's eager
/// identity, which is the product default: the dialling node is ALREADY
/// dialling this peer in the background. A refused dial arms truffle's own
/// per-peer reconnect backoff, which doubles to a 30 s cap, and a second dial
/// inside that window is refused by the BACKOFF without a packet leaving the
/// machine. A single `send_bytes` would therefore often report truffle's rate
/// limiter and let a reader call it a gate. This waits the window out. Every
/// error that is not a close code is retried, so the only things that end it
/// early are an admission and a refusal the remote actually sent.
///
/// *Corrected 2026-10-20 (the 0.7.19 probe run):* waiting the window out at a
/// fixed 250 ms poll was not enough, and the row read Inconclusive on "reconnect
/// backoff" for its whole limit. The eager identity loop re-dials the instant
/// each window opens (truffle-core 0.7.19 `session/mod.rs`: after a failed dial
/// it sleeps exactly the backoff's `retry_after`), and a refused hello between
/// two nodes on one machine is over in milliseconds, so every poll landed inside
/// a window. The refusal is not hidden from the dialer: a call that starts the
/// dial, or joins the one in flight (`ensure_ws_connected` answers from an
/// in-flight dial before it consults the backoff), gets that dial's own outcome,
/// the transport's "close code 4004" prose. So on a backoff this sleeps to
/// [`WINDOW_EDGE`] before the window opens and then calls without pausing
/// across the opening, which either starts the dial or joins the eager loop's.
async fn dial_verdict(from: &Node<TailscaleProvider>, peer_id: &str, limit: Duration) -> Verdict {
    let started = Instant::now();
    loop {
        let last = match attempt(from, peer_id).await {
            Ok(verdict) => return verdict,
            Err(text) => text,
        };
        if started.elapsed() > limit {
            return Verdict::Inconclusive(last);
        }
        let Some(left) = backoff_left(&last) else {
            tokio::time::sleep(Duration::from_millis(250)).await;
            continue;
        };
        tokio::time::sleep(left.saturating_sub(WINDOW_EDGE)).await;
        let across = Instant::now() + 2 * WINDOW_EDGE;
        while Instant::now() < across {
            match attempt(from, peer_id).await {
                Ok(verdict) => return verdict,
                Err(text) if backoff_left(&text).is_some() => tokio::task::yield_now().await,
                // a dial ran and failed some other way: back to the loop's pace
                Err(_) => break,
            }
        }
    }
}

/// How far before a backoff window opens [`dial_verdict`] wakes, and half how
/// long it keeps calling across the opening.
const WINDOW_EDGE: Duration = Duration::from_millis(50);

/// One dial: `Ok` with a verdict about the hello (an admission, or a close code
/// the remote sent), `Err` with the error's text when it was about neither.
async fn attempt(from: &Node<TailscaleProvider>, peer_id: &str) -> Result<Verdict, String> {
    match from.send_bytes(peer_id, DIAL_NS, b"vf-foreign-probe").await {
        Ok(()) => Ok(Verdict::Admitted),
        Err(e) => {
            let text = e.to_string();
            match close_code(&text) {
                Some((code, reason)) => Ok(Verdict::Refused { code, reason }),
                None => Err(text),
            }
        }
    }
}

/// The time left in truffle's per-peer reconnect backoff, read back from
/// `SessionError::ReconnectBackoff`'s text ("reconnect backoff: retry after
/// 20.751368625s", a `Duration` in its Debug form), or `None` when the text is
/// not a backoff. Like `close_code` it fails CLOSED: a form it cannot read is
/// `None`, and the caller keeps its plain pace.
fn backoff_left(text: &str) -> Option<Duration> {
    let token = text
        .split("reconnect backoff: retry after ")
        .nth(1)?
        .split_whitespace()
        .next()?;
    let split = token.find(|c: char| !(c.is_ascii_digit() || c == '.'))?;
    let (number, unit) = token.split_at(split);
    let value: f64 = number.parse().ok()?;
    let seconds = match unit {
        "s" => value,
        "ms" => value / 1e3,
        "µs" | "us" => value / 1e6,
        "ns" => value / 1e9,
        _ => return None,
    };
    Duration::try_from_secs_f64(seconds).ok()
}

/// Pull the close code out of the error text, or `None` when there is none.
///
/// RFC 025 §4 promises the DIALER a typed refusal, and truffle keeps that
/// promise where it is made: `TransportError::HelloRefused { code, reason }`,
/// at the transport boundary. It does not survive the trip out to `Node`.
/// `PeerRegistry::ensure_ws_connected` folds every transport failure into
/// `SessionError::ConnectFailed(String)` with `e.to_string()`, so the surface a
/// consumer of `truffle_core::Node` sees is prose: "connect failed: hello
/// refused by remote: close code 4004 (login refused)". Reading the code back
/// out of it is the only way to assert it from outside the crate at this pin —
/// see the FINDING in the row below. The parse fails CLOSED: no "close code" in
/// the text yields no verdict, never a default one.
fn close_code(text: &str) -> Option<(u16, String)> {
    let rest = text.split("close code ").nth(1)?;
    let code = rest
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .ok()?;
    let reason = rest
        .split_once('(')
        .and_then(|(_, r)| r.split_once(')'))
        .map(|(r, _)| r.to_string())
        .unwrap_or_default();
    Some((code, reason))
}

/// The two readers of truffle's error prose, on the forms 0.7.19 prints: no
/// network, so this row runs with the suite.
#[test]
fn the_error_prose_readers_take_truffles_own_forms_and_fail_closed() {
    let backoff = "session error: reconnect backoff: retry after 20.751368625s";
    let left = backoff_left(backoff).expect("a backoff");
    assert!(left.as_nanos().abs_diff(20_751_368_625) <= 1, "{left:?}");
    assert_eq!(
        backoff_left("reconnect backoff: retry after 250ms"),
        Some(Duration::from_millis(250))
    );
    let left = backoff_left("reconnect backoff: retry after 999.5µs").expect("a backoff");
    assert!(left.as_nanos().abs_diff(999_500) <= 1, "{left:?}");
    assert_eq!(
        backoff_left("connect failed: WS dial timed out after 45s"),
        None
    );
    assert_eq!(backoff_left("reconnect backoff: retry after soon"), None);
    assert_eq!(close_code(backoff), None);

    let refused =
        "session error: connect failed: hello refused by remote: close code 4004 (login refused)";
    assert_eq!(
        close_code(refused),
        Some((4004, "login refused".to_string()))
    );
    assert_eq!(backoff_left(refused), None);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "real tailnet: needs TRUFFLE_TEST_AUTHKEY; run with --ignored"]
async fn a_gated_node_sees_its_own_login_and_a_walled_one_sees_nobody() {
    let Some(key) = authkey() else {
        eprintln!("[skip] mesh_login_gate_probe: {AUTHKEY_ENV} not set");
        return;
    };
    let Some(sidecar_path) = sidecar() else {
        eprintln!("[skip] mesh_login_gate_probe: no truffle sidecar found");
        return;
    };
    // One row at a time on this machine — see `ONE_AT_A_TIME`. Taken after the
    // skips so a machine with no key does not queue behind a live run.
    let _turn = ONE_AT_A_TIME.lock().await;
    let app_id = probe_app_id();
    eprintln!(
        "[gate] app_id={app_id} sidecar={} authkey={}",
        sidecar_path.display(),
        redact(&key)
    );

    let open_state = tempfile::TempDir::with_prefix("vf-gate-open-").unwrap();
    let gated_state = tempfile::TempDir::with_prefix("vf-gate-gated-").unwrap();
    let walled_state = tempfile::TempDir::with_prefix("vf-gate-walled-").unwrap();

    // 1. THE CONTROL, and it must come first: an UNGATED node. Everything below
    //    is an absence or a presence measured against what this node can do, so
    //    if discovery is broken for this app_id the whole probe has to say so
    //    here rather than report a gate that "worked".
    let open = Arc::new(build_node(&app_id, "open", open_state.path(), &key, &sidecar_path).await);
    let open_host = open.local_info().tailscale_hostname.clone();

    // 2. THE LIVE LOGIN. RFC 025 §3.3 puts the node's own owner on the status
    //    event at protocol 5, so this is read from the tailnet rather than
    //    configured — which also makes it the T4 witness: if `login_name` is
    //    absent here the sidecar is pre-protocol-5 and nothing below is valid.
    let login = await_login(&open, "the ungated node").await;
    eprintln!(
        "[gate] this tailnet's login is present (len {})",
        login.len()
    );

    // 3. The gated pair. A build failure here is the protocol-5 refusal far more
    //    often than anything else, so it says so.
    let gated = Arc::new(
        build_gated_node(
            &app_id,
            "gated",
            gated_state.path(),
            &key,
            &sidecar_path,
            std::slice::from_ref(&login),
        )
        .await
        .unwrap_or_else(|e| {
            panic!("the gated node did not start ({e}) — a sidecar below protocol 5 refuses")
        }),
    );
    let gated_host = gated.local_info().tailscale_hostname.clone();
    let walled = Arc::new(
        build_gated_node(
            &app_id,
            "walled",
            walled_state.path(),
            &key,
            &sidecar_path,
            &[IMPOSSIBLE.to_string()],
        )
        .await
        .expect("the walled node builds — a gate that matches nobody is still a valid gate"),
    );
    eprintln!("[gate] nodes up: open={open_host} gated={gated_host} walled=(gated on IMPOSSIBLE)");

    // 4. THE CONTROL MEASUREMENT: the ungated node discovers the gated one.
    //    Its duration is the unit the walled node's settle window is expressed
    //    in — a fixed sleep would be a guess about this tailnet's latency.
    let discovery = wait_for_peer(&open, &gated_host, Duration::from_secs(120))
        .await
        .expect(
            "the CONTROL failed: an ungated node never discovered the gated one, \
                 so nothing below is a statement about the gate",
        );
    eprintln!("[gate] control: ungated discovery took {discovery:?}");

    // 5. THE GATE ADMITS THIS ACCOUNT. The gated node's allow-list is this
    //    tailnet's own login, and every node here is under it.
    assert!(
        wait_for_peer(&gated, &open_host, Duration::from_secs(120))
            .await
            .is_some(),
        "a node gated on its OWN login must still see this account's nodes"
    );
    eprintln!("[gate] gated node sees the account's own peer");

    // 6. THE STORE CONVERGES ACROSS THE GATE. This is the whole point of
    //    UA-P-4 for VibeField: the bus may carry content again because its
    //    audience is the account. A gate that admitted the peer but broke the
    //    session plane would pass step 5 and fail the product.
    let open_store = open.synced_store::<Value>(STORE);
    let gated_store = gated.synced_store::<Value>(STORE);
    open_store.set(json!({ "from": "open", "v": 1 })).await;
    let converged = {
        let deadline = Instant::now() + discovery * 4 + Duration::from_secs(30);
        loop {
            let all = gated_store.all().await;
            if all.values().any(|slice| slice.data["from"] == "open") {
                break true;
            }
            if Instant::now() > deadline {
                break false;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    };
    assert!(
        converged,
        "the store did not converge between two nodes the gate admits"
    );
    eprintln!("[gate] store converged across the gate");

    // 7. THE WALLED NODE SEES NOBODY, and the window is derived rather than
    //    guessed: four times the measured control, with a floor so a very fast
    //    tailnet does not produce a meaninglessly short one. A walled node that
    //    is merely SLOW would show up inside this; one the gate refused never
    //    will.
    let settle = (discovery * 4).max(Duration::from_secs(30));
    eprintln!("[gate] settling {settle:?} before reading the walled node");
    tokio::time::sleep(settle).await;
    let seen = peer_hostnames(&walled).await;

    // THE SIMULTANEOUS CONTROL, read in the same beat: the ungated node sees
    // BOTH of the others right now. Without this, "the walled node saw nothing"
    // could equally mean the netmap had not propagated, or that this app_id's
    // namespace was empty, or that the run was simply too early — and the
    // measured discovery above cannot rule that out, because on a warm tailnet
    // it comes back in microseconds and measures nothing at all. Two readings
    // of the same instant, disagreeing, is the evidence.
    let open_sees = peer_hostnames(&open).await;
    assert!(
        open_sees.contains(&gated_host) && open_sees.len() >= 2,
        "the CONTROL failed at read time: the ungated node should see both others, saw {open_sees:?}"
    );

    assert!(
        seen.is_empty(),
        "a node gated on a glob that matches no login must hold at zero peers, saw {seen:?} \
         while the ungated node saw {open_sees:?}"
    );

    // …and the walled node is really ON the tailnet rather than never joined:
    // it has an identity and the tailnet named its owner. It simply admits
    // no one.
    assert!(
        !walled.local_info().tailscale_id.is_empty(),
        "the walled node is really on the tailnet"
    );
    assert!(
        walled.local_info().login_name.is_some(),
        "the walled node's own login is known — it is gated, not blind"
    );
    eprintln!(
        "[gate] walled node is live and holds 0 peers while the ungated node holds {} — \
         the gate refused, not the network",
        open_sees.len()
    );
}

/// UA-P-4d — A FOREIGN LOGIN AT THE GATE, on the real tailnet, headless.
///
/// The row above stands three nodes on ONE key, so all three carry the same
/// login and the only refusal it can show is a gate that matches nobody. This
/// one adds the thing one key cannot buy: a node on a SECOND USER's key, whose
/// login is genuinely somebody else's. Three questions, each with its control:
///
/// - ROSTER (RFC 025 §3.3): the gated node never lists the guest, while the
///   ungated twin lists it in the same beat, and the gated node still lists the
///   twin — so the gate is "not you", never "nobody" and never "the network was
///   slow".
/// - SLICE (§3.3 + §3.5): the guest's slice never reaches the gated node and
///   the gated node's slice never reaches the guest, while both converge with
///   the ungated twin. §3.3 is why there is no session to carry either one;
///   §3.5 is why a RELAY could not smuggle one through the twin that talks to
///   both — a slice is honoured only under its sender's own published device
///   id, so a forwarded slice is dropped rather than applied. (At this pin the
///   store never forwards another device's slice at all: `handle_peer_joined`
///   and the `Request` reply both send `inner.local` and nothing else. §3.5 is
///   the rule that would hold if it ever did.)
/// - HELLO (§3.4): the guest's dial into the gated node is refused with close
///   code 4004, after two positive controls — the account's own node is
///   admitted by that same gated listener, and the guest is admitted by an
///   ungated one. Both controls are asserted BEFORE the refusal, so the row
///   cannot pass because nothing could connect at all.
///
/// WHAT IT DOES NOT CLAIM. The guest's node is ungated, so it SEES the gated
/// node in its own roster — §3.3 gates what a node admits, not what it is
/// visible to, and a tailnet device is visible to its tailnet. The absence
/// asserted here is always the GATED node's, plus what the guest never
/// receives.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "real tailnet, TWO accounts: needs TRUFFLE_TEST_AUTHKEY + TRUFFLE_TEST_AUTHKEY_GUEST; run with --ignored"]
async fn a_foreign_login_is_refused_at_the_gate_and_never_enters_it() {
    let Some(key) = authkey() else {
        eprintln!("[skip] mesh_login_gate_probe (foreign login): {AUTHKEY_ENV} not set");
        return;
    };
    let Some(guest_key) = guest_authkey() else {
        eprintln!(
            "[skip] mesh_login_gate_probe (foreign login): {GUEST_AUTHKEY_ENV} not set — \
             this row needs a SECOND tailnet user's auth key: ephemeral, reusable, UNTAGGED, \
             minted while signed in AS that user. Without it there is no foreign login on \
             this tailnet, so the refusal cannot be constructed and the row asserts nothing. \
             See this file's header for how to make one."
        );
        return;
    };
    let Some(sidecar_path) = sidecar() else {
        eprintln!("[skip] mesh_login_gate_probe (foreign login): no truffle sidecar found");
        return;
    };
    // One row at a time on this machine — see `ONE_AT_A_TIME`.
    let _turn = ONE_AT_A_TIME.lock().await;
    let app_id = probe_app_id();
    eprintln!(
        "[foreign] app_id={app_id} sidecar={} account_key={} guest_key={}",
        sidecar_path.display(),
        redact(&key),
        redact(&guest_key)
    );

    let open_state = tempfile::TempDir::with_prefix("vf-foreign-open-").unwrap();
    let gated_state = tempfile::TempDir::with_prefix("vf-foreign-gated-").unwrap();
    let guest_state = tempfile::TempDir::with_prefix("vf-foreign-guest-").unwrap();

    // 1. THE ACCOUNT'S UNGATED CONTROL, first and for the same reason as the
    //    row above: every absence below is measured against what this node can
    //    do, so a broken app_id namespace has to be visible here rather than
    //    downstream as a gate that "worked".
    let open = Arc::new(build_node(&app_id, "open", open_state.path(), &key, &sidecar_path).await);
    let open_host = open.local_info().tailscale_hostname.clone();
    let open_id = open.local_info().tailscale_id.clone();
    let account_login = await_login(&open, "the account's ungated node").await;

    // 2. THE GATED NODE, on the account's REAL login, read live from Layer 3
    //    rather than configured. Its `Ok` is also this run's protocol-5
    //    assertion: below 5 a gated node refuses to start (see the header).
    let gated = Arc::new(
        build_gated_node(
            &app_id,
            "gated",
            gated_state.path(),
            &key,
            &sidecar_path,
            std::slice::from_ref(&account_login),
        )
        .await
        .unwrap_or_else(|e| {
            panic!("the gated node did not start ({e}) — a sidecar below protocol 5 refuses")
        }),
    );
    let gated_host = gated.local_info().tailscale_hostname.clone();
    let gated_id = gated.local_info().tailscale_id.clone();

    // 3. THE GUEST: the second user's key, and UNGATED — the guest is not the
    //    one doing the gating. Nothing about this node is hostile or unusual.
    //    It is an ordinary truffle node that happens to belong to somebody
    //    else, which is exactly the shape of what UA-P-4 exists to answer.
    let guest = Arc::new(
        try_build_node(
            &app_id,
            "guest",
            guest_state.path(),
            &guest_key,
            &sidecar_path,
        )
        .await
        .unwrap_or_else(|e| {
            panic!(
                "the guest node did not start ({e}) — check {GUEST_AUTHKEY_ENV}: it must be a \
                 CURRENT, REUSABLE, EPHEMERAL key of the SECOND user on THIS tailnet"
            )
        }),
    );
    let guest_host = guest.local_info().tailscale_hostname.clone();
    let guest_login = await_login(&guest, "the guest node").await;

    // 4. THE PRECONDITION, pinned before a single measurement — and it is the
    //    whole row. Every absence below is a claim about a FOREIGN login. If
    //    the guest key was minted by THIS user, the gate would admit it and the
    //    row would fail confusingly; if it was minted by a TAG, the gate would
    //    refuse it for the other reason in RFC 025 §3.4's table (a caller with
    //    no login at all) and the row would pass while proving something
    //    weaker than it says. Neither may be discovered from an absence later.
    //
    //    Neither login is printed: the verdict is what matters, and a login is
    //    a person's name on someone else's account.
    assert!(
        !guest_login.eq_ignore_ascii_case(&account_login),
        "the guest key carries THIS account's own login (same string, {} chars), so nothing \
         below would be a statement about a foreign login. Mint {GUEST_AUTHKEY_ENV} while \
         signed in as the SECOND user of the tailnet.",
        guest_login.len()
    );
    assert!(
        !guest_login.eq_ignore_ascii_case(TAGGED_DEVICES),
        "the guest key is TAGGED: the tailnet reports its node's owner as the \
         `{TAGGED_DEVICES}` pseudo-user (RFC 025 §3.3), which owns no human login. A gated \
         node refuses such a caller for a DIFFERENT reason than a foreign login (§3.4's \
         'loginName absent' row), and fieldd's own capture refuses it too \
         (`packages/fieldd/src/link-service.ts`, login_unavailable). Mint an UNTAGGED key."
    );
    eprintln!(
        "[foreign] nodes up: {} + {} on this account, {} on a SECOND login — two distinct \
         human logins, neither of them `{TAGGED_DEVICES}`",
        role(&open_host),
        role(&gated_host),
        role(&guest_host)
    );

    // 5. THE DISCOVERY CONTROLS, measured before any absence is read. The
    //    guest's is the unit the settle window below is expressed in: a fixed
    //    sleep would be a guess about this tailnet's latency, and a guess is
    //    how an absence turns into "we did not wait long enough".
    let guest_discovery = wait_for_peer(&open, &guest_host, Duration::from_secs(120))
        .await
        .expect(
            "the CONTROL failed: the ungated node never discovered the GUEST's node, so no \
             absence below is a statement about the gate. A tailnet ACL that separates the \
             two users looks exactly like this, and so does a guest key for another tailnet",
        );
    let twin_discovery = wait_for_peer(&open, &gated_host, Duration::from_secs(120))
        .await
        .expect("the CONTROL failed: the ungated node never discovered the account's own twin");
    eprintln!(
        "[foreign] control: the ungated node found the guest in {guest_discovery:?} and its \
         own gated twin in {twin_discovery:?}"
    );

    // 6. THE GUEST'S OWN VIEW (RFC 025 §3.3). The guest is ungated, so the
    //    gated node is an ordinary peer TO IT: the gate is admission, not
    //    invisibility, and a row that expected blindness here would be
    //    asserting something the RFC never promised.
    assert!(
        wait_for_peer(&guest, &open_host, Duration::from_secs(120))
            .await
            .is_some(),
        "the guest must see the account's UNGATED node — without this the refusals below \
         could be the tailnet rather than the gate"
    );
    assert!(
        wait_for_peer(&guest, &gated_host, Duration::from_secs(120))
            .await
            .is_some(),
        "the guest must SEE the gated node: §3.3 gates what a node ADMITS, not what it is \
         visible to. If this ever fails, the claim to check is not the gate but discovery"
    );
    let as_the_guest_sees_it = peer_of(&guest, &gated_host)
        .await
        .expect("just waited for this peer");
    // What §3.3 PROMISES about that row's login, which is not the same as
    // whatever comes back first: a peer's login is its OWNER's, taken from the
    // netmap's user map (`Status.User[peer.UserID].LoginName`), and the field
    // is OMITTED when the tailnet names no user — absent, never fabricated
    // (RFC 022's honesty rule). So: this account's login, or nothing at all.
    match as_the_guest_sees_it.login_name.as_deref() {
        Some(owner) => assert!(
            owner.eq_ignore_ascii_case(&account_login),
            "RFC 025 §3.3: a peer's login is its OWNER's — the guest's Layer 3 named a THIRD \
             login ({} chars) for a node this account owns",
            owner.len()
        ),
        None => eprintln!(
            "[foreign] the guest's Layer 3 names no owner for the gated node — §3.3 permits \
             absent (an unknown user omits the field) and forbids inventing one"
        ),
    }

    // 7. THE HELLO (RFC 025 §3.4), and the two controls come FIRST. A refusal
    //    is only evidence about the gate if admissions are happening on either
    //    side of it in the same run.
    let hello_limit = Duration::from_secs(150);

    // 7a. CONTROL: the account's own node is ADMITTED by the gated listener.
    match dial_verdict(&open, &gated_id, hello_limit).await {
        Verdict::Admitted => eprintln!("[foreign] control: the allowed login completed the hello"),
        other => panic!(
            "the CONTROL failed: a node on the ALLOWED login was not admitted by the gated \
             node's hello ({other}) — a refusal below would not be about the guest"
        ),
    }
    // 7b. CONTROL: the guest is ADMITTED by an UNGATED listener. This is what
    //     separates "the gate refused it" from "this node cannot dial anyone":
    //     the same guest, the same session plane, a listener without a gate.
    match dial_verdict(&guest, &open_id, hello_limit).await {
        Verdict::Admitted => {
            eprintln!("[foreign] control: the guest completed the hello with an UNGATED node")
        }
        other => panic!(
            "the CONTROL failed: the guest was not admitted by an ungated node ({other}) — \
             the refusal below would then be about the guest, not about the gate"
        ),
    }
    // 7c. THE ROW: the guest's dial into the GATED node is refused, 4004.
    //
    //     FINDING (2026-09-20, this pin). RFC 025 §4 promises the dialer a
    //     TYPED refusal, and truffle delivers one where the promise is made:
    //     `TransportError::HelloRefused { code, reason }`. It does not reach
    //     `Node`'s public surface — the session layer folds every transport
    //     failure into `SessionError::ConnectFailed(String)` — so a consumer
    //     that wants to tell "not my app" from "not my login" has to read
    //     prose. `close_code` does exactly that, and says so.
    match dial_verdict(&guest, &gated_id, hello_limit).await {
        Verdict::Refused { code, reason } => {
            assert_eq!(
                code, 4004,
                "the gated node refused the foreign login with the wrong code — RFC 025 §4 \
                 reserves 4004 for 'login refused' (4001 app, 4002 hello, 4003 identity), \
                 and the reason it sent was {reason:?}"
            );
            eprintln!("[foreign] THE ROW: the gated node refused the guest — 4004 ({reason})");
        }
        Verdict::Admitted => panic!(
            "THE GATE LEAKED: a node gated on this account's login completed a hello with a \
             SECOND user's node. This is the failure UA-P-4 exists to detect"
        ),
        Verdict::Inconclusive(e) => panic!(
            "the guest's dial into the gated node never reached a verdict within \
             {hello_limit:?}; last error: {e}"
        ),
    }

    // 8. THE SLICE. Three writers, one store id, and the controls are written
    //    in the same beat as the rows so nothing below can be explained by a
    //    store plane that was simply not working.
    let open_store = open.synced_store::<Value>(GUEST_STORE);
    let gated_store = gated.synced_store::<Value>(GUEST_STORE);
    let guest_store = guest.synced_store::<Value>(GUEST_STORE);
    // Each store subscribes to its namespace inside the task `synced_store`
    // spawns, not before returning, so a slice broadcast in the same breath as
    // the last store was created could arrive at a receiver that is not
    // listening yet — and a lost broadcast is never retried. All three are
    // created first and given a beat to reach their first poll, so an absence
    // below is the gate rather than a startup race.
    tokio::time::sleep(Duration::from_millis(500)).await;
    open_store.set(json!({ "from": "open", "v": 1 })).await;
    gated_store.set(json!({ "from": "gated", "v": 1 })).await;
    guest_store.set(json!({ "from": "guest", "v": 1 })).await;

    let converge = (guest_discovery * 4).max(Duration::from_secs(30));
    // 8a. CONTROL: the guest's slice reaches the ungated node…
    let to_open = wait_for_slice(&open_store, "guest", converge).await.expect(
        "the CONTROL failed: the guest's slice never reached the UNGATED node, so its \
             absence from the gated one below would say nothing about the gate",
    );
    // 8b. CONTROL: …and the ungated node's slice reaches the guest. Without
    //     this direction, "the gated node's slice never reached the guest"
    //     could just mean the guest's store never receives anything at all.
    let to_guest = wait_for_slice(&guest_store, "open", converge).await.expect(
        "the CONTROL failed: an ungated node's slice never reached the GUEST, so the \
             guest's empty read below would be about its store, not about the gate",
    );
    // 8c. CONTROL: the gated node's own slices do travel — to its own account.
    let to_twin = wait_for_slice(&open_store, "gated", converge)
        .await
        .expect("the CONTROL failed: the gated node's slice never reached its own account");
    eprintln!(
        "[foreign] control: slices converged guest->open in {to_open:?}, open->guest in \
         {to_guest:?}, gated->open in {to_twin:?}"
    );

    // 9. THE SETTLE WINDOW, derived from the control rather than guessed:
    //    four times the measured discovery, with a floor so a very fast tailnet
    //    cannot produce a meaninglessly short one. A guest that is merely SLOW
    //    would appear inside this; one the gate refused never will.
    let settle = (guest_discovery * 4).max(Duration::from_secs(30));
    eprintln!("[foreign] settling {settle:?} before reading the gated node");
    tokio::time::sleep(settle).await;

    // THE SIMULTANEOUS READS. Every absence below is read in the same beat as
    // the presence that makes it mean something — two readings of one instant,
    // disagreeing, is the evidence. A measured discovery alone cannot do this:
    // on a warm tailnet it comes back in microseconds and measures nothing.
    let open_sees = peer_hostnames(&open).await;
    let gated_sees = peer_hostnames(&gated).await;
    let guest_sees = peer_hostnames(&guest).await;

    assert!(
        open_sees.contains(&guest_host),
        "the CONTROL failed at read time: the ungated node should still hold the guest, held \
         {:?}",
        open_sees.iter().map(|h| role(h)).collect::<Vec<_>>()
    );
    assert!(
        gated_sees.contains(&open_host),
        "the gate is 'not you', not 'nobody': a node gated on this account's login must still \
         hold this account's other node, held {:?}",
        gated_sees.iter().map(|h| role(h)).collect::<Vec<_>>()
    );
    assert!(
        !gated_sees.contains(&guest_host),
        "THE GATE LEAKED (RFC 025 §3.3): the gated node listed a SECOND user's node, holding \
         {:?} while the ungated twin held {:?}",
        gated_sees.iter().map(|h| role(h)).collect::<Vec<_>>(),
        open_sees.iter().map(|h| role(h)).collect::<Vec<_>>()
    );
    assert!(
        guest_sees.contains(&open_host),
        "the CONTROL failed at read time: the guest should still hold the ungated node"
    );
    eprintln!(
        "[foreign] rosters in one beat: gated holds {} peers and none of them is the guest, \
         while the ungated twin holds {} and the guest holds {}",
        gated_sees.len(),
        open_sees.len(),
        guest_sees.len()
    );

    // …and the gated node is really ON the tailnet rather than never joined.
    assert!(
        !gated.local_info().tailscale_id.is_empty(),
        "the gated node is really on the tailnet"
    );

    // 10. THE SLICES, in the same beat. RFC 025 §3.3 is why there is no session
    //     to carry either one; §3.5 is why the ungated node, which talks to
    //     both, cannot relay one across — a slice is honoured only under its
    //     SENDER's published device id.
    assert!(
        !holds(&gated_store, "guest").await,
        "THE GATE LEAKED (RFC 025 §3.3 + §3.5): the guest's slice reached a node gated on \
         another login"
    );
    assert!(
        !holds(&guest_store, "gated").await,
        "THE GATE LEAKED (RFC 025 §3.3 + §3.5): the gated node's slice reached a SECOND \
         user's node"
    );
    assert!(
        holds(&open_store, "guest").await && holds(&open_store, "gated").await,
        "the CONTROL failed at read time: the ungated node should still hold both slices"
    );
    eprintln!(
        "[foreign] slices in one beat: the ungated node holds the guest's AND the gated \
         node's; the gated node holds no guest slice; the guest holds no gated slice"
    );
}
