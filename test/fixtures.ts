import type { AppearanceProp, PropName, PropsSchema } from "../src/core/types";

export const wheelProps = {
  data: {
    people: { type: "data", description: "household members", sample: [{ name: "Kai" }, { name: "Roz" }] },
  },
  appearance: {
    spinSeconds: { type: "number", label: "Spin time", default: 1.5, min: 0.3, max: 5, step: 0.1, unit: "s" },
    accent: { type: "color", label: "Accent", default: "#ff2bd6" },
    density: { type: "enum", label: "Density", default: "roomy", options: ["compact", "roomy"] },
    showOdds: { type: "boolean", label: "Show odds", default: true },
    headline: { type: "text", label: "Headline", default: "Who's up?" },
  },
};

export const spin: AppearanceProp = {
  name: "spinSeconds" as PropName,
  type: "number",
  label: "Spin time",
  default: 1.5,
  min: 0.3,
  max: 5,
  step: 0.1,
  unit: "s",
};
export const accent: AppearanceProp = { name: "accent" as PropName, type: "color", label: "Accent", default: "#ff2bd6" };
export const density: AppearanceProp = {
  name: "density" as PropName,
  type: "enum",
  label: "Density",
  default: "roomy",
  options: ["compact", "roomy"],
};
export const showOdds: AppearanceProp = { name: "showOdds" as PropName, type: "boolean", label: "Show odds", default: true };
export const headline: AppearanceProp = {
  name: "headline" as PropName,
  type: "text",
  label: "Headline",
  default: "Who's up?",
  multiline: false,
};

export const parsedWheel: PropsSchema = {
  data: [
    { name: "people" as PropName, type: "data", description: "household members", sample: [{ name: "Kai" }, { name: "Roz" }] },
  ],
  appearance: [spin, accent, density, showOdds, headline],
};
