import type { ReactElement } from "react";
import { Section, Specimen } from "../catalog-ui";
import { PluginsPlate } from "../PluginsPreview";

// Plugins (MK-4a; DESIGN.md §8 "Plugins — the frame's second popup"): the
// frame's second popup as it opens today, on fixture ports — the shipping
// controller in each state the read can be in, a plugin's page, read only
// (MK-4c), and Updates carrying the Me row's count. Discover's shelf, Updates'
// rows and Installed's switch come with later MK-4 parts.

export function PluginsSection(): ReactElement {
  return (
    <Section
      id="plugins"
      index="11b"
      eyebrow="Plugins"
      title="The frame's second popup"
      description="One place for plugins, built the way search is: the same materials over the same scrim, its field, its switch and its foot. Each opening shows the plugin list VibeField holds at once and reads it once. Installed lists what this desktop has. No build configures a registry yet, so Discover says so and offers Installed."
    >
      <Specimen
        title="Discover — no plugin registry yet"
        source="frame/plugins/PluginsView.tsx"
        bleed
      >
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
        title="A list held, before Discover's shelf is built"
        source="frame/plugins/plugins-model.ts"
        bleed
      >
        <PluginsPlate state="held" />
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
    </Section>
  );
}
