/**
 * Buffer filesystem events until the consumer that can safely act on them is
 * ready. Attaching is synchronous, so an event is either in the drained set or
 * delivered directly; there is no unobserved hand-off window.
 */
export function createChangeBuffer() {
  const pending = new Set();
  let consumer = null;

  return {
    push(value) {
      if (consumer === null) {
        pending.add(value);
        return;
      }
      consumer(value);
    },
    attach(next) {
      if (consumer !== null) throw new Error("change buffer already has a consumer");
      consumer = next;
      const buffered = [...pending];
      pending.clear();
      for (const value of buffered) consumer(value);
    },
    get size() {
      return pending.size;
    },
  };
}
