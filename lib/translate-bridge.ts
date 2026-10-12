import { MESSAGE_TYPE } from './types';

const OFFSCREEN_PATH = 'offscreen.html';
const OFFSCREEN_REASON = 'IFRAME_SCRIPTING' as const;
const OFFSCREEN_JUSTIFICATION =
  'Run Chrome Translator API in an extension document (content scripts may be blocked by page Permissions-Policy).';
const READY_RETRY_COUNT = 10;
const READY_RETRY_DELAY_MS = 50;

export type TranslateRequest = {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  tabId?: number;
};

export type TranslateResponse =
  | { ok: true; translation: string }
  | { ok: false; error: string };

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  const expectedUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  return contexts.some((context) => context.documentUrl === expectedUrl);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pingOffscreen(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE.OffscreenPing,
    });
    return response?.ok === true;
  } catch {
    return false;
  }
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (!(await hasOffscreenDocument())) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [OFFSCREEN_REASON],
      justification: OFFSCREEN_JUSTIFICATION,
    });
  }

  for (let attempt = 0; attempt < READY_RETRY_COUNT; attempt += 1) {
    if (await pingOffscreen()) return;
    await wait(READY_RETRY_DELAY_MS);
  }
  throw new Error('翻译服务未就绪，请重试');
}

export async function translateViaOffscreen(
  request: TranslateRequest,
): Promise<string> {
  await ensureOffscreenDocument();
  const response = (await chrome.runtime.sendMessage({
    type: MESSAGE_TYPE.OffscreenTranslate,
    payload: request,
  })) as TranslateResponse | undefined;

  if (!response?.ok) {
    throw new Error(response?.error || '翻译失败');
  }
  return response.translation;
}

/** Content script / popup 请求后台翻译 */
export async function requestTranslate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string> {
  const response = (await chrome.runtime.sendMessage({
    type: MESSAGE_TYPE.Translate,
    text,
    sourceLanguage,
    targetLanguage,
  })) as TranslateResponse | undefined;

  if (!response?.ok) {
    throw new Error(response?.error || '翻译失败');
  }
  return response.translation;
}

export async function requestWarmUp(
  sourceLanguage: string,
  targetLanguage: string,
): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: MESSAGE_TYPE.WarmUpTranslator,
    sourceLanguage,
    targetLanguage,
  })) as TranslateResponse | { ok: true } | undefined;

  if (!response || !('ok' in response) || !response.ok) {
    const error =
      response && 'error' in response ? response.error : '准备翻译模型失败';
    throw new Error(error);
  }
}
