import FieldDesign
import SwiftUI
import UIKit

// Item 362g (asked for 2026-11-12: pictures through a rosetta release; its parts settled 2026-11-13) — A RECORDED
// PICTURE, DRAWN. Where the document drew a placeholder for everything attached
// (`image shot.png on studio`), a picture the session's reader holds is drawn: a square tile in the row, and,
// when the tile is pressed, the row's pictures in a viewer that is the whole screen, where a pinch zooms one and
// a swipe goes to the next (item 384, at the foot of this file; before it, one picture on a sheet). A reader
// holds pictures only for a session read straight from its desktop. Everywhere else, and for whatever is no
// picture, the placeholder stands as it always did; nothing on screen names the way a document is read.
//
// The room's strip at the phone's width (rosetta's clients/room, components/transcript/Attachments.tsx and
// styles/attachments.css), at the figures the art director ruled (2026-11-13): a square tile on the fill inside
// a hairline, 104 pt with 8 between, three across every phone. A picture on its way holds its tile's square, as
// the room's does, so a row is the height it will be when the picture lands. One thing is the phone's: the strip
// WRAPS, where the room's runs on and scrolls sideways, because a page that scrolls down does not also scroll
// across (the rule a tool line's diff follows).
//
// A picture's bytes are held by the reader, in memory and under a bound, and never by the document. What is read
// from them to draw is kept only in a view's state, so a tile that leaves the page, and a viewer that closes, let
// their picture go. A recorded picture is the adversary's as every recorded thing is (EL7): it is read by the
// system's decoder into pixels, and nothing here opens anything.
// DESIGN.md §8 "The phone's session document" (item 362g).

/// The attachments under one message, or under one group, in order: tiles side by side, wrapping, and a
/// placeholder on a row of its own.
struct HistoryPictureStrip: View {
  let attached: [HistoryAttached]
  /// This session's pictures as its reader holds them, by `HistoryPictureLayout.key`.
  let pictures: [String: HistoryPictureFace]
  /// A cell came on screen: its picture is asked for, by the attachment's id.
  let need: (String) -> Void
  /// A tile was pressed: the attachment, and the picture its tile draws.
  let open: (HistoryAttached, UIImage) -> Void

  var body: some View {
    // the layout called as a function: its init takes no content
    let flow = HistoryPictureFlow()
    flow {
      ForEach(attached) { one in
        HistoryPictureCell(
          attached: one, face: one.picture.flatMap { pictures[HistoryPictureLayout.key($0, .tile)] }, need: need,
          open: open)
      }
    }
    // the placeholder's own margins, as the document always had them: 4 above and below, and 8 between two
    .padding(.vertical, 4)
  }
}

/// A strip's layout: its cells left to right, 8 apart, on a further row where the next does not fit
/// (`HistoryPictureLayout.flow`), as Chat's acts wrap (`ChatActsLayout`, which History cannot reach: FieldHome
/// depends on it, not it on FieldHome). A tile says its own square; a placeholder takes the width it is offered,
/// and so a row.
struct HistoryPictureFlow: Layout {
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    // a width that is not a number of points (none offered, or no bound) lays the strip out on one row
    let width: CGFloat? = proposal.width.flatMap { $0.isFinite ? $0 : nil }
    let placed = HistoryPictureLayout.flow(
      fits(subviews, within: width), width: width ?? .greatestFiniteMagnitude, gap: HistoryPictureLayout.gap)
    return CGSize(width: width ?? placed.size.width, height: placed.size.height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let sizes = fits(subviews, within: bounds.width)
    let placed = HistoryPictureLayout.flow(sizes, width: bounds.width, gap: HistoryPictureLayout.gap)
    for (index, subview) in subviews.enumerated() {
      let origin = placed.origins[index]
      subview.place(
        at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), anchor: .topLeading,
        proposal: ProposedViewSize(sizes[index]))
    }
  }

  /// What each cell takes when it is offered the strip's width.
  private func fits(_ subviews: Subviews, within width: CGFloat?) -> [CGSize] {
    subviews.map { $0.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
  }
}

