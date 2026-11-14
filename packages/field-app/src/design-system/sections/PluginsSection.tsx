import type { ReactElement } from "react";
import { Section, Specimen } from "../catalog-ui";
import { PluginsPlate } from "../PluginsPreview";

// Plugins (MK-4a; DESIGN.md §8 "Plugins — the frame's second popup"): the
// frame's second popup as it opens today, on fixture ports — the shipping
// controller in each state the read can be in, a plugin's page, read only
// (MK-4c), Updates carrying the Me row's count, (MK-4c2a) a plugin's switches
// and (MK-4c2b) its settings, and (MK-4e) Discover's shelf over a list held, with
// the page of a set this desktop doesn't have. Updates' rows come with a later
// MK-4 part. MK-O3D: Discover's community tile and its ask, and a community
// plugin held while community plugins are off.

export function PluginsSection(): ReactElement {
  return (
    <Section
      id="plugins"
      index="11b"
      eyebrow="Plugins"
      title="The frame's second popup"
      description="One place for plugins, built the way search is: the same materials over the same scrim, its field, its switch and its foot. Each opening shows the plugin list VibeField holds at once and reads it once. Installed lists what this desktop has. No build configures a plugin list yet, so Discover says there is nothing to discover and offers Installed."
    >
      <Specimen title="Discover — no plugin list yet" source="frame/plugins/PluginsView.tsx" bleed>
        <PluginsPlate state="no-registry" />
      </Specimen>
      <Specimen
        title="Installed — what this desktop has, Built in first"
        source="frame/plugins/plugins-model.ts"
        bleed
      >
        <PluginsPlate state="installed" />
      </Specimen>
      <Specimen
        title="Reading the plugin list, with none held"
        source="frame/plugins/Plugins.tsx"
        bleed
      >
        <PluginsPlate state="reading" />
      </Specimen>
      <Specimen title="Offline, with no list held" source="frame/plugins/plugins-words.ts" bleed>
        <PluginsPlate state="offline" />
      </Specimen>
      <Specimen
        title="A list VibeField couldn't use, with none held"
        source="frame/plugins/plugins-words.ts"
        bleed
      >
        <PluginsPlate state="refused" />
      </Specimen>
      <Specimen
        title="Discover — a list held of one set, featured"
        source="frame/plugins/plugins-shelf.ts"
        bleed
      >
        <PluginsPlate state="held" />
      </Specimen>
      <Specimen
        title="Discover's shelf — the featured set, then VibeField's, one needing a newer VibeField"
        source="frame/plugins/PluginsShelf.tsx · frame/plugins/plugins-shelf.ts"
        bleed
      >
        <PluginsPlate state="shelf" />
      </Specimen>
      <Specimen
        title="A set this desktop doesn't have — its page, read from the list"
        source="frame/plugins/plugins-shelf.ts"
        bleed
      >
        <PluginsPlate state="shelf-page" />
      </Specimen>
      <Specimen
        title="VibeField's plugins don't answer"
        source="frame/plugins/plugins-words.ts"
        bleed
      >
        <PluginsPlate state="away" />
      </Specimen>
      <Specimen
        title="A plugin's page, read only — one that comes with VibeField"
        source="frame/plugins/PluginsView.tsx · frame/plugins/plugins-model.ts"
        bleed
      >
        <PluginsPlate state="page" />
      </Specimen>
      <Specimen
        title="A plugin's page — a community plugin the list names"
        source="frame/plugins/plugins-model.ts"
        bleed
      >
        <PluginsPlate state="page-listed" />
      </Specimen>
      <Specimen title="Updates, carrying its count" source="frame/plugins/PluginsView.tsx" bleed>
        <PluginsPlate state="count" />
      </Specimen>
      <Specimen
        title="A plugin's switches — its one switch and its powers', one taken back, one it can't have"
        source="frame/plugins/PluginsView.tsx · frame/plugins/plugins-model.ts"
        bleed
      >
        <PluginsPlate state="switches" />
      </Specimen>
      <Specimen
        title="A plugin in development, turned off — its powers wait for it"
        source="frame/plugins/plugins-model.ts"
        bleed
      >
        <PluginsPlate state="switches-off" />
      </Specimen>
      <Specimen
        title="A plugin's switches while VibeField's plugins don't answer"
        source="frame/plugins/Plugins.tsx"
        bleed
      >
        <PluginsPlate state="switches-away" />
      </Specimen>
      <Specimen
        title="A plugin's settings — one of each kind, and one it can't draw"
        source="frame/plugins/PluginSettings.tsx · frame/plugins/plugins-model.ts"
        bleed
      >
        <PluginsPlate state="settings" />
      </Specimen>
      <Specimen
        title="A plugin in development, turned off — its settings wait for it"
        source="frame/plugins/PluginSettings.tsx"
        bleed
      >
        <PluginsPlate state="settings-off" />
      </Specimen>
      <Specimen
        title="A plugin whose settings all stay on this desktop"
        source="frame/plugins/plugins-words.ts"
        bleed
      >
        <PluginsPlate state="settings-here" />
      </Specimen>
      <Specimen
        title="A plugin's settings — one VibeField couldn't load"
        source="frame/plugins/PluginSettings.tsx · frame/plugins/plugins-words.ts"
        bleed
      >
        <PluginsPlate state="settings-unread" />
      </Specimen>
      <Specimen
        title="Discover's community tile — community plugins off"
        source="frame/plugins/CommunityTile.tsx · frame/plugins/plugins-community.ts"
        bleed
      >
        <PluginsPlate state="community" />
      </Specimen>
      <Specimen
        title="Turning community plugins on — the ask, with its statement"
        source="frame/plugins/CommunityTile.tsx · frame/plugins/plugins-words.ts"
        bleed
      >
        <PluginsPlate state="community-ask" />
      </Specimen>
      <Specimen
        title="Installed — a community plugin held while community plugins are off"
        source="frame/plugins/plugins-model.ts"
        bleed
      >
        <PluginsPlate state="community-held" />
      </Specimen>
      <Specimen
        title="A held community plugin's page"
        source="frame/plugins/PluginsView.tsx · frame/plugins/plugins-model.ts"
        bleed
      >
        <PluginsPlate state="community-held-page" />
      </Specimen>
    </Section>
  );
}
