import { mountDesignSystem } from "@vibefield/field-app/design-system";

const root = document.getElementById("root");
if (root === null) throw new Error("design system: #root missing from design-system.html");

mountDesignSystem(root);
