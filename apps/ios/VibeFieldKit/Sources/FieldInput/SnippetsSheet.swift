import FieldDesign
import SwiftUI
import UIKit

/// Saved commands and prompts, and the editor that makes one.
///
/// The sheet is a list and an editor in the same surface rather than two
/// sheets: writing a snippet is something a person does WHILE looking at the
/// ones they already have, and a second presentation over the first would hide
/// exactly the thing they were about to copy.
///
/// Nothing is seeded. An app that ships someone else's `git` aliases is
/// guessing at their shell, so the empty state says what to do in words
/// instead — the D-i6 reading of a list with nothing in it.
public struct SnippetsSheet: View {
  private let store: SnippetStore
  private let onUse: (Snippet) -> Void

  /// The snippet being written, or none. A fresh `Snippet` rather than a set
  /// of loose fields, so SAVE has nothing to assemble.
  @State private var editing: Snippet?
  @State private var isNew = false

  public init(store: SnippetStore, onUse: @escaping (Snippet) -> Void) {
    self.store = store
    self.onUse = onUse
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      if let editing {
        SnippetEditor(
          snippet: editing,
          onSave: { saved in
            if isNew { store.add(saved) } else { store.update(saved) }
            self.editing = nil
          },
          onCancel: { self.editing = nil }
        )
        .padding(.top, 14)
      } else if store.snippets.isEmpty {
        empty
      } else {
        list
      }
      Spacer(minLength: 0)
    }
    .padding(.top, 26)
    .frame(maxWidth: .infinity, alignment: .leading)
    // No background: the sheet's liquid glass is the surface.
  }

  private var header: some View {
    HStack(alignment: .center) {
      VStack(alignment: .leading, spacing: 2) {
        ChromeEyebrow("Snippets")
        Text("Saved commands")
          .font(ChromeType.sans(ChromeType.sheetTitleSize, .semibold))
          .foregroundStyle(ChromePalette.ink)
      }
      Spacer(minLength: 0)
      if editing == nil {
        Button {
          isNew = true
          editing = Snippet(title: "", text: "", sendsEnter: false)
        } label: {
          Text("New")
        }
        .buttonStyle(ChromePillStyle(.secondary))
        .accessibilityLabel("New snippet")
      }
    }
    .padding(.horizontal, 22)
  }

  private var empty: some View {
    Text("No snippets yet — New makes one")
      .font(ChromeType.sans(ChromeType.sheetBodySize))
      .foregroundStyle(ChromePalette.inkTertiary)
      .padding(.horizontal, 22)
      .padding(.top, 18)
  }

  /// A `List` for the swipe, with its own chrome taken off so the sheet's
  /// glass stays the surface — the same treatment the settings sheet gives its
  /// theme list.
  private var list: some View {
    List {
      ForEach(store.snippets) { snippet in
        Button {
          onUse(snippet)
        } label: {
          row(snippet)
        }
        .buttonStyle(.plain)
        .listRowBackground(Color.clear)
        .listRowSeparatorTint(ChromePalette.separator)
        .listRowInsets(EdgeInsets(top: 8, leading: 22, bottom: 8, trailing: 22))
      }
      .onDelete { offsets in store.delete(atOffsets: offsets) }
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .padding(.top, 8)
  }

  /// `.srow` — the command in mono, because it is one, over its name in SF.
  private func row(_ snippet: Snippet) -> some View {
    HStack(alignment: .center, spacing: 10) {
      VStack(alignment: .leading, spacing: 3) {
        Text(snippet.title.isEmpty ? snippet.firstLine : snippet.title)
          .font(ChromeType.sans(ChromeType.rowSummarySize))
          .foregroundStyle(ChromePalette.inkTertiary)
          .lineLimit(1)
        Text(snippet.firstLine)
          .font(ChromeType.mono(ChromeType.rowCommandSize, .semibold))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
      }
      Spacer(minLength: 0)
      // The one mark that changes what a tap DOES, so it is on the row rather
      // than inside the snippet.
      if snippet.sendsEnter {
        FieldGlyph(.return, size: FieldGlyph.box(for: 13))
          .foregroundStyle(ChromePalette.inkTertiary)
          .accessibilityLabel("sends Enter")
      }
    }
    .frame(minHeight: 44)
    .contentShape(Rectangle())
  }
}

/// The inline editor: a title, the text, and the one decision that matters.
struct SnippetEditor: View {
  @State private var title: String
  @State private var text: String
  @State private var sendsEnter: Bool
  private let identity: UUID
  private let onSave: (Snippet) -> Void
  private let onCancel: () -> Void

