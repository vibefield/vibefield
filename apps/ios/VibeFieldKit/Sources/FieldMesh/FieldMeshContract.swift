/// The mesh facts this app speaks, pinned in ONE place.
///
/// `appID` mirrors `APP_ID` in `packages/contracts/src/registries.ts` — one
/// tailnet application namespace per product, which the desktop floor reads at
/// `packages/field-native/src/services/mesh.rs`. Like `FieldProductContract`'s
/// `contractsVersion` it is hand-pinned rather than generated, because this app
/// is deliberately outside `pnpm verify` and has no generator pointed at it —
/// so `scripts/check-ios-fixtures.mjs` compares this string against the
/// registry's and a drift fails the gate rather than a QA run.
///
/// It is load-bearing and not a label. A truffle node admits a peer into its
/// registry only when the peer's Tailscale hostname starts with
/// `truffle-{appId}-` (`MeshNode.upsertFromLayer3`, RFC 017 §4), so two nodes
/// with different app ids are invisible to each other however healthy both
/// are. That is exactly what James's QA of 2026-09-13 found: a signed-in phone
/// reading `online · 0 peers in reach` beside a desktop whose mesh was up.
public enum FieldMeshContract {
  /// = `APP_ID` in `packages/contracts/src/registries.ts`.
  public static let appID = "vibefield"
}
