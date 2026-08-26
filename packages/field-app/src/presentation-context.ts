/** Bounded, informational product state that a development host may observe. */
export interface ProductPresentationContext {
  theme: "light" | "dark";
  zoom: number;
}

export type ProductPresentationContextReporter = (context: ProductPresentationContext) => void;
