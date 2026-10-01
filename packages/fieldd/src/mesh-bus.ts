/**
 * UA-P-4 (D2) — THE ONE SWITCH, AND IT IS ON AGAIN, SCOPED.
 *
 * Dated 2026-09-16. James's ruling has not moved; what moved is truffle:
 *
 *   "This account's tailnet has many other users with their own tailscale
 *    accounts; the VibeField ecosystem linked with this account interacts only
 *    with the nodes under this user's tailscale account. The store should be
 *    scoped to the login user identity."
 *
 * UA-P-0e turned this constant OFF because the bus could not honour that
 * sentence. truffle-core broadcast a store to every tailnet node whose hostname
 * started with `truffle-vibefield-` — no WhoIs, no login check on the store's
 * own path — and applied an inbound slice under the key the PAYLOAD named
 * rather than the sender's own durable id (TF-2). The audience of
 * `field.devices.v1`, `field.agents.v1` and `field.artifacts.v1` was the APP's
 * tailnet peers, which on a shared tailnet is other people. What went out:
 * hostnames, versions, the product capability URL with its route secret, every
 * agent's label, project, branch, model, effort and blocker tool, and every
 * artifact's title and URL.
 *
 * *Corrected 2026-10-01 (DS-D14, DS wave 3): `field.agents.v1` is no longer
 * published by any daemon and no longer read by any phone — the mesh board
 * (`agent.subscribe {scope: "mesh"}`, DS-3) carries every self desktop's board
 * through one door and the phone homes to a desktop to read it (DS-8). The two
 * slices this constant still gates are `field.devices.v1` (presence) and
 * `field.artifacts.v1`, plus the holders slice (`field.docs.v1`, DS-5).*
 *
 * RFC 025 "login-scoped nodes" is the answer to that, and it is why this reads
 * `true` today. Three of its rulings carry the weight, and each closes one half
 * of what was wrong:
 *
 *  - §3.3 — THE LOGIN IS A LAYER 3 FACT and the node is gated on it. A linked
 *    desktop builds its node with `login_allow = [the account's login]`, so the
 *    provider reports as peers ONLY nodes whose owner's login matches, and a
 *    store cannot broadcast to a node that is not a peer. The gate is per NODE,
 *    not per store (§3.1), deliberately: a per-store list would leave the
 *    connection open to a foreign login for every other namespace.
 *  - §3.4 — THE HELLO REFUSES the other direction, before revealing our own
 *    identity block: a caller whose WhoIs login does not match is closed with
 *    4004, and a gated node stops failing open on a caller the bridge attached
 *    no identity to (4003). So a foreign node cannot reach the store by merely
 *    CLAIMING the app id either — the MEDIUM-1 half a hostname prefix never
 *    covered.
 *  - §3.5 — A SLICE IS APPLIED ONLY UNDER ITS SENDER'S AUTHENTICATED DEVICE ID,
 *    and `Clear` only for that id, on every node gated or not. That is TF-2
 *    fixed: a peer can no longer write another device's row or delete it.
 *
 * Together those make the bus what D2 asks for — a channel whose audience IS
 * the account — rather than a namespace that merely tends to be one.
 *
 * WHAT IS STILL OURS TO GET RIGHT, because a transport guarantee is not a
 * licence to stop thinking (EL7: the same-uid agent is the adversary, and a
 * peer is not more trusted than a caller at the door):
 *
 *  - NO SECRET RIDES A SLICE. D7 stands unchanged and is not softened by the
 *    gate: the published `productEndpoint.url` is a LOCATOR — scheme, host,
 *    port — and the route secret lives on the sidecar's target path, added on
 *    forward. `device-service.test.ts` greps the published slice BYTES for it,
 *    so the proof is of what went on the wire and not of what we meant.
 *  - THE REGISTRY IS THE AUTHORITY ON WHO EXISTS. A store slice may DESCRIBE a
 *    device the tailnet's own peer registry lists; it may never ADD one. That
 *    is defence in depth over §3.5 — one bug upstream should not be able to
 *    conjure a device into a roster — and it is why DeviceService fuses by
 *    `deviceId` against the self-peer set and drops anything else with a log.
 *
 * It is deliberately a CONSTANT and not a preference, an env var or a flag: an
 * account boundary that a user (or an agent holding `settings.manage`) can turn
 * off is not a boundary. This is the second time it has moved, and both moves
 * were deliberate upgrade events with a petition behind them — T5 to ask, RFC
 * 025 to answer, a pinned truffle to consume. The day it moves again will be
 * the same kind of day.
 *
 * THE CEILING, stated so no reader infers more than is true: the gate binds the
 * SESSION PLANE — the synced store, request/reply, file transfer, chat. RFC 025
 * §3.7 leaves the QUIC plane (its own ALPN app check), raw `listen` (the app
 * reads the accepted connection's identity) and served routes (their own
 * `allow`, RFC 023 §9.7) on their existing admission. Those surfaces are gated
 * by their own means here — the serve's login allow-list, the door's
 * stored-login comparison, doc-sync's self-peer filter (UA-P-0f) — and not by
 * this constant.
 */
export const MESH_BUS_CARRIES_CONTENT = true;
