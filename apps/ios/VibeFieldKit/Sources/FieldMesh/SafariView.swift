import SafariServices
import SwiftUI

/// The Tailscale login page, in-app (the GhostteaApp pattern: a plain
/// SFSafariViewController sheet; dismissal triggers a mesh refresh).
public struct SafariView: UIViewControllerRepresentable {
  private let url: URL

  public init(url: URL) {
    self.url = url
  }

  public func makeUIViewController(context: Context) -> SFSafariViewController {
    SFSafariViewController(url: url)
  }

  public func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
