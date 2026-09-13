import FieldDesign
import FieldTerminal
import SwiftUI

/// Where a host's mirror-write key is entered (IOS-3c).
///
/// The sheet is deliberately one-way: it takes a secret and it removes one,
/// and it never reads the stored value back. There is no field to prefill and
/// nothing to reveal — a key on screen is a key in a screenshot, and the only
/// question this sheet can honestly answer is "does this phone hold one",
/// which is what `hasKey` carries.
///
/// The one sentence names the desktop's env var because that is where the
/// value comes from: without it the user is being asked for a secret with no
/// way to know which secret.
struct WriteKeySheet: View {
  private let host: MirrorWriteHost
  private let hasKey: Bool
  private let onSave: (String) -> Void
  private let onRemove: () -> Void
  /// IOS-4d — ask the desktop itself, instead of pasting. `nil` when there is
  /// no door to that desktop: a button that cannot reach anything is the dead
  /// control D-i6 forbids, and the paste path is still right there.
  private let onAskDesktop: (() -> Void)?
  /// What the desktop said last time it was asked, if it has been. A refusal
  /// is a sentence a person can act on, not an alert to dismiss.
  private let grantNote: String?

  @State private var secret = ""

  init(
    host: MirrorWriteHost,
    hasKey: Bool,
    onSave: @escaping (String) -> Void,
    onRemove: @escaping () -> Void,
    onAskDesktop: (() -> Void)? = nil,
    grantNote: String? = nil
  ) {
    self.host = host
    self.hasKey = hasKey
    self.onSave = onSave
    self.onRemove = onRemove
    self.onAskDesktop = onAskDesktop
    self.grantNote = grantNote
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // IOS-5v: this sheet belongs to the input card's family — it is the door
      // the card's own invitation opens — so it wears the chrome tokens rather
      // than the field's godview ones.
      ChromeEyebrow("Write key")

      Text(host.deviceName)
        .font(ChromeType.sans(ChromeType.sheetTitleSize, .semibold))
        .foregroundStyle(ChromePalette.ink)
        .padding(.top, 4)

      Text(
        "The value of FIELD_NATIVE_TERMINAL_MIRROR_WRITE in the desktop's environment. "
          + "Stored in this phone's keychain, never synced."
      )
      .font(ChromeType.sans(ChromeType.sheetBodySize))
      .foregroundStyle(ChromePalette.inkTertiary)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.top, 10)

      field
        .padding(.top, 16)

      acts
        .padding(.top, 16)

      if let grantNote {
        Text(grantNote)
          .font(ChromeType.sans(ChromeType.sheetBodySize))
          .foregroundStyle(ChromePalette.inkTertiary)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 12)
      }

      Spacer(minLength: 0)
    }
    .padding(.horizontal, 22)
    .padding(.top, 26)
    .frame(maxWidth: .infinity, alignment: .leading)
    // No background: the sheet's liquid glass is the surface (MeshSheet's rule).
  }

  /// A text well with dots instead of glyphs. The placeholder is drawn rather
  /// than passed to `SecureField` because the system's own prompt cannot be
  /// given the sheet's own ink.
  private var field: some View {
    ZStack(alignment: .leading) {
      if secret.isEmpty {
        Text("Paste the key")
          .font(ChromeType.sans(ChromeType.fieldSize))
          .foregroundStyle(ChromePalette.placeholder)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
      SecureField("", text: $secret)
        .textFieldStyle(.plain)
        .font(ChromeType.sans(ChromeType.fieldSize))
        .foregroundStyle(ChromePalette.ink)
        .tint(ChromePalette.ink)
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .textContentType(.password)
        .submitLabel(.done)
        .onSubmit { save() }
        .accessibilityLabel("Write key for \(host.deviceName)")
    }
    .padding(.horizontal, 12)
    .frame(height: 48)
    .background { ChromeMaterial.well() }
  }

  private var acts: some View {
    HStack(spacing: 10) {
      Button(action: save) {
        Text("Save")
      }
      .buttonStyle(ChromePillStyle(.primary))

      if let onAskDesktop {
        // IOS-4d — the door instead of the clipboard. Offered only when there
        // IS a door: a desktop this phone cannot reach has nothing to ask.
        Button(action: onAskDesktop) {
          Text("Get it from studio")
        }
        .buttonStyle(ChromePillStyle(.secondary))
      }

      if hasKey {
        // Only when there is something to remove. A Remove that is always
        // there would be a control that does nothing on the run where it
        // matters most — the first one (D-i6).
        Button(action: onRemove) {
          Text("Remove")
        }
        .buttonStyle(ChromePillStyle(.secondary))
      }
    }
  }

  /// An empty save is a no-op and the field stays open — the alternative is a
  /// greyed-out Save, which is the disabled-looking control D-i6 forbids.
  /// Whitespace is trimmed because the value is usually pasted out of a shell,
  /// and a trailing newline in a token is a refusal the host cannot explain.
  private func save() {
    let trimmed = secret.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    onSave(trimmed)
  }
}