/// One attachment in a strip: its tile when its picture is held and reads as one, the tile's square while the
/// picture is on its way, and else its placeholder (`HistoryPictureLayout.draws`, `side`).
struct HistoryPictureCell: View {
  let attached: HistoryAttached
  /// The tile's face as the reader holds it; nil where it holds none.
  let face: HistoryPictureFace?
  let need: (String) -> Void
  let open: (HistoryAttached, UIImage) -> Void

  @Environment(\.displayScale) private var scale
  /// The held bytes, read. View state only: a cell that leaves the page lets its picture go.
  @State private var picture: UIImage?
  /// The held bytes are no picture the phone reads.
  @State private var unreadable = false

  /// The bytes held for the tile, when they are.
  private var held: Data? {
    if case .held(let data)? = face { return data }
    return nil
  }

  /// What the held bytes read as: a picture, no picture, or nil while they are not read yet.
  private var readAs: Bool? {
    if picture != nil { return true }
    return unreadable ? false : nil
  }

  var body: some View {
    let draws = HistoryPictureLayout.draws(face, read: readAs)
    // one root under every face: the ask goes out when the cell comes on screen, and not again each time its
    // face changes, so a read that failed is asked again only when the row is next come to
    ZStack(alignment: .topLeading) {
      if let side = HistoryPictureLayout.side(draws) {
        if draws == .tile, let picture {
          tile(picture, side: side)
        } else {
          square(side)
        }
      } else {
        HistoryPlaceholderLine(words: attached.words)
      }
    }
    .onAppear {
      if let id = attached.picture { need(id) }
    }
    .task(id: held) { await readHeld() }
  }

  /// Reads the held bytes at the size a tile is drawn, off the main actor; with none held, lets the picture go.
  private func readHeld() async {
    guard let data = held else {
      picture = nil
      unreadable = false
      return
    }
    let across = HistoryPictureLayout.pixels(HistoryPictureLayout.tile, scale: scale)
    let image = await HistoryPictureDecode.image(data, across: across)
    guard !Task.isCancelled else { return }
    picture = image
    unreadable = image == nil
  }

  /// The tile: the picture filling a square on the fill, inside the hairline and at the corners of the
  /// placeholder it stands in for. Its spoken name is the placeholder's words.
  private func tile(_ image: UIImage, side: CGFloat) -> some View {
    let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
    return Button {
      open(attached, image)
    } label: {
      Image(uiImage: image)
        .resizable()
        .aspectRatio(contentMode: .fill)
        .frame(width: side, height: side)
        .background(ChromePalette.fill)
        .clipShape(shape)
        .overlay { shape.strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5) }
        .contentShape(shape)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(attached.words)
    .accessibilityAddTraits(.isImage)
  }

  /// A picture on its way: the tile's own square (the fill, the corners, the hairline) with the placeholder's
  /// glyph breathing at its centre, so the row is as tall as it will be when the picture lands. Under Reduce
  /// Motion the glyph is still, and the square alone says a picture is coming: one that did not arrive is the
  /// placeholder's line. Its spoken name is the placeholder's words.
  private func square(_ side: CGFloat) -> some View {
    let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
    return shape.fill(ChromePalette.fill)
      .frame(width: side, height: side)
      .overlay {
        HistoryPictureGlyph(size: 12, waiting: true)
          .foregroundStyle(ChromePalette.inkT4)
      }
      .overlay { shape.strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5) }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(attached.words)
  }
}

/// SP-6 — what the phone does not carry, said: `image shot.png on studio`. The placeholder's line as the document
/// always drew it, moved here from HistorySessionView.swift; its margins above and below are its strip's now.
struct HistoryPlaceholderLine: View {
  let words: String

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "photo")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(ChromePalette.inkT4)
      Text(words)
        .font(ChromeType.sans(12.5))
        .foregroundStyle(ChromePalette.inkTertiary)
        // the reason an attachment has no bytes is the row's point: wrap, never cut the middle out
        .lineLimit(2)
        .truncationMode(.tail)
        .multilineTextAlignment(.leading)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 12)
    .frame(minHeight: 34)
    .background(
      RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5)
    )
    .accessibilityLabel(words)
  }
}

