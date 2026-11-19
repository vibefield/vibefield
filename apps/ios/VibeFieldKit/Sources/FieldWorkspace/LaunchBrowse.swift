import FieldDesign
import FieldProduct
import SwiftUI
import UIKit

/// Item 586 (2026-11-19) — Browse is the launch sheet risen to its large detent (DESIGN.md §8, "The phone's launch
/// sheet asks two things"): no sheet over a sheet. It opens beside the chosen folder; the folder you are in is the
/// title and the way back is the crumbs, every step a tap and the desktop's places first; folders only; search on
/// demand under the folder you are in; Use chooses the folder you are in and brings the menu back, and back from a
/// root's top changes nothing. Its honest states are FS-2's words (`WorkspaceReads.message`); while the desktop
/// sleeps, the last rows read stay, dimmed.
struct LaunchBrowse: View {
  /// Where Browse opens: beside the chosen folder; at the desktop's places, or wherever its reader stands (the DEBUG
  /// demo door's scenes).
  enum Opening { case beside, places, asIs }

  @Bindable var model: WorkspaceLaunch
  let opening: Opening
  let done: @MainActor () -> Void
  @State private var opened = false
  @State private var searching = false
  @State private var query = ""
  @State private var copied = false
  @FocusState private var queryFocused: Bool

  init(model: WorkspaceLaunch, opening: Opening, done: @escaping @MainActor () -> Void) {
    self.model = model
    self.opening = opening
    self.done = done
  }

  private var desktop: String { model.desktop?.name ?? "this desktop" }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      bar
      if let reader = model.reader {
        page(reader)
      } else {
        Text("Connect a desktop to browse its folders")
          .font(ChromeType.sans(15))
          .foregroundStyle(ChromePalette.inkSecondary)
          .padding(.horizontal, 22)
          .padding(.top, 24)
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .task(id: model.reader?.roots) { await openOnce() }
    .task(id: query) {
      guard searching, let reader = model.reader, reader.root != nil else { return }
      do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
      await reader.search(query)
    }
  }

  // MARK: The page

  @ViewBuilder private func page(_ reader: WorkspaceReads) -> some View {
    let title = LaunchModel.browseTitle(desktop: desktop, root: reader.root, path: reader.relativePath)
    Text(title)
      .font(ChromeType.sans(30, .heavy))
      .tracking(ChromeType.tracking(-0.04, of: 30))
      .lineLimit(1)
      .truncationMode(.middle)
      .padding(.horizontal, 22)
      .padding(.top, 10)
      .accessibilityAddTraits(.isHeader)
    crumbs(reader)
    if searching { searchField(title) }
    if let message = reader.message { stateLine(reader, message) }
    rows(reader, title: title)
    use(reader, title: title)
  }

  /// Back (the chevron turned) and, inside a root, the search circle.
  private var bar: some View {
    HStack {
      circle(.chevron, turn: 180, label: backLabel, on: false) { back() }
      Spacer()
      if model.reader?.root != nil {
        circle(.search, label: searching ? "Close search" : "Search folders", on: searching) { toggleSearch() }
      }
    }
    .padding(.horizontal, 16)
    .padding(.top, 18)
  }

