import {
  PEER_FIELDD_SCOPES,
  type Principal,
  TAILNET_GUEST_SCOPES,
  TAILNET_SCOPES,
} from "@vibefield/contracts";

/**
 * Item 464 (2026-11-16) — the scopes a principal's call rides, as the product door grants them for its own scope
 * check (`product-api.ts`, the hello: `state.scopes`, the connection's grant).
 *
 * A handler that must ask a SECOND scope beside its door's reads this, never `principal.scopes` alone: a token's
 * principal carries its grant (`local-token`, `shell-main`, `plugin`, and the MCP door's `mcp-agent`), but a tailnet
 * principal carries none on the object. Its grant is the preset the door minted it with at hello: the phone's
 * `TAILNET_SCOPES`, a self peer daemon's `PEER_FIELDD_SCOPES`, a guest's `TAILNET_GUEST_SCOPES` (empty). Reading
 * `principal.scopes` there answers "none" for the phone, which holds `terminal.attach` at every door it reaches.
 * The mapping is the hello's, one line each; a change there changes this.
 */
export function grantedScopesOf(principal: Principal): readonly string[] {
  switch (principal.kind) {
    case "local-token":
    case "shell-main":
    case "mcp-agent":
    case "plugin":
      return principal.scopes;
    case "tailnet":
      return TAILNET_SCOPES;
    case "peer-fieldd":
      return PEER_FIELDD_SCOPES;
    case "tailnet-guest":
      return TAILNET_GUEST_SCOPES;
  }
}
