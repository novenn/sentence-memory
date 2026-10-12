export interface ReviewState {
  times: number;
  correct: number;
  consecutiveCorrect: number;
  lastReviewedAt?: number;
  nextReviewAt: number;
  /** 已完成的间隔档位数；毕业时按 [3,6,9,15,30] 取值，满档后再连对 3 次则删除 */
  intervalLevel: number;
}

export interface SavedSentence {
  id: string;
  en: string;
  zh: string;
  url: string;
  pageTitle: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  review: ReviewState;
}

export interface Settings {
  sourceLanguage: string;
  targetLanguage: string;
  dailyReviewLimit: number;
  autoSave: boolean;
}

export interface StorageSchema {
  sentences: SavedSentence[];
  settings: Settings;
  version: string;
}

export interface ExportPayload {
  sentences: SavedSentence[];
  settings: Settings;
  version: string;
}

export const STORAGE_VERSION = '1.0.0';

export const DEFAULT_SETTINGS: Settings = {
  sourceLanguage: 'en',
  targetLanguage: 'zh',
  dailyReviewLimit: 20,
  autoSave: false,
};

export const JUDGMENT = {
  Correct: 'correct',
  Almost: 'almost',
  Wrong: 'wrong',
} as const;

export type Judgment = (typeof JUDGMENT)[keyof typeof JUDGMENT];

export const JUDGMENT_LABEL: Record<Judgment, string> = {
  correct: '正确',
  almost: '基本正确',
  wrong: '错误',
};

export const MESSAGE_TYPE = {
  OpenReview: 'OPEN_REVIEW',
  TranslateAndSave: 'TRANSLATE_AND_SAVE',
  GetDueCount: 'GET_DUE_COUNT',
  SaveResultNotify: 'SAVE_RESULT_NOTIFY',
  Translate: 'TRANSLATE',
  WarmUpTranslator: 'WARM_UP_TRANSLATOR',
  OffscreenTranslate: 'OFFSCREEN_TRANSLATE',
  OffscreenWarmUp: 'OFFSCREEN_WARM_UP',
  OffscreenPing: 'OFFSCREEN_PING',
  TranslateProgress: 'TRANSLATE_PROGRESS',
} as const;
