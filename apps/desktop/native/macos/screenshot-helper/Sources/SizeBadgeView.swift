import AppKit

final class SizeBadgeView: NSView {
    private let label = NSTextField(labelWithString: "")

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true

        let pad = NSView(frame: .zero)
        label.font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .medium)
        label.textColor = .labelColor
        label.alignment = .center
        label.isBezeled = false
        label.isEditable = false
        label.isSelectable = false
        label.drawsBackground = false
        label.translatesAutoresizingMaskIntoConstraints = false
        pad.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: pad.leadingAnchor, constant: 10),
            label.trailingAnchor.constraint(equalTo: pad.trailingAnchor, constant: -10),
            label.topAnchor.constraint(equalTo: pad.topAnchor, constant: 4),
            label.bottomAnchor.constraint(equalTo: pad.bottomAnchor, constant: -4),
        ])
        _ = LiquidGlass.embed(pad, in: self, cornerRadius: 12, style: .regular)
        isHidden = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        nil
    }

    func set(size: CGSize) {
        label.stringValue = "\(Int(size.width)) × \(Int(size.height))"
        let width = ceil(label.fittingSize.width) + 20
        setFrameSize(NSSize(width: max(width, 60), height: 24))
        isHidden = false
    }
}