  private func circle(
    _ glyph: FieldGlyphName, turn: Double = 0, label: String, on: Bool, action: @escaping @MainActor () -> Void
  ) -> some View {
    Button(action: action) {
      FieldGlyph(glyph, size: 17, turn: turn)
        .foregroundStyle(on ? ChromePalette.keyOnInk : ChromePalette.ink)
        .frame(width: 40, height: 40)
        .background(Circle().fill(on ? ChromePalette.keyOnFill : ChromePalette.wellFill))
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }

  private var backLabel: String {
    guard let reader = model.reader, let root = reader.root, !reader.relativePath.isEmpty else {
      return "Back to the menu"
    }
    let up = LaunchModel.parent(reader.relativePath)
    return "Back to \(LaunchModel.browseTitle(desktop: desktop, root: root, path: up))"
  }

  /// The way back in mono: the desktop (its places), `~` or the volume, then each folder; the current one in the ink.
  private func crumbs(_ reader: WorkspaceReads) -> some View {
    let steps = LaunchModel.crumbs(desktop: desktop, root: reader.root, path: reader.relativePath)
    return ScrollView(.horizontal) {
      HStack(spacing: 0) {
        ForEach(steps.indices, id: \.self) { index in
          if index > 0 {
            Text("/")
              .font(ChromeType.mono(12))
              .foregroundStyle(ChromePalette.inkT4)
              .padding(.horizontal, 1)
              .accessibilityHidden(true)
          }
          crumb(steps[index], current: index == steps.count - 1)
        }
      }
      .padding(.horizontal, 16)
    }
    .scrollIndicators(.hidden)
    .defaultScrollAnchor(.trailing)
    .frame(height: 30)
    .padding(.top, 2)
  }

  private func crumb(_ step: LaunchModel.Crumb, current: Bool) -> some View {
    Button {
      go(step)
    } label: {
      Text(step.label)
        .font(ChromeType.mono(12, current ? .bold : .medium))
        .foregroundStyle(current ? ChromePalette.ink : ChromePalette.inkTertiary)
        .padding(.horizontal, 5)
        .frame(height: 28)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(current)
    .accessibilityLabel(step.label == "…" ? "The folders between" : step.label)
  }

  private func searchField(_ title: String) -> some View {
    HStack(spacing: 8) {
      FieldGlyph(.search, size: 16)
        .foregroundStyle(ChromePalette.inkTertiary)
      TextField("Search under \(title)", text: $query)
        .font(ChromeType.sans(16))
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .submitLabel(.search)
        .focused($queryFocused)
        .accessibilityLabel("Search the folders under \(title)")
    }
    .padding(.horizontal, 12)
    .frame(height: 40)
    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(ChromePalette.wellFill))
    .padding(.horizontal, 16)
    .padding(.top, 10)
  }

  /// FS-2's honest words for what the folders wait on, with Try again where trying again can help.
  private func stateLine(_ reader: WorkspaceReads, _ message: String) -> some View {
    HStack(spacing: 8) {
      if reader.state == .loading { ProgressView().controlSize(.small) }
      Text(message)
        .font(ChromeType.sans(13))
        .foregroundStyle(ChromePalette.inkSecondary)
        .lineLimit(2)
      Spacer(minLength: 8)
      if reader.state != .loading && reader.state != .ready {
        Button("Try again") { Task { await retry(reader) } }
          .font(ChromeType.sans(13, .semibold))
          .buttonStyle(.plain)
          .foregroundStyle(ChromePalette.ink)
      }
    }
    .padding(.horizontal, 22)
    .padding(.top, 10)
  }

  // MARK: The rows

  /// Folders only. At the desktop's places: Home and every volume. Inside a root: its folders, or the search's hits,
  /// each naming its parent. A row opens its folder and chooses nothing; a long press copies its path.
  private func rows(_ reader: WorkspaceReads, title: String) -> some View {
    let resting = reader.state == .ready || reader.state == .loading
    return ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        if reader.root == nil {
          ForEach(reader.browse) { root in
            row(
              name: root.browse == "home" ? "Home" : root.name, note: root.path, tag: nil, path: root.path,
              enabled: !root.missing
            ) {
              endSearch(reload: false)
              Task { await reader.open(root) }
            }
          }
        } else {
          let entries = (reader.query.isEmpty ? reader.entries : reader.hits).filter { $0.kind == "dir" }
          ForEach(entries, id: \.path) { entry in
            row(
              name: entry.name,
              note: reader.query.isEmpty ? nil : LaunchModel.parentShown(entry.path, home: model.homePath),
              tag: LaunchModel.browseTag(entry.path, chosen: model.chosenPath, places: model.placesHere),
              path: entry.path, enabled: true
            ) {
              endSearch(reload: false)
              Task { await reader.enter(entry) }
            }
          }
          foot(reader, title: title, shown: entries.count)
        }
      }
      .padding(.bottom, 12)
      .allowsHitTesting(resting)
    }
    .opacity(resting ? 1 : 0.45)
    .scrollDismissesKeyboard(.immediately)
  }

  private func row(
    name: String, note: String?, tag: String?, path: String, enabled: Bool, open: @escaping @MainActor () -> Void
  ) -> some View {
    let chosen = tag == "CHOSEN"
    return Button(action: open) {
      HStack(spacing: 12) {
        FieldGlyph(.folder, size: 21)
          .foregroundStyle(chosen ? ChromePalette.ink : ChromePalette.inkSecondary)
        VStack(alignment: .leading, spacing: 1) {
          Text(name)
            .font(ChromeType.sans(16, .medium))
            .lineLimit(1)
            .truncationMode(.middle)
          if let note {
            Text(note)
              .font(ChromeType.mono(12))
              .foregroundStyle(ChromePalette.inkSecondary)
              .lineLimit(1)
              .truncationMode(.middle)
          }
        }
        Spacer(minLength: 8)
        if let tag {
          Text(tag)
            .font(FieldType.mono(10, .heavy))
            .tracking(FieldType.tracking(0.08, of: 10))
            .foregroundStyle(chosen ? ChromePalette.ink : ChromePalette.inkTertiary)
        }
        FieldGlyph(.chevron, size: 13)
          .foregroundStyle(ChromePalette.inkT4)
      }
      .foregroundStyle(ChromePalette.ink)
      .padding(.leading, 22)
      .padding(.trailing, 20)
      .padding(.vertical, 5)
      .frame(minHeight: 52)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
    .opacity(enabled ? 1 : 0.45)
    .contextMenu {
      Button("Copy path", systemImage: "doc.on.doc") { copy(path) }
    }
    .accessibilityLabel([name, tag?.lowercased()].compactMap { $0 }.joined(separator: ", "))
    .accessibilityHint("Opens the folder")
  }

  /// Under the rows: none here, more to load, a search that read part of the folder, a list clipped.
  @ViewBuilder private func foot(_ reader: WorkspaceReads, title: String, shown: Int) -> some View {
    if shown == 0 && reader.state == .ready {
      Text(reader.query.isEmpty ? "No folders here" : "No folders under \(title) match “\(reader.query)”")
        .font(ChromeType.sans(14))
        .foregroundStyle(ChromePalette.inkTertiary)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.top, 40)
    }
    if reader.query.isEmpty, reader.nextCursor != nil {
      Button("Load more (\(reader.entries.count) of \(reader.total))") { Task { await reader.more() } }
        .font(ChromeType.sans(15, .medium))
        .buttonStyle(.plain)
        .foregroundStyle(ChromePalette.ink)
        .disabled(reader.state != .ready)
        .frame(minHeight: 44)
        .padding(.horizontal, 22)
    }
    if !reader.query.isEmpty && !reader.complete { footnote("Searched part of \(title)") }
    if reader.clipped {
      footnote(reader.query.isEmpty ? "More entries are available" : "More matches are available. Narrow your search.")
    }
  }

  private func footnote(_ words: String) -> some View {
    Text(words)
      .font(ChromeType.sans(13))
      .foregroundStyle(ChromePalette.inkTertiary)
      .padding(.horizontal, 22)
      .padding(.top, 8)
  }

  // MARK: Use

  /// Use “packages”: the folder you are in becomes the chosen one, and the menu comes back with it leading WHERE.
  private func use(_ reader: WorkspaceReads, title: String) -> some View {
    Button {
      guard model.chooseCurrentFolder() else { return }
      endSearch(reload: false)
      done()
    } label: {
      HStack(spacing: 8) {
        FieldGlyph(.check, size: 16)
        Text(useWords(reader, title: title))
          .lineLimit(1)
          .truncationMode(.middle)
      }
    }
    .buttonStyle(ChromePillStyle(.primary, wide: true))
    .disabled(reader.choice == nil || model.spawning)
    .overlay(alignment: .top) {
      if copied {
        Text("Path copied")
          .font(ChromeType.sans(13, .medium))
          .padding(.horizontal, 14)
          .padding(.vertical, 8)
          .background(.regularMaterial, in: Capsule())
          .offset(y: -44)
          .transition(.opacity)
      }
    }
    .padding(.horizontal, 16)
    .padding(.top, 8)
    .padding(.bottom, 12)
  }

  private func useWords(_ reader: WorkspaceReads, title: String) -> String {
    if reader.choice != nil { return "Use “\(title)”" }
    if reader.root == nil { return "Open a place to choose a folder" }
    if reader.state == .offline { return "\(desktop) is asleep" }
    if reader.state == .loading { return "Reading folders…" }
    return "This folder cannot be used"
  }

  // MARK: Moving

  /// Browse opens once each time it rises: beside the chosen folder, else at the home's top.
  private func openOnce() async {
    guard !opened, let reader = model.reader, !reader.roots.isEmpty else { return }
    opened = true
    switch opening {
    case .asIs: return
    case .places: reader.showRoots()
    case .beside:
      if let start = model.browseStart {
        await reader.open(start.root, path: start.path)
      } else {
        reader.showRoots()
      }
    }
  }

  /// Back walks up a folder; from a root's top, or the desktop's places, it is the menu again, with nothing changed.
  private func back() {
    guard let reader = model.reader, let root = reader.root, !reader.relativePath.isEmpty else {
      endSearch(reload: false)
      done()
      return
    }
    endSearch(reload: false)
    Task { await reader.open(root, path: LaunchModel.parent(reader.relativePath)) }
  }

  private func go(_ step: LaunchModel.Crumb) {
    guard let reader = model.reader else { return }
    endSearch(reload: false)
    guard let rootId = step.rootId else {
      reader.showRoots()
      return
    }
    guard let root = reader.roots.first(where: { $0.id == rootId }) else { return }
    Task { await reader.open(root, path: step.path) }
  }

  private func toggleSearch() {
    if searching {
      endSearch(reload: true)
    } else {
      searching = true
      queryFocused = true
    }
  }

  /// The search put away; its hits give way to the folder's own rows when it had asked (`reload`).
  private func endSearch(reload: Bool) {
    let asked = !(model.reader?.query.isEmpty ?? true)
    searching = false
    query = ""
    queryFocused = false
    if reload, asked, let reader = model.reader { Task { await reader.search("") } }
  }

  private func retry(_ reader: WorkspaceReads) async {
    await reader.refreshRoots()
    if reader.state == .ready, let root = reader.root { await reader.open(root, path: reader.relativePath) }
  }

  private func copy(_ path: String) {
    model.reader?.copyPath(path) { UIPasteboard.general.string = $0 }
    withAnimation(.easeOut(duration: 0.18)) { copied = true }
    Task {
      try? await Task.sleep(for: .seconds(2))
      withAnimation(.easeOut(duration: 0.18)) { copied = false }
    }
  }
}
