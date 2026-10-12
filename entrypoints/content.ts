import { TranslationOverlay } from '../lib/overlay';
import { getSettings, saveSentence } from '../lib/storage';
import { requestTranslate } from '../lib/translate-bridge';
import { MESSAGE_TYPE } from '../lib/types';
import { isLikelyEnglish } from '../lib/utils';

const DEBOUNCE_MS = 180;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    const overlay = new TranslationOverlay();
    let debounceTimer: number | undefined;
    let currentEnglish = '';
    let currentChinese = '';
    let translatingToken = 0;

    const clearPageSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      selection.removeAllRanges();
    };

    const closeOverlay = (options?: { clearSelection?: boolean }) => {
      window.clearTimeout(debounceTimer);
      debounceTimer = undefined;
      translatingToken += 1;
      overlay.hide();
      currentEnglish = '';
      currentChinese = '';
      if (options?.clearSelection !== false) {
        clearPageSelection();
      }
    };

    const notifySaveResult = (title: string, message: string) => {
      void chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.SaveResultNotify,
        title,
        message,
      });
    };

    const persistSentence = async (english: string, chinese: string) => {
      return saveSentence({
        en: english,
        zh: chinese,
        url: location.href,
        pageTitle: document.title,
      });
    };

    const handleSave = async () => {
      if (!currentEnglish || !currentChinese) return;
      overlay.update({
        translation: currentChinese,
        status: 'loading',
        message: '保存中…',
      });
      try {
        await persistSentence(currentEnglish, currentChinese);
        closeOverlay();
      } catch (error) {
        overlay.update({
          translation: currentChinese,
          status: 'error',
          message: error instanceof Error ? error.message : '保存失败',
        });
      }
    };

    const translateSelection = async (text: string, rect: DOMRect) => {
      const token = ++translatingToken;
      currentEnglish = text;
      currentChinese = '';

      overlay.show(
        rect,
        { translation: '', status: 'loading', message: '翻译中…' },
        { onSave: () => void handleSave(), onClose: closeOverlay },
      );

      try {
        const settings = await getSettings();
        const translation = await requestTranslate(
          text,
          settings.sourceLanguage,
          settings.targetLanguage,
        );

        if (token !== translatingToken) return;
        currentChinese = translation;
        overlay.update({ translation, status: 'idle' });

        if (settings.autoSave) {
          await handleSave();
        }
      } catch (error) {
        if (token !== translatingToken) return;
        overlay.update({
          translation: text,
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : '翻译失败，请重试或复制原文',
        });
      }
    };

    const translateAndSaveQuietly = async (text: string) => {
      try {
        const settings = await getSettings();
        const translation = await requestTranslate(
          text,
          settings.sourceLanguage,
          settings.targetLanguage,
        );
        const result = await persistSentence(text, translation);
        const title =
          result.status === 'exists'
            ? '芒果句库：已存在'
            : result.status === 'updated'
              ? '芒果句库：已更新'
              : '芒果句库：已保存';
        notifySaveResult(title, translation.slice(0, 120));
      } catch (error) {
        notifySaveResult(
          '芒果句库：保存失败',
          error instanceof Error ? error.message : '请稍后重试',
        );
      }
    };

    document.addEventListener('mouseup', (event) => {
      if (overlay.contains(event.target)) return;

      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() ?? '';
        if (!text) return;
        if (!isLikelyEnglish(text)) return;
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        void translateSelection(text, rect);
      }, DEBOUNCE_MS);
    });

    document.addEventListener(
      'mousedown',
      (event) => {
        if (overlay.contains(event.target)) return;
        closeOverlay();
      },
      true,
    );

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeOverlay();
      }
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === MESSAGE_TYPE.TranslateAndSave && message.text) {
        void translateAndSaveQuietly(String(message.text)).then(() => {
          sendResponse({ ok: true });
        });
        return true;
      }

      if (message?.type === MESSAGE_TYPE.TranslateProgress) {
        const loaded = Number(message.loaded ?? 0);
        overlay.update({
          translation: '',
          status: 'loading',
          progress: loaded,
          message: `模型下载中 ${Math.round(loaded * 100)}%`,
        });
        return false;
      }

      return false;
    });
  },
});
