import type { PlaygroundInteractResult } from '@midscene/playground';

// Keep pointer/keyboard ordering, but discard clicks queued against an old
// screen after a failure. A timed-out operation must never be retried blindly.
export class ManualControlQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private generation = 0;

  enqueue(
    task: () => Promise<PlaygroundInteractResult>,
  ): Promise<PlaygroundInteractResult> {
    const generation = this.generation;
    const nextTask = this.tail.then(async () => {
      if (generation !== this.generation) {
        return {
          ok: false,
          error: 'Queued operation cancelled after a previous control failure.',
        };
      }
      let result: PlaygroundInteractResult;
      try {
        result = await task();
      } catch (error) {
        result = {
          ok: false,
          error:
            error instanceof Error ? error.message : 'Manual control failed',
        };
      }
      if (!result.ok) this.generation++;
      return result;
    });
    this.tail = nextTask;
    return nextTask;
  }
}

export type ManualDragActionType = 'Swipe' | 'DragAndDrop';

export function buildManualDragInteractPayload(
  actionType: ManualDragActionType,
  start: { x: number; y: number },
  end: { x: number; y: number },
  duration: number,
) {
  const basePayload = {
    actionType,
    x: start.x,
    y: start.y,
    endX: end.x,
    endY: end.y,
  };

  if (actionType === 'DragAndDrop') {
    return basePayload;
  }

  return {
    ...basePayload,
    duration,
  };
}

export function buildManualScrollInteractPayload(
  point: { x: number; y: number },
  delta: { deltaX: number; deltaY: number },
) {
  const useVertical = Math.abs(delta.deltaY) >= Math.abs(delta.deltaX);
  const rawDistance = useVertical
    ? Math.abs(delta.deltaY)
    : Math.abs(delta.deltaX);
  const direction = useVertical
    ? delta.deltaY >= 0
      ? 'down'
      : 'up'
    : delta.deltaX >= 0
      ? 'right'
      : 'left';

  return {
    actionType: 'Scroll',
    x: point.x,
    y: point.y,
    scrollType: 'singleAction',
    direction,
    distance: Math.max(1, Math.round(rawDistance)),
  };
}