/// The placeholder's glyph, as a mark. While a picture is on its way it breathes as the pulse beside a running
/// line does (`LivePulse`: to 35 % and back, 1.1 s each way); still under Reduce Motion, as that is.
struct HistoryPictureGlyph: View {
  let size: CGFloat
  let waiting: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var breathing = false

  var body: some View {
    Image(systemName: "photo")
      .font(.system(size: size, weight: .medium))
      .opacity(waiting && breathing ? 0.35 : 1)
      .onChange(of: waiting, initial: true) { _, waits in
        guard waits, !reduceMotion else {
          breathing = false
          return
        }
        withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { breathing = true }
      }
  }
}

// MARK: - The row's pictures, in a viewer that is the whole screen (item 384)

/// What a viewer was opened for: the row whose tile was pressed, and the tile.
struct HistoryGalleryOpen: Identifiable {
  /// The pressed picture's id in the document, `<timelineId>/<attachmentId>`.
  let id: String
  /// The row's attachments, in the row's order. The pictures among them are the viewer's
  /// (`HistoryPictureLayout.gallery`).
  let attached: [HistoryAttached]
  /// The desktop the session is on, for the line under a picture that is being read, or did not arrive.
  let desktop: String
  /// The pressed tile's picture, which stands in on its page at once.
  let tile: UIImage
}

/// Item 384 (asked for 2026-11-13: a proper viewer, each picture at full size, panned and zoomed, a rail of the
/// row's other pictures to press, a swipe left or right to the next, and no card) — a row's pictures
/// on the whole screen. At its head the name of the picture shown and `Done`; under that the pictures, a page
/// each, a swipe left or right going from one to the next; and at its foot, when the row holds more than one,
/// the room's rail (`Images in this row`, `2 / 5`, a thumbnail of each, the one shown ringed), where a press goes
/// to a picture. It took the place of a sheet that showed one picture at the page's width.
///
/// The picture shown and the one on each side of it are asked for at the larger size
/// (`HistoryPictureLayout.asked`), and only those three pages keep their picture read (`near`). Nothing here
/// saves, shares or copies a picture.
struct HistoryGalleryView: View {
  let open: HistoryGalleryOpen
  /// This session's pictures as its reader holds them, by `HistoryPictureLayout.key`.
  let pictures: [String: HistoryPictureFace]
  /// Asks for a picture at a size, by the attachment's id.
  let need: (String, HistoryPictureSize) -> Void

  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// The row's pictures as they stood when the viewer opened. Kept as they were: the reader lets a tile's bytes
  /// go to make room for the larger pictures this viewer asks for, and a page must not leave under a finger.
  @State private var members: [HistoryAttached]
  /// The picture shown, by its id: written by the pager as a swipe lands, and by a press on a thumbnail.
  @State private var shown: String?
  /// The pager is at rest. A zoomed picture that was swiped away goes back to fitted only then, when it is off
  /// the screen, so it does not change size while it is still sliding out.
  @State private var resting = true

  init(
    open: HistoryGalleryOpen, pictures: [String: HistoryPictureFace],
    need: @escaping (String, HistoryPictureSize) -> Void
  ) {
    self.open = open
    self.pictures = pictures
    self.need = need
    let row = HistoryPictureLayout.gallery(open.attached, faces: pictures)
    _members = State(initialValue: row)
    _shown = State(initialValue: HistoryPictureLayout.opened(open.id, among: row))
  }

  /// The words of the picture shown: the viewer's name, and what `Done` closes.
  private var words: String {
    members.first { $0.id == shown }?.words ?? members.first?.words ?? ""
  }

  var body: some View {
    VStack(spacing: 0) {
      head
      Rectangle()
        .fill(ChromePalette.cardHairline)
        .frame(height: 0.5)
      pager
      if members.count > 1 { rail }
    }
    .background(ChromePalette.paper.ignoresSafeArea())
    .onChange(of: shown, initial: true) { _, now in
      for id in HistoryPictureLayout.asked(around: now, among: members) { need(id, .preview) }
      // the row's tiles are on screen here too, on the rail and in the document behind: asking for one that is
      // held counts as a use, so the larger pictures read here do not push this row's tiles out of the reader's
      // memory, and one that was let go is read again before the viewer closes
      for one in members { need(one.id, .tile) }
    }
  }

