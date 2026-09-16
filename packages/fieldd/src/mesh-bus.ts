/**
 * UA-P-0e (D2) — THE ONE SWITCH, and it is OFF.
 *
 * Dated 2026-09-15. James ruled the store audience:
 *
 *   "This account's tailnet has many other users with their own tailscale
 *    accounts; the VibeField ecosystem linked with this account interacts only
 *    with the nodes under this user's tailscale account. The store should be
 *    scoped to the login user identity."
 *
 * The synced-store bus cannot do that. truffle-core broadcasts a store to every
 * tailnet node whose hostname starts with `truffle-vibefield-` — no WhoIs, no
 * login check on the store's own path — and it applies an inbound slice under
 * the key the PAYLOAD names rather than the sender's own durable id (TF-2). So
 * the audience of `field.devices.v1`, `field.agents.v1` and `field.artifacts.v1`
 * was the APP's tailnet peers, which on a shared tailnet is other people. What
 * went out: hostnames, versions, the product capability URL WITH its route
 * secret, every agent's label, project, branch, model, effort and blocker tool,
 * and every artifact's title and URL.
 *
 * Until truffle can gate a store by login, the interim is the only honest one:
 * NOTHING CONTENT-BEARING RIDES THE BUS. fieldd publishes no slice into those
 * three stores and consumes none.
 *
 * WHAT REPLACES IT, and why nothing is actually lost:
 *  - Discovery is the TAILNET's own peer registry, which fieldd already reads
 *    (`native.mesh.peers.list`) and which carries a per-peer WhoIs login from
 *    the control plane. A peer whose login is this account's is SELF; everyone
 *    else is not in the roster at all.
 *  - A door coordinate is DERIVED — the peer's authenticated MagicDNS name plus
 *    the registry's product serve port — instead of published. UA-P-0d moved
 *    the route secret to the sidecar's target path, so there is no secret left
 *    in a coordinate to protect.
 *  - The agent field rides `agent.subscribe {projection: "field"}` over the
 *    product door, which is where the phone already reads it from, and the door
 *    compares the caller's WhoIs login to the stored link before answering.
 *
 * WHY THIS IS A SWITCH AND NOT A DELETION. The publishers, the subscriptions
 * and the slice-fusing roster are correct code that solves a problem we will
 * have again: UA-P-4 brings the bus back SCOPED, once truffle applies a slice
 * under the sender's own id and admits a store only to nodes whose WhoIs login
 * matches. Deleting the paths would mean rebuilding them from a commit message.
 * Flipping this constant to `true` is what that slice will do, after the pin
 * bump — and every path behind it is still typechecked and still compiles today,
 * which a deleted one would not be.
 *
 * It is deliberately a CONSTANT and not a preference, an env var or a flag: an
 * account boundary that a user (or an agent holding `settings.manage`) can turn
 * off is not a boundary. The day it moves is a deliberate upgrade event with a
 * petition behind it.
 */
export const MESH_BUS_CARRIES_CONTENT = false;
