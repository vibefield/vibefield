import { MESHDATA_INBOUND_LANE_ID_BASE } from "@vibefield/contracts";

/**
 * The single minting authority for every lane fieldd opens during one boot.
 *
 * field-native owns ids at and above MESHDATA_INBOUND_LANE_ID_BASE. We never
 * wrap inside a boot: wrapping could alias a still-live lane, while exhausting
 * four billion ids is already a fatal lifecycle leak worth reporting loudly.
 */
export class OutboundLaneIdAllocator {
  #next: number;

  constructor(first = 1) {
    if (!Number.isSafeInteger(first) || first < 1 || first >= MESHDATA_INBOUND_LANE_ID_BASE) {
      throw new RangeError(`invalid first outbound lane id: ${first}`);
    }
    this.#next = first;
  }

  allocate = (): number => {
    if (this.#next >= MESHDATA_INBOUND_LANE_ID_BASE) {
      throw new Error("outbound mesh lane id space exhausted for this boot");
    }
    return this.#next++;
  };
}