  /// The head, the whole message's: the name, one line, and `Done`.
  private var head: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(verbatim: words)
        .font(ChromeType.sans(15, .semibold))
        .foregroundStyle(ChromePalette.ink)
        .lineLimit(1)
        .truncationMode(.middle)
      Spacer(minLength: 8)
      Button("Done") { dismiss() }
        .font(ChromeType.sans(15, .medium))
        .foregroundStyle(ChromePalette.inkSecondary)
        .frame(minWidth: 44, minHeight: 44, alignment: .trailing)
    }
    .padding(.leading, 20)
    .padding(.trailing, 16)
  }

  /// The pictures, a page each, side by side: a swipe goes to the next or the previous and lands on a page.
  private var pager: some View {
    ScrollViewReader { proxy in
      ScrollView(.horizontal) {
        LazyHStack(spacing: 0) {
          ForEach(members) { one in
            HistoryGalleryPage(
              attached: one, desktop: open.desktop,
              tile: pictures[HistoryPictureLayout.key(one.id, .tile)],
              preview: pictures[HistoryPictureLayout.key(one.id, .preview)],
              pressed: one.id == open.id ? open.tile : nil,
              fits: resting && one.id != shown,
              near: HistoryPictureLayout.near(one.id, to: shown, among: members)
            )
            .containerRelativeFrame([.horizontal, .vertical])
          }
        }
        .scrollTargetLayout()
      }
      .scrollTargetBehavior(.paging)
      .scrollPosition(id: $shown)
      .scrollIndicators(.hidden)
      .onScrollPhaseChange { _, phase in resting = phase == .idle }
      .onAppear {
        // the page of the picture pressed, said to the scroll view itself as well: a lazy row is not relied on
        // to open where its binding stood before it was laid out
        if let first = HistoryPictureLayout.opened(open.id, among: members) {
          proxy.scrollTo(first, anchor: .center)
        }
      }
    }
  }

  /// The room's rail: its caption and count, and the row's pictures as thumbnails, the one shown kept in view.
  private var rail: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 12) {
        Text("Images in this row")
        Spacer(minLength: 0)
        if let count = HistoryPictureLayout.counter(shown, among: members) {
          Text(verbatim: count).monospacedDigit()
        }
      }
      .font(ChromeType.sans(10.5))
      .foregroundStyle(ChromePalette.inkTertiary)
      .padding(.horizontal, 16)
      ScrollViewReader { proxy in
        ScrollView(.horizontal) {
          HStack(spacing: HistoryPictureLayout.gap) {
            ForEach(members) { one in
              HistoryGalleryThumb(
                attached: one, face: pictures[HistoryPictureLayout.key(one.id, .tile)],
                pressed: one.id == open.id ? open.tile : nil, isShown: one.id == shown
              ) {
                withAnimation(reduceMotion ? nil : FieldMotion.ease(0.3)) { shown = one.id }
              }
            }
          }
          .padding(.horizontal, 16)
          // the ring's own room, so a ringed thumbnail is not cut at the rail's edge
          .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
        .onChange(of: shown, initial: true) { _, now in
          guard let now else { return }
          withAnimation(reduceMotion ? nil : FieldMotion.ease(0.3)) { proxy.scrollTo(now, anchor: .center) }
        }
      }
    }
    .padding(.top, 10)
    .padding(.bottom, 8)
    .overlay(alignment: .top) {
      Rectangle()
        .fill(ChromePalette.cardHairline)
        .frame(height: 0.5)
    }
  }
}

/// One picture's page in the viewer. The larger size the desktop makes (at most 1,600 pixels on its long side)
/// is read while the page is shown or beside the one shown, and the tile's picture stands in until it is: the
/// pressed tile's own at once, on the page the viewer opened on, and on another page its tile's bytes, read
/// here. With the larger picture read the page zooms and pans (`HistoryPictureScroll`). The stand-in does not
/// zoom: it is the tile's square crop, and there is nothing more in it to see.
struct HistoryGalleryPage: View {
  let attached: HistoryAttached
  /// The desktop the session is on, for the line under a picture that is being read, or did not arrive.
  let desktop: String
  /// The tile's face as the reader holds it; nil where it holds none.
  let tile: HistoryPictureFace?
  /// The larger picture's face as the reader holds it; nil until it is asked for.
  let preview: HistoryPictureFace?
  /// The pressed tile's own picture, on the page the viewer opened on.
  let pressed: UIImage?
  /// The pager rests on another page: this one goes back to fitted.
  let fits: Bool
  /// Shown, or beside the one shown: its larger picture is kept read.
  let near: Bool

