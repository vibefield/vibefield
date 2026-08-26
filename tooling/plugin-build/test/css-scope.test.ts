import { describe, expect, it } from "vitest";
import { assertPluginCssIsScoped, pluginStyleRoot, scopePluginCss } from "../src/css-scope";

const ID = "com.example.weather";
const ROOT = pluginStyleRoot(ID);

describe("plugin renderer CSS scope projection", () => {
  it("roots theme, utilities, authored selectors, dark context, and keyframes", () => {
    const output = scopePluginCss(
      `
@layer theme {
  :root, :host { --spacing: 0.25rem; }
}
@layer utilities {
  .fixed { position: fixed; }
  .spin { animation: orbit 1s linear infinite; }
}
.dark .muted, [data-theme="dark"] .quiet { opacity: .5; }
.card > button:hover { color: red; }
@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
}
@keyframes orbit { to { transform: rotate(1turn); } }
`,
      ID,
    );

    expect(output).not.toContain("@layer");
    expect(output).not.toMatch(/(^|[,{}])\s*:root\b/);
    expect(output).toContain(`${ROOT} { --spacing: 0.25rem; }`);
    expect(output).toContain(`${ROOT} .fixed`);
    expect(output).toContain(`.dark ${ROOT} .muted`);
    expect(output).toContain(`[data-theme="dark"] ${ROOT} .quiet`);
    expect(output).toContain(`${ROOT} .card > button:hover`);
    expect(output).toContain("@keyframes vf-com-example-weather-orbit");
    expect(output).toContain("animation: vf-com-example-weather-orbit 1s linear infinite");
    expect(() => assertPluginCssIsScoped(output, ID)).not.toThrow();
  });

  it("refuses document selectors instead of silently rewriting global intent", () => {
    expect(() => scopePluginCss("body .card { color: red }", ID)).toThrow(
      /targets body.*wrapper-local selector/,
    );
    expect(() => scopePluginCss("html.dark .card { color: white }", ID)).toThrow(
      /targets html.*wrapper-local selector/,
    );
  });

  it("removes compiler property registrations and refuses other global at-rules", () => {
    const output = scopePluginCss(
      "@property --tw-opacity { syntax: '*'; inherits: false } .faded { opacity: .5 }",
      ID,
    );
    expect(output).not.toContain("@property");
    expect(output).toContain(`${ROOT} .faded`);
    expect(() =>
      scopePluginCss('@font-face { font-family: "Host Collision"; src: url(font.woff2) }', ID),
    ).toThrow(/@font-face is document-global/);
  });

  it("keeps two plugins' common utility names in disjoint selector trees", () => {
    const alpha = scopePluginCss(".flex { display: flex }", "com.example.alpha");
    const beta = scopePluginCss(".flex { display: flex }", "com.example.beta");
    expect(alpha).toContain('[data-vf-plugin="com.example.alpha"] .flex');
    expect(alpha).not.toContain('data-vf-plugin="com.example.beta"');
    expect(beta).toContain('[data-vf-plugin="com.example.beta"] .flex');
    expect(beta).not.toContain('data-vf-plugin="com.example.alpha"');
  });
});
