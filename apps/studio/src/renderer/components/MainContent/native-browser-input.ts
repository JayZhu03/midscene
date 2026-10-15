import type {
  NativeBrowserInput,
  NativeBrowserModifier,
} from '../../../shared/native-browser';

type InputBody = NativeBrowserInput extends infer I
  ? I extends NativeBrowserInput
    ? Omit<I, 'id'>
    : never
  : never;

/** Preserve ordered, trusted browser input while the canvas displays a scaled GPU surface. */
export function attachNativeBrowserInput(
  canvas: HTMLCanvasElement,
  text: HTMLTextAreaElement,
  options: {
    id: number;
    width: number;
    height: number;
    blocked: () => boolean;
    send: (input: NativeBrowserInput) => Promise<void>;
    onError: (error: unknown) => void;
  },
) {
  const send = (input: InputBody) => {
    if (!options.blocked())
      void options.send({ ...input, id: options.id }).catch(options.onError);
  };
  const modifiers = (
    event: MouseEvent | KeyboardEvent,
  ): NativeBrowserModifier[] => [
    ...(event.shiftKey ? ['shift' as const] : []),
    ...(event.ctrlKey ? ['control' as const] : []),
    ...(event.altKey ? ['alt' as const] : []),
    ...(event.metaKey ? ['meta' as const] : []),
  ];
  const point = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round(
        ((event.clientX - rect.left) * options.width) / Math.max(1, rect.width),
      ),
      y: Math.round(
        ((event.clientY - rect.top) * options.height) /
          Math.max(1, rect.height),
      ),
    };
  };
  const button = (event: MouseEvent) =>
    event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left';
  let clickCount = 1;
  let lastClick = { time: 0, x: 0, y: 0, button: -1 };
  let composing = false;
  const pointerDown = (event: PointerEvent) => {
    if (options.blocked()) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    text.style.left = `${Math.max(0, event.clientX - rect.left)}px`;
    text.style.top = `${Math.max(0, event.clientY - rect.top)}px`;
    text.focus({ preventScroll: true });
    canvas.setPointerCapture?.(event.pointerId);
    clickCount =
      event.button === lastClick.button &&
      event.timeStamp - lastClick.time < 500 &&
      Math.abs(event.clientX - lastClick.x) < 4 &&
      Math.abs(event.clientY - lastClick.y) < 4
        ? Math.min(3, clickCount + 1)
        : 1;
    lastClick = {
      time: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
      button: event.button,
    };
    send({
      type: 'mouseDown',
      ...point(event),
      button: button(event),
      clickCount,
      modifiers: modifiers(event),
    });
  };
  const pointerMove = (event: PointerEvent) =>
    send({
      type: 'mouseMove',
      ...point(event),
      button: button(event),
      clickCount: 0,
      modifiers: [
        ...modifiers(event),
        ...(event.buttons & 1 ? ['leftbuttondown' as const] : []),
        ...(event.buttons & 2 ? ['rightbuttondown' as const] : []),
        ...(event.buttons & 4 ? ['middlebuttondown' as const] : []),
      ],
    });
  const pointerUp = (event: PointerEvent) => {
    send({
      type: 'mouseUp',
      ...point(event),
      button: button(event),
      clickCount,
      modifiers: modifiers(event),
    });
    if (canvas.hasPointerCapture?.(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
  };
  const cancelPointer = (event: PointerEvent) => {
    pointerUp(event);
  };
  const wheel = (event: WheelEvent) => {
    if (options.blocked()) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = canvas.getBoundingClientRect();
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
    send({
      type: 'mouseWheel',
      ...point(event),
      deltaX: (event.deltaX * unit * options.width) / Math.max(1, rect.width),
      deltaY: (event.deltaY * unit * options.height) / Math.max(1, rect.height),
      modifiers: modifiers(event),
    });
  };
  const keyCode = (event: KeyboardEvent) =>
    ({
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      Enter: 'Return',
      ' ': 'Space',
    })[event.key] ??
    (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  const shortcuts: Record<
    string,
    'copy' | 'cut' | 'paste' | 'selectAll' | 'undo' | 'redo'
  > = { a: 'selectAll', c: 'copy', x: 'cut', v: 'paste', z: 'undo', y: 'redo' };
  const keyDown = (event: KeyboardEvent) => {
    if (
      composing ||
      event.isComposing ||
      ['Process', 'Dead', 'Unidentified'].includes(event.key) ||
      options.blocked()
    )
      return;
    const shortcut =
      (event.ctrlKey || event.metaKey) && !event.altKey
        ? shortcuts[event.key.toLowerCase()]
        : undefined;
    if (shortcut) {
      event.preventDefault();
      send({
        type: 'shortcut',
        action: shortcut === 'undo' && event.shiftKey ? 'redo' : shortcut,
      });
      return;
    }
    send({
      type: 'keyDown',
      keyCode: keyCode(event),
      modifiers: [
        ...modifiers(event),
        ...(event.repeat ? ['isautorepeat' as const] : []),
      ],
    });
    // Printable input and IME composition are collected from the local textarea;
    // navigation/editing keys act on the real page only.
    if (
      event.key.length !== 1 ||
      event.ctrlKey ||
      event.metaKey ||
      (event.altKey && !event.getModifierState('AltGraph'))
    )
      event.preventDefault();
  };
  const keyUp = (event: KeyboardEvent) => {
    if (
      composing ||
      event.isComposing ||
      ['Process', 'Dead', 'Unidentified'].includes(event.key)
    )
      return;
    send({
      type: 'keyUp',
      keyCode: keyCode(event),
      modifiers: modifiers(event),
    });
  };
  const input = () => {
    if (composing) return;
    if (text.value) send({ type: 'insertText', text: text.value });
    text.value = '';
  };
  const compositionStart = () => {
    composing = true;
  };
  const compositionEnd = () => {
    composing = false;
    input();
  };
  const paste = (event: ClipboardEvent) => {
    event.preventDefault();
    send({ type: 'shortcut', action: 'paste' });
  };
  const contextMenu = (event: Event) => event.preventDefault();
  const focus = () => {
    if (!options.blocked()) text.focus({ preventScroll: true });
  };
  const controller = new AbortController();
  const { signal } = controller;
  canvas.addEventListener('pointerdown', pointerDown, { signal });
  canvas.addEventListener('pointermove', pointerMove, { signal });
  canvas.addEventListener('pointerup', pointerUp, { signal });
  canvas.addEventListener('pointercancel', cancelPointer, { signal });
  canvas.addEventListener('wheel', wheel, { passive: false, signal });
  canvas.addEventListener('contextmenu', contextMenu, { signal });
  canvas.addEventListener('focus', focus, { signal });
  text.addEventListener('keydown', keyDown, { signal });
  text.addEventListener('keyup', keyUp, { signal });
  text.addEventListener('input', input, { signal });
  text.addEventListener('compositionstart', compositionStart, { signal });
  text.addEventListener('compositionend', compositionEnd, { signal });
  text.addEventListener('paste', paste, { signal });
  return () => controller.abort();
}
