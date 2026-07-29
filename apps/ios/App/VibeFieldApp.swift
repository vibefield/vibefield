import FieldHome
import SwiftUI

/// The composition shell. Everything real lives in VibeFieldKit — this
/// target only mounts the home screen (mirroring the desktop's thin
/// `apps/desktop`: packaging, not product).
@main
struct VibeFieldApp: App {
  var body: some Scene {
    WindowGroup {
      HomeScreen()
    }
  }
}
