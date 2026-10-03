import { mountLogoStudio } from "@vibefield/field-app/logo-studio";

document.documentElement.dataset.vibefieldSurface = "vibefield-design-catalog-only";
const root = document.getElementById("root");
if (!root) throw new Error("Logo studio: #root is missing.");
mountLogoStudio(root);
