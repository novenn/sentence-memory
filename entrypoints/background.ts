import {
  ensureOffscreenDocument,
  translateViaOffscreen,
} from '../lib/translate-bridge';
import { ensureStorageInitialized, getSentences, getSettings } from '../lib/storage';
import { getDueSentences } from '../lib/review';
import { MESSAGE_TYPE } from '../lib/types';

const CONTEXT_MENU_ID = 'sentence-memory-translate-save';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    void ensureStorageInitialized();
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: '翻译并保存这句话',
      contexts: ['selection'],
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID) return;
    const text = info.selectionText?.trim();
    if (!text || tab?.id == null) return;

    void chrome.tabs
      .sendMessage(tab.id, {
        type: MESSAGE_TYPE.TranslateAndSave,
        text,
      })
      .catch(async () => {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: '芒果句库：无法保存',
          message: '请刷新页面后重试',
        });
      });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === MESSAGE_TYPE.OpenReview) {
      void chrome.tabs.create({ url: chrome.runtime.getURL('/review.html') });
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === MESSAGE_TYPE.GetDueCount) {
      void (async () => {
        const [sentences, settings] = await Promise.all([
          getSentences(),
          getSettings(),
        ]);
        const due = getDueSentences(
          sentences,
          Date.now(),
          settings.dailyReviewLimit,
        );
        sendResponse({ count: due.length });
      })();
      return true;
    }

    if (message?.type === MESSAGE_TYPE.SaveResultNotify) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: message.title as string,
        message: message.message as string,
      });
      void refreshBadge();
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === MESSAGE_TYPE.Translate) {
      void (async () => {
        try {
          const settings = await getSettings();
          const translation = await translateViaOffscreen({
            text: String(message.text ?? ''),
            sourceLanguage: String(
              message.sourceLanguage ?? settings.sourceLanguage,
            ),
            targetLanguage: String(
              message.targetLanguage ?? settings.targetLanguage,
            ),
            tabId: sender.tab?.id,
          });
          sendResponse({ ok: true, translation });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return true;
    }

    if (message?.type === MESSAGE_TYPE.WarmUpTranslator) {
      void (async () => {
        try {
          const settings = await getSettings();
          await ensureOffscreenDocument();
          const response = await chrome.runtime.sendMessage({
            type: MESSAGE_TYPE.OffscreenWarmUp,
            sourceLanguage: String(
              message.sourceLanguage ?? settings.sourceLanguage,
            ),
            targetLanguage: String(
              message.targetLanguage ?? settings.targetLanguage,
            ),
          });
          sendResponse(response ?? { ok: false, error: '准备失败' });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return true;
    }

    if (message?.type === MESSAGE_TYPE.TranslateProgress) {
      const tabId = message.tabId as number | undefined;
      if (tabId != null) {
        void chrome.tabs
          .sendMessage(tabId, {
            type: MESSAGE_TYPE.TranslateProgress,
            loaded: message.loaded,
          })
          .catch(() => undefined);
      }
      return false;
    }

    return false;
  });

  void refreshBadge();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sentences) {
      void refreshBadge();
    }
  });
});

async function refreshBadge(): Promise<void> {
  const [sentences, settings] = await Promise.all([
    getSentences(),
    getSettings(),
  ]);
  const dueCount = getDueSentences(
    sentences,
    Date.now(),
    settings.dailyReviewLimit,
  ).length;
  await chrome.action.setBadgeText({
    text: dueCount > 0 ? String(Math.min(dueCount, 99)) : '',
  });
  await chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });
}