  init(snippet: Snippet, onSave: @escaping (Snippet) -> Void, onCancel: @escaping () -> Void) {
    _title = State(initialValue: snippet.title)
    _text = State(initialValue: snippet.text)
    _sendsEnter = State(initialValue: snippet.sendsEnter)
    identity = snippet.id
    self.onSave = onSave
    self.onCancel = onCancel
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      // The title's own traits are off for the same reason the composer's are:
      // this is a name for a command, and a capitalized `git` is a different
      // word.
      TextField(
        "", text: $title,
        prompt: Text("Title").foregroundStyle(ChromePalette.placeholder)
      )
      .font(ChromeType.sans(ChromeType.fieldSize))
      .foregroundStyle(ChromePalette.ink)
      .tint(ChromePalette.ink)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .padding(.horizontal, 12)
      .frame(height: 48)
      .background { ChromeMaterial.well() }
      .accessibilityLabel("Snippet title")

      SnippetTextView(text: $text)
        .frame(height: 120)
        .background { ChromeMaterial.well() }
        .accessibilityLabel("Snippet text")

      HStack(spacing: 10) {
        // A chip rather than a `Toggle`: a switch is the one control in this
        // app that says on/off with a colour, and attention here is contrast.
        // A small pill toggle rather than a `Toggle`: a switch is the one
        // control in this app that says on/off with a colour, and the chrome
        // family says it with material.
        Button {
          sendsEnter.toggle()
        } label: {
          HStack(spacing: 6) {
            FieldGlyph(.return, size: FieldGlyph.box(for: 12))
            Text("Sends Enter")
          }
          .font(ChromeType.sans(ChromeType.rowSummarySize, .semibold))
          .foregroundStyle(sendsEnter ? ChromePalette.keyOnInk : ChromePalette.inkTertiary)
          .padding(.horizontal, 14)
          .frame(height: 36)
          .background {
            if sendsEnter {
              Capsule().fill(ChromePalette.keyOnFill)
            } else {
              Capsule()
                .fill(ChromePalette.keyFill)
                .overlay { Capsule().strokeBorder(ChromePalette.keyHairline, lineWidth: 0.5) }
            }
          }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(sendsEnter ? "Sends Enter, on" : "Sends Enter, off")
        .accessibilityAddTraits(sendsEnter ? [.isSelected] : [])

        Spacer(minLength: 0)

        Button(action: onCancel) {
          Text("Cancel")
        }
        .buttonStyle(ChromePillStyle(.secondary))

        Button {
          onSave(
            Snippet(
              id: identity,
              title: title.isEmpty ? String(text.prefix(24)) : title,
              text: text,
              sendsEnter: sendsEnter))
        } label: {
          Text("Save")
        }
        .buttonStyle(ChromePillStyle(.primary))
        // Never disabled: an empty snippet simply is not saved, and a greyed
        // Save would explain nothing about why.
        .disabled(false)
      }
    }
    .padding(.horizontal, 22)
  }

}

/// The snippet body, on the composer's own text view.
///
/// It reuses `InputTextView` rather than a SwiftUI `TextEditor` for exactly the
/// reason `ComposerField` does: a snippet is a command, and autocorrection,
/// smart quotes and smart dashes turn `--flag` into an en dash and `"$HOME"`
/// into curled quotes. A snippet corrupted at the moment it is WRITTEN is
/// worse than one corrupted when it is typed, because it stays wrong.
struct SnippetTextView: UIViewRepresentable {
  @Binding var text: String

  func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

  func makeUIView(context: Context) -> InputTextView {
    let view = InputTextView()
    view.delegate = context.coordinator
    view.autocorrectionType = .no
    view.spellCheckingType = .no
    view.smartQuotesType = .no
    view.smartDashesType = .no
    view.smartInsertDeleteType = .no
    view.autocapitalizationType = .none
    view.inputAccessoryView = nil
    view.backgroundColor = .clear
    view.isScrollEnabled = true
    view.placeholder = "The command or prompt"
    view.text = text
    return view
  }

  func updateUIView(_ view: InputTextView, context: Context) {
    context.coordinator.text = $text
    view.textColor = UIColor(ChromePalette.ink)
    view.tintColor = UIColor(ChromePalette.ink)
    view.placeholderColor = UIColor(ChromePalette.placeholder)
    if view.text != text {
      view.text = text
      view.refreshPlaceholder()
    }
  }

  @MainActor
  final class Coordinator: NSObject, UITextViewDelegate {
    var text: Binding<String>

    init(text: Binding<String>) {
      self.text = text
    }

    func textViewDidChange(_ textView: UITextView) {
      text.wrappedValue = textView.text
      (textView as? InputTextView)?.refreshPlaceholder()
    }
  }
}