  @Environment(\.displayScale) private var scale
  /// The page's size, in points; nothing until it is laid out.
  @State private var page: CGSize = .zero
  /// The larger picture, read. View state only: it goes when the page is no longer near, and with the viewer.
  @State private var whole: UIImage?
  /// The bytes that arrived are no picture the phone reads.
  @State private var unreadable = false
  /// The tile's picture, read from its held bytes, on a page that is not the pressed tile's.
  @State private var small: UIImage?

  /// What is read and to how many pixels, and whether it is kept: the picture is read again when any changes.
  private struct Reading: Equatable {
    let data: Data?
    let across: Int
    let near: Bool
  }

  private var heldWhole: Data? {
    if case .held(let data)? = preview { return data }
    return nil
  }

  private var heldSmall: Data? {
    if case .held(let data)? = tile { return data }
    return nil
  }

  /// The larger picture did not arrive, or did not read as one: the tile's stays, and the line under it says so.
  private var failed: Bool { preview == .failed || unreadable }

  /// The pixels the larger picture is read to, across: what its furthest zoom can show. The decode never reads
  /// more than the picture has (`HistoryPictureLayout.longSide`), and the desktop sends at most 1,600 on the long
  /// side, so this is the whole of what was sent: at most some 10 MB of pixels a page, for three pages.
  private var pixels: Int {
    let across = max(0, page.width - 2 * HistoryPictureLayout.pageMargin)
    return HistoryPictureLayout.pixels(across * HistoryPictureLayout.zoomMost, scale: scale)
  }

