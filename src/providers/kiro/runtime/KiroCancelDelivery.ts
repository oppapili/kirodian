export const KIRO_CANCEL_DELIVERY_GRACE_MS = 250;

export interface KiroFlushableTransport {
  flush(): Promise<void>;
}

export function waitForKiroCancelDelivery(
  transport: KiroFlushableTransport | null | undefined,
): Promise<void> {
  let delivery: Promise<void>;
  try {
    delivery = transport?.flush() ?? Promise.resolve();
  } catch {
    delivery = Promise.resolve();
  }

  return new Promise(resolve => {
    const timeout = window.setTimeout(resolve, KIRO_CANCEL_DELIVERY_GRACE_MS);
    void delivery.then(
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
    );
  });
}
