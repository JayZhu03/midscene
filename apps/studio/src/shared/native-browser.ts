/** Only the Studio shell may position the native guest. No arbitrary CDP/JS IPC. */
export interface NativeBrowserLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  blocked: boolean;
}

export interface NativeBrowserState {
  available: boolean;
  id?: number;
  width?: number;
  height?: number;
  error?: string;
  loadingSince?: number;
  snapshot?: string;
}

/** Input is expressed in the full-size page's CSS pixels, independently of preview size. */
export type NativeBrowserModifier =
  | 'shift'
  | 'control'
  | 'alt'
  | 'meta'
  | 'leftbuttondown'
  | 'middlebuttondown'
  | 'rightbuttondown'
  | 'isautorepeat';
export type NativeBrowserInput = { id: number } & (
  | {
      type: 'mouseMove' | 'mouseDown' | 'mouseUp';
      x: number;
      y: number;
      button: 'left' | 'middle' | 'right';
      clickCount: number;
      modifiers: NativeBrowserModifier[];
    }
  | {
      type: 'mouseWheel';
      x: number;
      y: number;
      deltaX: number;
      deltaY: number;
      modifiers: NativeBrowserModifier[];
    }
  | {
      type: 'keyDown' | 'keyUp';
      keyCode: string;
      modifiers: NativeBrowserModifier[];
    }
  | { type: 'insertText'; text: string }
  | {
      type: 'shortcut';
      action: 'copy' | 'cut' | 'paste' | 'selectAll' | 'undo' | 'redo';
    }
);

export function validNativeBrowserInput(
  value: unknown,
): value is NativeBrowserInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as NativeBrowserInput;
  if (!Number.isSafeInteger(input.id) || input.id <= 0) return false;
  if (input.type === 'insertText')
    return typeof input.text === 'string' && input.text.length <= 65536;
  if (input.type === 'shortcut')
    return ['copy', 'cut', 'paste', 'selectAll', 'undo', 'redo'].includes(
      input.action,
    );
  if (
    !('modifiers' in input) ||
    !Array.isArray(input.modifiers) ||
    input.modifiers.length > 12 ||
    !input.modifiers.every((item) =>
      [
        'shift',
        'control',
        'alt',
        'meta',
        'leftbuttondown',
        'middlebuttondown',
        'rightbuttondown',
        'isautorepeat',
      ].includes(item),
    )
  )
    return false;
  if (input.type === 'keyDown' || input.type === 'keyUp')
    return (
      typeof input.keyCode === 'string' &&
      input.keyCode.length > 0 &&
      input.keyCode.length <= 32
    );
  if (!['mouseMove', 'mouseDown', 'mouseUp', 'mouseWheel'].includes(input.type))
    return false;
  if (
    !('x' in input) ||
    !('y' in input) ||
    ![input.x, input.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 32768)
  )
    return false;
  if (input.type === 'mouseWheel')
    return [input.deltaX, input.deltaY].every(
      (n) => Number.isFinite(n) && Math.abs(n) <= 100000,
    );
  return (
    'button' in input &&
    ['left', 'middle', 'right'].includes(input.button) &&
    Number.isInteger(input.clickCount) &&
    input.clickCount >= 0 &&
    input.clickCount <= 3
  );
}

export function validNativeBrowserLayout(
  value: unknown,
): value is NativeBrowserLayout {
  if (!value || typeof value !== 'object') return false;
  const rect = value as NativeBrowserLayout;
  return (
    ['x', 'y', 'width', 'height'].every((key) => {
      const n = rect[key as 'x'];
      return (
        typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 32768
      );
    }) &&
    typeof rect.visible === 'boolean' &&
    typeof rect.blocked === 'boolean'
  );
}