  var body: some View {
    ZStack {
      if let whole {
        HistoryPictureZoom(picture: whole, words: attached.words, fits: fits)
      } else {
        VStack(spacing: 10) {
          standIn
          HistoryPictureNote(
            words: failed ? "full size on \(desktop)" : "Reading from \(desktop)…", waiting: !failed)
        }
        .padding(HistoryPictureLayout.pageMargin)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .onGeometryChange(for: CGSize.self) { $0.size } action: { page = $0 }
    .task(id: Reading(data: heldWhole, across: pixels, near: near)) { await readWhole() }
    .task(id: heldSmall) { await readSmall() }
  }

  /// The tile's picture standing in, inside the tile's corners and hairline; where the reader holds none, the
  /// tile's own square with the glyph, breathing while the larger picture is on its way.
  @ViewBuilder
  private var standIn: some View {
    let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
    if let picture = pressed ?? small {
      Image(uiImage: picture)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .clipShape(shape)
        .overlay { shape.strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5) }
        .accessibilityLabel(attached.words)
        .accessibilityAddTraits(.isImage)
    } else {
      shape.fill(ChromePalette.fill)
        .aspectRatio(1, contentMode: .fit)
        .overlay {
          HistoryPictureGlyph(size: 12, waiting: !failed)
            .foregroundStyle(ChromePalette.inkT4)
        }
        .overlay { shape.strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(attached.words)
    }
  }

  /// Reads the held bytes to the pixels the picture's furthest zoom shows, off the main actor, while the page is
  /// near. A page further off lets its pixels go: the reader still holds its bytes, under its bound. With no
  /// bytes held it keeps what it read: a picture the reader let go while its page is up stays on the page.
  private func readWhole() async {
    guard near else {
      whole = nil
      unreadable = false
      return
    }
    guard let data = heldWhole, page.width > 0 else { return }
    let image = await HistoryPictureDecode.image(data, across: pixels)
    guard !Task.isCancelled else { return }
    whole = image
    unreadable = image == nil
  }

  /// Reads the tile's bytes at the size a tile is drawn, for the stand-in, where the pressed tile's own picture
  /// is not this page's.
  private func readSmall() async {
    guard pressed == nil, let data = heldSmall else { return }
    let across = HistoryPictureLayout.pixels(HistoryPictureLayout.tile, scale: scale)
    let image = await HistoryPictureDecode.image(data, across: across)
    guard !Task.isCancelled else { return }
    small = image
  }
}

/// One picture on the viewer's rail: its tile's picture whole inside a square on the fill, the room's thumbnail.
/// The one shown is ringed in the ink, 1.5 pt inside (§2.3's ring; the phone's chrome carries no select hue).
struct HistoryGalleryThumb: View {
  let attached: HistoryAttached
  /// The tile's face as the reader holds it; nil where it holds none.
  let face: HistoryPictureFace?
  /// The pressed tile's own picture, on the thumbnail of the picture the viewer opened on.
  let pressed: UIImage?
  let isShown: Bool
  let press: () -> Void

  @Environment(\.displayScale) private var scale
  /// The tile's bytes, read at the thumbnail's size. View state only.
  @State private var picture: UIImage?

  private var held: Data? {
    if case .held(let data)? = face { return data }
    return nil
  }

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: 9, style: .continuous)
    Button(action: press) {
      ZStack {
        if let picture = pressed ?? picture {
          Image(uiImage: picture)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
            .padding(HistoryPictureLayout.thumbInset)
        } else {
          HistoryPictureGlyph(size: 12, waiting: face == .waiting)
            .foregroundStyle(ChromePalette.inkT4)
        }
      }
      .frame(width: HistoryPictureLayout.thumb, height: HistoryPictureLayout.thumb)
      .background(shape.fill(ChromePalette.fill))
      .overlay {
        shape.strokeBorder(
          isShown ? ChromePalette.ink : ChromePalette.cardHairline, lineWidth: isShown ? 1.5 : 0.5)
      }
      .contentShape(shape)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(attached.words)
    .accessibilityAddTraits(isShown ? [.isImage, .isSelected] : .isImage)
    .task(id: held) { await read() }
  }

  /// Reads the tile's bytes at the size a thumbnail is drawn, off the main actor.
  private func read() async {
    guard pressed == nil, let data = held else { return }
    let across = HistoryPictureLayout.pixels(HistoryPictureLayout.thumb, scale: scale)
    let image = await HistoryPictureDecode.image(data, across: across)
    guard !Task.isCancelled else { return }
    picture = image
  }
}

/// The larger picture on its page, which zooms and pans (`HistoryPictureScroll`).
private struct HistoryPictureZoom: UIViewRepresentable {
  let picture: UIImage
  /// The picture's spoken name.
  let words: String
  /// The pager rests on another page: this one goes back to fitted.
  let fits: Bool

  func makeUIView(context: Context) -> HistoryPictureScroll { HistoryPictureScroll() }

  func updateUIView(_ page: HistoryPictureScroll, context: Context) {
    page.show(picture, spoken: words)
    if fits { page.fit() }
  }
}

/// A picture's page in the viewer: a scroll view that zooms. Fitted, the picture stands whole inside the page,
/// at its centre (`HistoryPictureLayout.fitted(width:height:inside:margin:)`, `centred`), and the page takes no
/// drag for itself, so a swipe left or right is the viewer's pager's. A pinch takes the picture up to `zoomMost`
/// times that; a double tap goes to `zoomTap` times, about the point tapped, and back to fitted; a zoomed
/// picture pans, and at its own edge the pager has the drag again. The corners and the hairline keep their
/// size on screen whatever the zoom.
final class HistoryPictureScroll: UIScrollView, UIScrollViewDelegate {
  private let drawn = UIImageView()
  private let hairline = UIColor(ChromePalette.cardHairline)
  /// The page's size the picture was last fitted inside: the fit is made again only when the page's size
  /// changes, or another picture is shown.
  private var fittedPage: CGSize = .zero

