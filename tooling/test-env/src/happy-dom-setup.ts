// A vitest `setupFiles` entry for a happy-dom suite: the environment's MutationObserver
// survives a garbage collection (./happy-dom.ts says why).
import { holdMutationObserverCallbacks } from "./happy-dom";

holdMutationObserverCallbacks(globalThis);
