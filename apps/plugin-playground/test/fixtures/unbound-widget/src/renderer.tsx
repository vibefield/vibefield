// CONTROL FIXTURE — declares two widgets, registers one.
//
// §11.4 containment, applied to the verdict table: the forgotten type costs
// itself its rows and nothing else. If a missing binding took the whole plugin
// down, an author with nineteen healthy widgets and one typo would be told
// nothing about the nineteen.
import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import type { ReactElement } from "react";

function BoundCard(): ReactElement {
  return <div className="fixture-card">bound</div>;
}

export default defineRendererPlugin({
  activate(ctx) {
    ctx.widgets.register({
      type: "vibefield.fixture-unbound.bound",
      binding: { component: BoundCard },
    });
    // vibefield.fixture-unbound.forgotten is declared and never registered.
  },
});
