import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { NativeBrowserState } from '../../../shared/native-browser';
import { t, useStudioLanguage } from '../../i18n';
import {
  CONNECTION_DELAY_MESSAGE,
  useConnectionDelay,
} from '../ConnectingPreview/use-connection-delay';
import { attachNativeBrowserInput } from './native-browser-input';
import {
  isNativePreviewCovered,
  subscribeNativePreviewCover,
} from './native-preview-cover';

const overlays =
  '[data-studio-overlay], [role="dialog"], [role="menu"], [aria-modal="true"], dialog[open], [popover], .ant-modal-mask, .ant-drawer-mask, .ant-dropdown, .ant-select-dropdown, .ant-popover, .ant-tooltip, .ant-image-preview-wrap, .ant-image-preview-mask, .history-modal-overlay';

/** Scaled GPU preview of the same full-resolution page used for automation. */
export function NativeWebPreview({
  blocked,
  onSize,
  onStatus,
  renderError,
  aspectRatio = 16 / 9,
}: {
  blocked: boolean;
  onSize: (size: { width: number; height: number }) => void;
  onStatus: (status: 'connected' | 'error', text: string | null) => void;
  renderError?: () => ReactNode;
  aspectRatio?: number;
}) {
  useStudioLanguage();
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const callbacks = useRef({ onSize, onStatus });
  const blockedRef = useRef(blocked);
  const scheduleRef = useRef<() => void>();
  blockedRef.current = blocked;
  callbacks.current = { onSize, onStatus };
  const [state, setState] = useState<NativeBrowserState>();
  const [covered, setCovered] = useState(false);
  const [mountedAt] = useState(Date.now);
  const delayed = useConnectionDelay(
    state?.available ? state.loadingSince : mountedAt,
  );
  const delayedRef = useRef(delayed);
  delayedRef.current = delayed;
  const ratio =
    state?.width && state?.height ? state.width / state.height : aspectRatio;
  useEffect(() => {
    const node = root.current;
    const bridge = window.studioRuntime?.nativeBrowserLayout;
    if (!node || !bridge) return;
    let disposed = false;
    let revision = 0;
    let frame = 0;
    let lastSize = '';
    let lastStatus = '';
    const update = async (requireAcknowledgement = false) => {
      if (disposed) return;
      const currentRevision = ++revision;
      const rect = node.getBoundingClientRect();
      // Pause preview transfers under dialogs/fullscreen, retaining the last
      // canvas frame so opening a report never flashes or hides the webpage.
      const obscured =
        isNativePreviewCovered() ||
        Boolean(document.fullscreenElement) ||
        Array.from(document.querySelectorAll(overlays)).some((el) => {
          const style = getComputedStyle(el);
          const bounds = el.getBoundingClientRect();
          // Retained portals may have a hidden parent after their close motion.
          for (
            let parent = el.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            const parentStyle = getComputedStyle(parent);
            if (
              parentStyle.display === 'none' ||
              parentStyle.visibility === 'hidden'
            )
              return false;
          }
          return (
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            Number(style.opacity) !== 0 &&
            bounds.width > 0 &&
            bounds.height > 0 &&
            bounds.left < rect.right &&
            bounds.right > rect.left &&
            bounds.top < rect.bottom &&
            bounds.bottom > rect.top
          );
        });
      const visible =
        !obscured &&
        !delayedRef.current &&
        document.visibilityState === 'visible' &&
        rect.width > 1 &&
        rect.height > 1;
      setCovered(!visible);
      try {
        const next = await bridge({
          x: Math.max(0, rect.x),
          y: Math.max(0, rect.y),
          width: Math.max(0, rect.width),
          height: Math.max(0, rect.height),
          visible,
          blocked: blockedRef.current,
        });
        // A newer popup/fullscreen change must not be overwritten by a stale reply.
        if (disposed || currentRevision !== revision) return;
        setState((prior) =>
          prior?.available === next.available &&
          prior?.id === next.id &&
          prior?.width === next.width &&
          prior?.height === next.height &&
          prior?.error === next.error &&
          prior?.loadingSince === next.loadingSince &&
          prior?.snapshot === next.snapshot
            ? prior
            : next,
        );
        const size = `${next.width}:${next.height}`;
        if (next.width && next.height && size !== lastSize) {
          lastSize = size;
          callbacks.current.onSize({ width: next.width, height: next.height });
        }
        const status = next.error || (next.available ? 'connected' : '');
        if (status && status !== lastStatus) {
          lastStatus = status;
          callbacks.current.onStatus(
            next.error ? 'error' : 'connected',
            next.error || null,
          );
        }
      } catch (error) {
        if (!disposed && currentRevision === revision)
          callbacks.current.onStatus(
            'error',
            error instanceof Error ? error.message : String(error),
          );
        if (requireAcknowledgement) throw error;
      }
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        void update();
      });
    };
    scheduleRef.current = schedule;
    const unsubscribeCover = subscribeNativePreviewCover(() => update(true));
    const resize = new ResizeObserver(schedule);
    resize.observe(node);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'aria-hidden',
        'aria-modal',
        'open',
        'hidden',
        'role',
        'data-studio-overlay',
      ],
    });
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', schedule);
    document.addEventListener('fullscreenchange', schedule);
    document.addEventListener('toggle', schedule, true);
    document.addEventListener('transitionend', schedule, true);
    document.addEventListener('animationend', schedule, true);
    // Native status contains only small metadata; no continuous screenshot traffic.
    const timer = setInterval(schedule, 500);
    schedule();
    return () => {
      disposed = true;
      unsubscribeCover();
      clearInterval(timer);
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', schedule);
      document.removeEventListener('fullscreenchange', schedule);
      document.removeEventListener('toggle', schedule, true);
      document.removeEventListener('transitionend', schedule, true);
      document.removeEventListener('animationend', schedule, true);
      void bridge({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        visible: false,
        blocked: false,
      });
    };
  }, []);
  useEffect(() => {
    scheduleRef.current?.();
  }, [blocked, delayed]);
  useEffect(() => {
    const send = window.studioRuntime?.nativeBrowserInput;
    if (
      !canvas.current ||
      !textInput.current ||
      !send ||
      !state?.id ||
      !state.width ||
      !state.height
    )
      return;
    return attachNativeBrowserInput(canvas.current, textInput.current, {
      id: state.id,
      width: state.width,
      height: state.height,
      blocked: () => blockedRef.current || delayedRef.current,
      send,
      onError: (error) =>
        callbacks.current.onStatus(
          'error',
          error instanceof Error ? error.message : String(error),
        ),
    });
  }, [state?.id, state?.width, state?.height]);
  return (
    <div
      className="studio-native-preview-stage"
      style={
        {
          '--native-preview-ratio': ratio,
          '--native-preview-fit-width': `calc(${ratio * 100}cqh - ${ratio * 8}px)`,
          '--native-preview-fit-height': `calc(${100 / ratio}cqw - ${8 / ratio}px)`,
        } as CSSProperties
      }
    >
      <div
        ref={root}
        className="studio-native-preview-frame relative flex items-center justify-center rounded-xl"
      >
        <canvas
          ref={canvas}
          data-studio-browser-id={state?.id}
          aria-label={t('Web preview')}
          tabIndex={blocked ? -1 : 0}
          className="absolute inset-0 h-full w-full rounded-xl outline-none"
          style={{
            visibility: state?.error || delayed ? 'hidden' : 'visible',
            touchAction: 'none',
          }}
        />
        <textarea
          ref={textInput}
          aria-label={t('Web page input')}
          tabIndex={-1}
          autoComplete="off"
          spellCheck={false}
          className="pointer-events-none absolute h-6 w-px resize-none opacity-0"
        />
        {!state?.error && !delayed && covered && state?.snapshot ? (
          <img
            alt=""
            src={state.snapshot}
            className="max-h-full max-w-full rounded-xl object-contain"
          />
        ) : null}
        {state?.error
          ? (renderError?.() ?? (
              <span className="px-6 text-sm text-text-secondary">
                {state.error}
              </span>
            ))
          : null}
        {!state?.error && delayed ? (
          <output className="px-6 text-center text-sm text-text-secondary">
            {t(CONNECTION_DELAY_MESSAGE)}
          </output>
        ) : null}
      </div>
    </div>
  );
}
