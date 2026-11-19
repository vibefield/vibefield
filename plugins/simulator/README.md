# iOS Simulator

Run iPhones from Xcode on your desk: choose a model and an iOS version, then tap and type into them.

`vibefield.simulator` is one of VibeField's official plugins. It ships Built in with the app, because most of what
it needs lives in the app, outside this folder (below).

## What your Mac needs

- macOS. It is for Macs; on another system VibeField does not load it.
- Xcode, the full app. The Command Line Tools alone have no iOS simulator.
- Xcode's license accepted, and its first launch finished.
- At least one iOS runtime, installed from Xcode Settings → Components.

The plugin's setup dialog has the app check these in turn, and offers the next step: Install Xcode, Select Xcode,
Accept the Xcode license, Finish setting up Xcode, Install an iOS runtime.

## Its powers

The plugin's page says them in these words:

- "Show live windows on the desk"
- "Make and run iPhone simulators from Xcode, and use them on the desk"

It holds no other power.

## What lives outside this folder

The plugin draws the iPhone, its faces and its setup dialog. The app does the rest, which no plugin package can
carry:

- **The simulator service**, in the app's main process (`packages/electron-shell/src/main/live-surfaces/`). It is
  the only part that runs Xcode's `simctl`, and it runs only `list`, `boot`, `shutdown`, `create` and `bootstatus`;
  it never deletes.
- **The setup check** of Xcode, its license and its runtimes, with the Mac App Store and Xcode openers, reached
  through the app's own messages.
- **The native capture helper** (`apps/desktop/native/macos/live-surface-capture/`). It reads the simulated device's
  screen, and it sends your taps and keys to the device.
- **The SDK's setup door**, `SimulatorSetup` (`packages/plugin-sdk/src/desk.ts`).
- **The desk's lending of devices** to the object (`packages/field-app/src/surfaces/live/simulator-devices.ts`).

So the plugin works only inside a VibeField that carries these. That is why it ships Built in: a copy from a market
alone would not have them.

## Two generated files

Both are committed, and every build uses them as committed. No build, test or check re-makes them.

- **`src/catalog.gen.ts`: the iPhones this plugin can draw.** That is 42, from Xcode 26.6's simulator data, merged
  with the bodies' published sizes.
  - Re-made by hand on a Mac with Xcode: `pnpm --filter @vibefield/plugin-simulator gen:catalog`, then biome on the
    file.
  - A newer Xcode's iPhone needs its row in the maker's `SPECS` first.
- **`src/face-words.gen.ts`: the faces' words as a still draws them**, drawn with the fonts of the Mac that made the
  file.
  - Re-made by hand: `pnpm --filter @vibefield/plugin-simulator exec tsx scripts/make-face-words.ts`.
  - It is made on one Mac and never re-made over by another; the commit that re-makes it says so.
  - In the app, the words are drawn live with your own fonts.

Each maker's header says how to run it.

## Development

- In a checkout, `pnpm dev` finds this plugin in the repo's `plugins/` folder, the development layout's plugin root.
- After editing `src/manifest.ts`, emit `vibefield.plugin.json` with
  `pnpm --filter @vibefield/plugin-simulator gen:manifest`. Never edit the JSON by hand.
- Tests: `pnpm --filter @vibefield/plugin-simulator test`.
- `test/still.golden.json` holds the stills as one Mac's GPU drew them. `pnpm still` compares the plugin's stills
  with it; it is bound to that Mac and runs out of CI. Another Mac re-blesses locally and never commits over it.

| file | what it is |
| --- | --- |
| `src/manifest.ts` | the durable half: the plugin's powers, and the object's type, props, size and tray entry |
| `src/object.ts` | the object's code half, the export the manifest's `binding.kind` names (`simulator`) |
| `src/kind.ts` | how the iPhone is drawn, and where it lies on the desk |
| `src/law.ts` | how an iPhone lies on the desk and is seen there, and its model looked up in the catalog |
| `src/model.ts` | what one iPhone model is, as data |
| `src/binding.ts`, `src/live.ts` | the device an iPhone is bound to (a model and an iOS version), and its screen |
| `src/face.ts`, `src/notice.ts` | the honest faces, in DESIGN.md §9's words |
| `src/setup-dialog.ts`, `src/setup-view.ts` | the setup dialog: what this Mac lacks, and the model and version picker |
| `playground/states.ts` | the states the kit's harness and the stills drive it through |
| `test/still.golden.json` | the stills' golden, made on one Mac |

## Known limits

- **It uses Apple's private simulator frameworks**, CoreSimulator and SimulatorKit, loaded from the Mac's developer
  folders and from Xcode while it runs. An Xcode update can break it until VibeField follows.
- **A newer Xcode's iPhones wear the iPhone 17 Pro's body** until the catalog is re-made, and their screens are fitted
  to the 17 Pro's. The picker still lists every iPhone your Xcode has, and a new one's name is read from its device
  type.
- **The simulator devices it makes stay on your Mac.**
  - An iPhone you set up gets a device of its own, named `VibeField <model> [<tag>]`.
  - VibeField shuts it down ten minutes after the last iPhone using it lets go, and when VibeField quits.
  - One left running because VibeField ended without its quit (a crash, a Force Quit) runs on until an iPhone asks
    for it again. VibeField then knows it as its own, from a record it keeps of the devices it booted, and shuts it
    down as above.
  - An iPhone set up by an older version of the plugin, or shown through the Simulator app's window (a development
    switch), uses a device that VibeField does not shut down.
  - VibeField never deletes one.
