export type TranslatorAvailability =
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available';

export type TranslateProgress = {
  loaded: number;
};

export type TranslateOptions = {
  sourceLanguage: string;
  targetLanguage: string;
  onProgress?: (progress: TranslateProgress) => void;
};

type TranslatorInstance = {
  translate: (text: string) => Promise<string>;
  destroy: () => void;
};

type TranslatorCreateOptions = {
  sourceLanguage: string;
  targetLanguage: string;
  monitor?: (monitor: {
    addEventListener: (
      type: 'downloadprogress',
      listener: (event: { loaded: number }) => void,
    ) => void;
  }) => void;
};

type TranslatorGlobal = {
  availability: (options: {
    sourceLanguage: string;
    targetLanguage: string;
  }) => Promise<TranslatorAvailability>;
  create: (options: TranslatorCreateOptions) => Promise<TranslatorInstance>;
};

declare global {
  // Chrome 138+ Translator API
  // eslint-disable-next-line no-var
  var Translator: TranslatorGlobal | undefined;
}

type CachedTranslator = {
  key: string;
  instance: TranslatorInstance;
};

let cachedTranslator: CachedTranslator | null = null;

export function isTranslatorSupported(): boolean {
  return typeof self !== 'undefined' && 'Translator' in self && !!self.Translator;
}

export async function getTranslatorAvailability(
  sourceLanguage: string,
  targetLanguage: string,
): Promise<TranslatorAvailability> {
  if (!isTranslatorSupported() || !self.Translator) {
    return 'unavailable';
  }
  return self.Translator.availability({ sourceLanguage, targetLanguage });
}

export function formatTranslatorError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes('unable to create translator') ||
    lower.includes('notsupported') ||
    lower.includes('not supported')
  ) {
    return [
      '无法创建翻译器。请依次检查：',
      '1) Chrome 设置 → 语言：添加「中文」和「英语」',
      '2) 打开扩展弹窗，点击「准备翻译模型」（需联网下载一次）',
      '3) 使用 Chrome 138+ 桌面版，并确保未禁用内置 AI',
    ].join(' ');
  }

  if (lower.includes('notallowed') || lower.includes('user activation')) {
    return '首次下载翻译模型需要用户操作：请打开扩展弹窗点击「准备翻译模型」';
  }

  if (message.includes('当前浏览器不支持') || message.includes('当前语言对不可用')) {
    return message;
  }

  return message || '翻译失败，请重试';
}

async function getOrCreateTranslator(
  options: TranslateOptions,
): Promise<TranslatorInstance> {
  if (!isTranslatorSupported() || !self.Translator) {
    throw new Error('当前浏览器不支持 Translator API，请升级到 Chrome 138+ 桌面版');
  }

  const key = `${options.sourceLanguage}->${options.targetLanguage}`;
  if (cachedTranslator?.key === key) {
    return cachedTranslator.instance;
  }

  if (cachedTranslator) {
    try {
      cachedTranslator.instance.destroy();
    } catch {
      // ignore
    }
    cachedTranslator = null;
  }

  const availability = await self.Translator.availability({
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
  });

  if (availability === 'unavailable') {
    throw new Error('当前语言对不可用，请升级到 Chrome 138+ 桌面版，并在语言设置中添加中英');
  }

  const instance = await self.Translator.create({
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        options.onProgress?.({ loaded: event.loaded });
      });
    },
  });

  cachedTranslator = { key, instance };
  return instance;
}

export async function translateText(
  text: string,
  options: TranslateOptions,
): Promise<string> {
  try {
    const translator = await getOrCreateTranslator(options);
    return await translator.translate(text);
  } catch (error) {
    throw new Error(formatTranslatorError(error));
  }
}

/** 在用户手势下预下载并缓存翻译模型 */
export async function warmUpTranslator(
  options: Omit<TranslateOptions, 'onProgress'> & {
    onProgress?: (progress: TranslateProgress) => void;
  },
): Promise<TranslatorAvailability> {
  const availability = await getTranslatorAvailability(
    options.sourceLanguage,
    options.targetLanguage,
  );
  if (availability === 'unavailable') {
    throw new Error('当前语言对不可用，请升级到 Chrome 138+ 桌面版，并在语言设置中添加中英');
  }
  await getOrCreateTranslator(options);
  return 'available';
}
