import FieldMesh
import FieldProduct
import SwiftUI

// MA-5b-1 — the open app (DESIGN.md §8 "The open app"): the app's screen draws `AppOpenModel`'s phase as its face
// (`AppsOpenFace`), above the one glass row the honest screen already stands on. While it serves, the made app's own
// page fills the screen and its layout ends above the row (P3). Every state that is not a serving page keeps the honest
// screen, in §9's words. A build without the web host (a Release build without SP-4d's relay) never serves, so it draws
// the honest screen as before 5b.
// Not yet, said: the row's fold on scroll (5b-2), the warm page kept for ten minutes (5b-3), "Opening on ‹desktop›…"
// held over the page until its first paint, and ···'s Keep, Versions, Open on ‹desktop› and Copy link.

struct AppsOpenScreen: View {
  let app: IndexAppRow
  let phase: AppOpenModel.Phase
  /// The row's own honest screen, as it stood before 5b.
  let honest: AppsHonest
  let about: AppsAbout
  let desktop: String
  /// Whether a tap opens the app itself here (`AppOpenModel.opensApps`, and never under `-vf-mock`).
  let opens: Bool
  /// The mesh this screen holds: the page's front makes its dials from it at each load (item 522).
  let mesh: MeshModel
  let onFall: (AppsPageFall) -> Void
  let onClose: () -> Void

  @State private var reloads = 0

  var body: some View {
    let face = AppsOpenFace.of(phase, appKey: app.appKey, row: honest, opens: opens)
    let reload: (() -> Void)? = face.isPage ? { reloads += 1 } : nil
    AppsAppScreen(
      app: app, honest: face.honest ?? honest, about: about, desktop: desktop, onClose: onClose, face: face,
      page: page(face), onReload: reload)
  }

  private func page(_ face: AppsOpenFace) -> AnyView? {
    #if DEBUG || VF_WEB_RELAY
      guard case .page(let url, let policy) = face else { return nil }
      return AnyView(
        AppsWebPage(url: url, policy: policy, appId: app.appId, mesh: mesh, reloads: reloads, onFall: onFall)
          .id(url))
    #else
      return nil
    #endif
  }
}
