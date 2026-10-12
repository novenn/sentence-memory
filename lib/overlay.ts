const HOST_ID = 'sentence-memory-overlay-host';
const MAX_WIDTH_PX = 360;
const MAX_HEIGHT_PX = 240;
const VIEWPORT_PADDING_PX = 8;
const OFFSET_FROM_SELECTION_PX = 8;

export type OverlayState = {
  translation: string;
  status: 'idle' | 'loading' | 'error' | 'saved' | 'exists';
  message?: string;
  progress?: number;
};

export type OverlayHandlers = {
  onSave: () => void;
  onClose: () => void;
};

export class TranslationOverlay {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private handlers: OverlayHandlers | null = null;

  show(
    rect: DOMRect,
    state: OverlayState,
    handlers: OverlayHandlers,
  ): void {
    this.handlers = handlers;
    this.ensureHost();
    this.render(state);
    this.position(rect);
  }

  update(state: OverlayState): void {
    if (!this.shadow) return;
    this.render(state);
  }

  hide(): void {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.handlers = null;
  }

  contains(target: EventTarget | null): boolean {
    return !!this.host && target instanceof Node && this.host.contains(target);
  }

  private ensureHost(): void {
    if (this.host && this.shadow) return;
    const existing = document.getElementById(HOST_ID);
    existing?.remove();

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647';
    host.style.top = '0';
    host.style.left = '0';
    document.documentElement.appendChild(host);
    this.host = host;
    this.shadow = host.attachShadow({ mode: 'open' });
  }

  private render(state: OverlayState): void {
    if (!this.shadow) return;
    const saveDisabled =
      state.status === 'loading' ||
      state.status === 'saved' ||
      state.status === 'exists' ||
      state.status === 'error';

    const saveLabel =
      state.status === 'saved'
        ? '已保存'
        : state.status === 'exists'
          ? '已存在'
          : '保存到芒果句库';

    this.shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .panel {
          width: min(${MAX_WIDTH_PX}px, calc(100vw - ${VIEWPORT_PADDING_PX * 2}px));
          max-height: ${MAX_HEIGHT_PX}px;
          overflow: auto;
          background: #fff;
          color: #1f2937;
          border-radius: 10px;
          box-shadow: 0 8px 28px rgba(15, 23, 42, 0.18);
          border: 1px solid rgba(15, 23, 42, 0.08);
          padding: 12px;
        }
        .text {
          font-size: 14px;
          line-height: 1.55;
          white-space: pre-wrap;
          word-break: break-word;
          margin: 0 0 10px;
        }
        .meta {
          font-size: 12px;
          color: #6b7280;
          margin: 0 0 10px;
        }
        .actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
        button {
          border: 0;
          border-radius: 8px;
          padding: 6px 12px;
          font-size: 13px;
          cursor: pointer;
        }
        .save {
          background: #0f766e;
          color: #fff;
        }
        .save:disabled {
          opacity: 0.65;
          cursor: default;
        }
        .close {
          background: #e5e7eb;
          color: #111827;
        }
        @media (prefers-color-scheme: dark) {
          .panel {
            background: #111827;
            color: #f3f4f6;
            border-color: rgba(255,255,255,0.08);
            box-shadow: 0 10px 30px rgba(0,0,0,0.45);
          }
          .meta { color: #9ca3af; }
          .close { background: #374151; color: #f9fafb; }
          .save { background: #14b8a6; color: #042f2e; }
        }
      </style>
      <div class="panel" part="panel">
        <p class="text">${escapeHtml(state.translation || (state.status === 'loading' ? '翻译中…' : ''))}</p>
        ${
          state.message
            ? `<p class="meta">${escapeHtml(state.message)}</p>`
            : state.progress !== undefined
              ? `<p class="meta">模型下载中 ${Math.round(state.progress * 100)}%</p>`
              : ''
        }
        <div class="actions">
          <button class="close" type="button" data-action="close">关闭</button>
          <button class="save" type="button" data-action="save" ${saveDisabled ? 'disabled' : ''}>${saveLabel}</button>
        </div>
      </div>
    `;

    this.shadow.querySelector('[data-action="close"]')?.addEventListener('click', () => {
      this.handlers?.onClose();
    });
    this.shadow.querySelector('[data-action="save"]')?.addEventListener('click', () => {
      this.handlers?.onSave();
    });
  }

  private position(rect: DOMRect): void {
    if (!this.host || !this.shadow) return;
    const panel = this.shadow.querySelector('.panel') as HTMLElement | null;
    if (!panel) return;

    const panelRect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = rect.bottom + OFFSET_FROM_SELECTION_PX;
    if (top + panelRect.height > viewportHeight - VIEWPORT_PADDING_PX) {
      top = rect.top - panelRect.height - OFFSET_FROM_SELECTION_PX;
    }
    top = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(top, viewportHeight - panelRect.height - VIEWPORT_PADDING_PX),
    );

    let left = rect.left;
    if (left + panelRect.width > viewportWidth - VIEWPORT_PADDING_PX) {
      left = viewportWidth - panelRect.width - VIEWPORT_PADDING_PX;
    }
    left = Math.max(VIEWPORT_PADDING_PX, left);

    this.host.style.top = `${top}px`;
    this.host.style.left = `${left}px`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
