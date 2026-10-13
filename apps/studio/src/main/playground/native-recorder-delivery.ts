/** Keep order across asynchronous iframe translation and drain before closing. */
export function createRecorderDelivery<
  T extends {
    payload: Record<string, unknown>;
    url: string;
    clickTarget?: string;
    clickCount?: number;
  },
>(
  prepare: (packet: T) => Promise<void>,
  listener: (packet: T) => void,
  onError: (error: unknown) => void,
) {
  let queue = Promise.resolve();
  let pending: T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    const packet = pending;
    pending = undefined;
    if (packet) listener(packet);
  };
  return {
    receive(packet: T) {
      queue = queue
        .then(async () => {
          try {
            await prepare(packet);
          } catch (error) {
            onError(error);
          }
          if (packet.payload.actionType === 'Tap') {
            if (
              packet.clickCount === 2 &&
              packet.clickTarget &&
              pending?.clickTarget === packet.clickTarget &&
              pending.url === packet.url
            ) {
              clearTimeout(timer);
              const first = pending;
              pending = undefined;
              listener({
                ...first,
                payload: { ...first.payload, actionType: 'DoubleClick' },
              });
            } else {
              flush();
              pending = packet;
              timer = setTimeout(flush, 500);
            }
          } else {
            flush();
            listener(packet);
          }
        })
        .catch(onError);
      return queue;
    },
    async drain() {
      await queue;
      flush();
    },
  };
}

/** The receiver must stay open while the document flushes its final input. */
export function stopRecorderDelivery(
  flushDocuments: () => Promise<void>,
  drain: () => Promise<void>,
  disable: () => void,
) {
  return (async () => {
    try {
      await flushDocuments();
    } finally {
      try {
        await drain();
      } finally {
        disable();
      }
    }
  })();
}
