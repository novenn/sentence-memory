import { translateText, warmUpTranslator } from '../../lib/translator';
import { MESSAGE_TYPE } from '../../lib/types';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPE.OffscreenPing) {
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === MESSAGE_TYPE.OffscreenTranslate) {
    const { text, sourceLanguage, targetLanguage, tabId } = message.payload ?? {};
    void translateText(String(text ?? ''), {
      sourceLanguage: String(sourceLanguage ?? 'en'),
      targetLanguage: String(targetLanguage ?? 'zh'),
      onProgress: (progress) => {
        if (tabId == null) return;
        void chrome.runtime.sendMessage({
          type: MESSAGE_TYPE.TranslateProgress,
          tabId,
          loaded: progress.loaded,
        });
      },
    })
      .then((translation) => sendResponse({ ok: true, translation }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === MESSAGE_TYPE.OffscreenWarmUp) {
    const { sourceLanguage, targetLanguage } = message;
    void warmUpTranslator({
      sourceLanguage: String(sourceLanguage ?? 'en'),
      targetLanguage: String(targetLanguage ?? 'zh'),
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  return false;
});