  init() {
    super.init(frame: .zero)
    delegate = self
    minimumZoomScale = 1
    maximumZoomScale = HistoryPictureLayout.zoomMost
    // a fitted picture is no larger than its page, and the page gives under no pull: the drag is the pager's
    alwaysBounceVertical = false
    alwaysBounceHorizontal = false
    showsVerticalScrollIndicator = false
    showsHorizontalScrollIndicator = false
    // the room around the picture is this page's own reckoning (`centre`), never the safe area's
    contentInsetAdjustmentBehavior = .never
    drawn.clipsToBounds = true
    drawn.layer.cornerCurve = .continuous
    drawn.isAccessibilityElement = true
    drawn.accessibilityTraits = .image
    addSubview(drawn)
    let twice = UITapGestureRecognizer(target: self, action: #selector(tappedTwice(_:)))
    twice.numberOfTapsRequired = 2
    addGestureRecognizer(twice)
    // the hairline is a layer's colour, which does not follow the appearance by itself
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (page: HistoryPictureScroll, _: UITraitCollection) in
      page.edge()
    }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  /// The picture to show, and its spoken name. The same picture shown again changes nothing, so a zoom is kept
  /// through every redraw of the viewer; another picture starts fitted.
  func show(_ picture: UIImage, spoken words: String) {
    drawn.accessibilityLabel = words
    guard drawn.image !== picture else { return }
    drawn.image = picture
    fittedPage = .zero
    setNeedsLayout()
  }

  /// Back to fitted, at once: a picture that is no longer the one shown.
  func fit() {
    guard zoomScale != 1 else { return }
    setZoomScale(1, animated: false)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard bounds.width > 0, bounds.height > 0, bounds.size != fittedPage, let picture = drawn.image else { return }
    fittedPage = bounds.size
    // a picture shown anew, and a page whose size changed, start fitted: the frame is set at no zoom
    zoomScale = 1
    let size = HistoryPictureLayout.fitted(
      width: picture.size.width, height: picture.size.height, inside: bounds.size,
      margin: HistoryPictureLayout.pageMargin)
    drawn.frame = CGRect(origin: .zero, size: size)
    contentSize = size
    centre()
    edge()
  }

  /// Stands the picture at the page's centre while it is the smaller, by the room at each side of it; a picture
  /// zoomed past the page has none, and pans to its own edges.
  private func centre() {
    let room = HistoryPictureLayout.centred(contentSize, on: bounds.size)
    contentInset = UIEdgeInsets(top: room.y, left: room.x, bottom: room.y, right: room.x)
    if zoomScale <= 1 { contentOffset = CGPoint(x: -room.x, y: -room.y) }
  }

  /// The tile's corners and hairline, at the size they are on screen whatever the zoom: the layer is zoomed with
  /// its picture, so each is set smaller as the picture is drawn larger.
  private func edge() {
    let zoom = max(zoomScale, 0.1)
    drawn.layer.cornerRadius = 10 / zoom
    drawn.layer.borderWidth = 0.5 / zoom
    drawn.layer.borderColor = hairline.resolvedColor(with: traitCollection).cgColor
  }

  func viewForZooming(in scrollView: UIScrollView) -> UIView? { drawn }

  func scrollViewDidZoom(_ scrollView: UIScrollView) {
    centre()
    edge()
  }

  /// A double tap: from fitted to `zoomTap` times about the point tapped, and from any zoom back to fitted. The
  /// system's own zoom animation; none under Reduce Motion.
  @objc private func tappedTwice(_ tap: UITapGestureRecognizer) {
    let moves = !UIAccessibility.isReduceMotionEnabled
    let next = HistoryPictureLayout.tapped(from: zoomScale)
    guard next > 1 else {
      setZoomScale(1, animated: moves)
      return
    }
    zoom(
      to: HistoryPictureLayout.zoomRect(around: tap.location(in: drawn), page: bounds.size, zoom: next),
      animated: moves)
  }
}

/// The quiet line under a picture's stand-in on its page, in the cut mark's voice (`HistoryCutNote`): that the
/// larger picture is being read, or, when it did not arrive, where the full size is.
struct HistoryPictureNote: View {
  let words: String
  var waiting = false

  var body: some View {
    HStack(spacing: 6) {
      HistoryPictureGlyph(size: 10.5, waiting: waiting)
      Text(verbatim: words)
        .font(ChromeType.sans(11.5))
        .lineLimit(1)
    }
    .foregroundStyle(ChromePalette.inkTertiary)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(words)
  }
}
