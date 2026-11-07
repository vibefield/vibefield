import LateAckRunner from "../../late-ack-runner";

// Item 213's probe runner: a LateAckRunner whose vitest-assigned `onTaskUpdate` rejects with LATE_ACK_INJECT after
// every real update, so a child run shows the wrap end to end in seconds rather than through the real 60 s timer. The
// late ack's message is dropped (the run stays green), and any other message passes through (the run reds). Only
// fixtures/late-ack/vitest.config.ts names it.
export default class InjectRunner extends LateAckRunner {
  override onBeforeCollect(): void {
    const send = this.onTaskUpdate;
    const message = process.env.LATE_ACK_INJECT;
    if (send !== undefined && message !== undefined) {
      this.onTaskUpdate = async (packs, events) => {
        await send(packs, events);
        throw new Error(message);
      };
    }
    super.onBeforeCollect();
  }
}
