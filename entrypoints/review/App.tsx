import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  CONSECUTIVE_CORRECT_TO_GRADUATE,
  diffWords,
  getDueSentences,
  judgeAnswer,
  normalizeReviewState,
  REVIEW_INTERVALS_DAYS,
  updateReviewAfterAnswer,
} from '../../lib/review';
import {
  buildProgressSlots,
  loadDailyReviewProgress,
  markDailyCompleted,
  markDailySkipped,
  isRoundComplete,
  ProgressSlotState,
  progressSummary,
  startNextRound,
  type DailyReviewProgress,
} from '../../lib/daily-progress';
import {
  deleteSentence,
  getSentences,
  getSettings,
  updateSentence,
} from '../../lib/storage';
import {
  JUDGMENT,
  JUDGMENT_LABEL,
  type Judgment,
  type SavedSentence,
} from '../../lib/types';
import { formatDateTime, normalize } from '../../lib/utils';

type ResultView = {
  judgment: Judgment;
  score: number;
  input: string;
  nextReviewAt: number;
  consecutiveCorrect: number;
  graduated: boolean;
  shouldDelete: boolean;
  revealed?: boolean;
};

type SentenceToken =
  | { type: 'word'; text: string; wordIndex: number }
  | { type: 'other'; text: string };

const WORD_PATTERN = /([A-Za-z0-9]+(?:'[A-Za-z0-9]+)?)|([^A-Za-z0-9]+)/g;
const BLANK_WIDTH_PADDING_CH = 1;
const MIN_BLANK_WIDTH_CH = 2;
const FIRST_WORD_INDEX = 0;
const SPACE_LONG_PRESS_MS = 400;
const WORD_HINT_LETTER_COUNT = 2;

function wordHintPrefix(word: string): string {
  return word.slice(0, Math.min(WORD_HINT_LETTER_COUNT, word.length));
}

const PageTab = {
  Review: 'review',
  Vault: 'vault',
} as const;

type PageTabId = (typeof PageTab)[keyof typeof PageTab];

const VaultDueState = {
  Due: 'due',
  Waiting: 'waiting',
} as const;

type VaultDueStateId = (typeof VaultDueState)[keyof typeof VaultDueState];

function capitalizeFirstLetter(value: string): string {
  if (value.length === 0) return value;
  return value[0].toUpperCase() + value.slice(1);
}

function isPassedJudgment(judgment: Judgment, revealed?: boolean): boolean {
  if (revealed) return false;
  return judgment === JUDGMENT.Correct || judgment === JUDGMENT.Almost;
}

function getVaultDueState(
  sentence: SavedSentence,
  now: number,
): VaultDueStateId {
  return sentence.review.nextReviewAt <= now
    ? VaultDueState.Due
    : VaultDueState.Waiting;
}

function sortVaultSentences(
  sentences: SavedSentence[],
  now: number,
): SavedSentence[] {
  return [...sentences].sort((left, right) => {
    const leftDue = left.review.nextReviewAt <= now ? 0 : 1;
    const rightDue = right.review.nextReviewAt <= now ? 0 : 1;
    if (leftDue !== rightDue) return leftDue - rightDue;
    if (left.review.nextReviewAt !== right.review.nextReviewAt) {
      return left.review.nextReviewAt - right.review.nextReviewAt;
    }
    return right.updatedAt - left.updatedAt;
  });
}

function matchesVaultQuery(sentence: SavedSentence, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const haystack = [
    sentence.en,
    sentence.zh,
    sentence.pageTitle,
    sentence.url,
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(normalizedQuery);
}

function tokenizeEnglish(sentence: string): SentenceToken[] {
  const tokens: SentenceToken[] = [];
  let wordIndex = 0;
  for (const match of sentence.matchAll(WORD_PATTERN)) {
    if (match[1]) {
      tokens.push({ type: 'word', text: match[1], wordIndex });
      wordIndex += 1;
    } else if (match[2]) {
      tokens.push({ type: 'other', text: match[2] });
    }
  }
  return tokens;
}

function composeAnswer(tokens: SentenceToken[], wordAnswers: string[]): string {
  return tokens
    .map((token) =>
      token.type === 'word' ? (wordAnswers[token.wordIndex] ?? '') : token.text,
    )
    .join('');
}

function blankWidthCh(word: string): number {
  return Math.max(word.length + BLANK_WIDTH_PADDING_CH, MIN_BLANK_WIDTH_CH);
}

export default function App() {
  const [queue, setQueue] = useState<SavedSentence[]>([]);
  const [index, setIndex] = useState(0);
  const [dailyProgress, setDailyProgress] = useState<DailyReviewProgress>({
    dateKey: '',
    round: 1,
    slotOrder: [],
    completedIds: [],
    skippedIds: [],
  });
  const [wordAnswers, setWordAnswers] = useState<string[]>([]);
  const [result, setResult] = useState<ResultView | null>(null);
  const [history, setHistory] = useState<SavedSentence[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageTab, setPageTab] = useState<PageTabId>(PageTab.Review);
  const [vaultSentences, setVaultSentences] = useState<SavedSentence[]>([]);
  const [vaultQuery, setVaultQuery] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [spaceHint, setSpaceHint] = useState<{
    wordIndex: number;
    prefix: string;
  } | null>(null);
  const shortcutsAnchorRef = useRef<HTMLDivElement | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const busyRef = useRef(false);
  const pageTabRef = useRef<PageTabId>(PageTab.Review);
  const awaitingNextRoundRef = useRef(false);
  const currentRef = useRef<SavedSentence | undefined>(undefined);
  const resultRef = useRef<ResultView | null>(null);
  const wordAnswersRef = useRef<string[]>([]);
  const wordCountRef = useRef(0);
  const expectedWordsRef = useRef<string[]>([]);
  const spaceLongPressTimerRef = useRef<number | undefined>(undefined);
  const spaceLongPressActiveRef = useRef(false);
  const submitRef = useRef<() => void>(() => undefined);
  const skipRef = useRef<() => void>(() => undefined);
  const revealAnswerRef = useRef<() => void>(() => undefined);
  const goNextRef = useRef<() => void>(() => undefined);
  const goPreviousRef = useRef<() => void>(() => undefined);
  const focusBlankRef = useRef<(wordIndex: number) => void>(() => undefined);

  useEffect(() => {
    void (async () => {
      const [sentences, settings] = await Promise.all([
        getSentences(),
        getSettings(),
      ]);
      const now = Date.now();
      const due = getDueSentences(sentences, now, settings.dailyReviewLimit);
      const progress = await loadDailyReviewProgress(
        due.map((sentence) => sentence.id),
        now,
      );
      setQueue(due);
      setDailyProgress(progress);
      setVaultSentences(sortVaultSentences(sentences, now));
      setLoading(false);
    })();
  }, []);

  pageTabRef.current = pageTab;

  const current = queue[index];
  const progressSlots = buildProgressSlots(dailyProgress);
  const progressStats = progressSummary(dailyProgress);
  const awaitingNextRound =
    !loading &&
    !result &&
    isRoundComplete(dailyProgress) &&
    queue.length > 0;
  awaitingNextRoundRef.current = awaitingNextRound;

  const vaultNow = useMemo(() => Date.now(), [vaultSentences, pageTab]);
  const filteredVaultSentences = useMemo(
    () =>
      vaultSentences.filter((sentence) =>
        matchesVaultQuery(sentence, vaultQuery),
      ),
    [vaultSentences, vaultQuery],
  );

  const refreshVaultSentences = async () => {
    const sentences = await getSentences();
    setVaultSentences(sortVaultSentences(sentences, Date.now()));
  };

  const removeSentenceLocally = (sentenceId: string) => {
    setVaultSentences((items) => items.filter((item) => item.id !== sentenceId));
    setHistory((items) => items.filter((item) => item.id !== sentenceId));
    if (current?.id === sentenceId) {
      setResult(null);
    }
    const removedIndex = queue.findIndex((item) => item.id === sentenceId);
    if (removedIndex < 0) return;
    setQueue((items) => items.filter((item) => item.id !== sentenceId));
    if (removedIndex < index) {
      setIndex((value) => Math.max(0, value - 1));
    }
  };

  const deleteVaultSentence = async (sentence: SavedSentence) => {
    const confirmed = window.confirm(
      `确定删除这句？\n\n${sentence.zh}\n${sentence.en}`,
    );
    if (!confirmed) return;
    const deleted = await deleteSentence(sentence.id);
    if (!deleted) return;
    removeSentenceLocally(sentence.id);
  };

  const tokens = useMemo(
    () => (current ? tokenizeEnglish(current.en) : []),
    [current],
  );
  const wordCount = useMemo(
    () => tokens.filter((token) => token.type === 'word').length,
    [tokens],
  );

  currentRef.current = current;
  resultRef.current = result;
  wordAnswersRef.current = wordAnswers;
  wordCountRef.current = wordCount;
  expectedWordsRef.current = tokens
    .filter(
      (token): token is Extract<SentenceToken, { type: 'word' }> =>
        token.type === 'word',
    )
    .map((token) => token.text);

  const clearSpaceHint = () => {
    if (spaceLongPressTimerRef.current !== undefined) {
      window.clearTimeout(spaceLongPressTimerRef.current);
      spaceLongPressTimerRef.current = undefined;
    }
    spaceLongPressActiveRef.current = false;
    setSpaceHint(null);
  };

  useEffect(() => {
    setWordAnswers(Array.from({ length: wordCount }, () => ''));
    setResult(null);
    clearSpaceHint();
    inputRefs.current = [];
    requestAnimationFrame(() => {
      inputRefs.current[0]?.focus();
    });
  }, [current?.id, wordCount]);

  useEffect(() => {
    if (result) clearSpaceHint();
  }, [result]);

  const composedInput = useMemo(
    () => composeAnswer(tokens, wordAnswers),
    [tokens, wordAnswers],
  );

  useEffect(() => {
    if (!current || result || loading) return;
    const expectedWords = expectedWordsRef.current;
    if (
      expectedWords.length === 0 ||
      wordAnswers.length !== expectedWords.length
    ) {
      return;
    }
    const allMatched = expectedWords.every(
      (word, wordIndex) =>
        normalize(wordAnswers[wordIndex] ?? '') === normalize(word),
    );
    if (!allMatched) return;
    submitRef.current();
  }, [wordAnswers, current?.id, result, loading]);

  const hasAnyAnswer = wordAnswers.some((value) => value.trim().length > 0);

  const diffParts = useMemo(() => {
    if (!result || !current) return [];
    return diffWords(current.en, result.input);
  }, [result, current]);

  const focusBlank = (wordIndex: number) => {
    inputRefs.current[wordIndex]?.focus();
  };

  focusBlankRef.current = focusBlank;

  const patchCurrentInQueue = (sentence: SavedSentence) => {
    setQueue((items) =>
      items.map((item) => (item.id === sentence.id ? sentence : item)),
    );
  };

  const pushHistory = (sentence: SavedSentence) => {
    setHistory((items) => [...items, sentence]);
  };

  /** 未毕业：移到队尾继续练；已毕业/删除：从队列移除 */
  const advanceAfterResult = (outcome: ResultView, updated?: SavedSentence) => {
    if (!current) return;
    const leaving = updated ?? current;
    pushHistory(leaving);
    setResult(null);
    const withoutCurrent = queue.filter((item) => item.id !== leaving.id);
    const nextQueue =
      outcome.shouldDelete || outcome.graduated
        ? withoutCurrent
        : [...withoutCurrent, leaving];
    setQueue(nextQueue);
  };

  const beginNextRound = async () => {
    if (queue.length === 0) return;
    const nextProgress = await startNextRound(queue.map((item) => item.id));
    setDailyProgress(nextProgress);
    setIndex(0);
    setResult(null);
    setHistory([]);
    setWordAnswers([]);
  };

  const recordAndShowResult = async (
    judgment: Judgment,
    input: string,
    options?: { revealed?: boolean; score?: number },
  ) => {
    if (!current || busyRef.current) return;
    busyRef.current = true;
    try {
      const outcome = updateReviewAfterAnswer(current.review, judgment);
      if (outcome.shouldDelete) {
        await deleteSentence(current.id);
      } else {
        const saved = await updateSentence(current.id, (sentence) => ({
          ...sentence,
          review: outcome.review,
        }));
        if (saved) patchCurrentInQueue(saved);
      }
      setResult({
        judgment,
        score: options?.score ?? 0,
        input,
        nextReviewAt: outcome.review.nextReviewAt,
        consecutiveCorrect: outcome.review.consecutiveCorrect,
        graduated: outcome.graduated,
        shouldDelete: outcome.shouldDelete,
        revealed: options?.revealed,
      });
      const nextProgress = await markDailyCompleted(current.id);
      setDailyProgress(nextProgress);
    } finally {
      busyRef.current = false;
    }
  };

  const submit = async () => {
    if (!current || !hasAnyAnswer || result) return;
    const judged = judgeAnswer(composedInput, current.en);
    await recordAndShowResult(judged.judgment, composedInput, {
      score: judged.score,
    });
  };

  const revealAnswer = async () => {
    if (!current || result) return;
    const answers = tokens
      .filter((token): token is Extract<SentenceToken, { type: 'word' }> =>
        token.type === 'word',
      )
      .map((token) => token.text);
    setWordAnswers(answers);
    await recordAndShowResult(JUDGMENT.Wrong, current.en, {
      revealed: true,
      score: 0,
    });
  };

  const goNext = () => {
    if (!current) return;
    if (result) {
      advanceAfterResult(result, current);
      return;
    }
    pushHistory(current);
    setIndex((value) => value + 1);
  };

  goNextRef.current = goNext;

  const goPrevious = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory((items) => items.slice(0, -1));
    setResult(null);
    setQueue((items) => {
      const withoutDuplicate = items.filter((item) => item.id !== previous.id);
      const nextItems = [...withoutDuplicate];
      const insertAt = Math.min(index, nextItems.length);
      nextItems.splice(insertAt, 0, previous);
      return nextItems;
    });
  };

  goPreviousRef.current = goPrevious;

  const redo = () => {
    if (!current || !result || result.shouldDelete) return;
    setWordAnswers(Array.from({ length: wordCount }, () => ''));
    setResult(null);
    requestAnimationFrame(() => {
      inputRefs.current[0]?.focus();
    });
  };

  const skip = async () => {
    if (!current) return;
    if (result) {
      goNext();
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const outcome = updateReviewAfterAnswer(current.review, JUDGMENT.Wrong);
      const saved = await updateSentence(current.id, (sentence) => ({
        ...sentence,
        review: outcome.review,
      }));
      const nextItem = saved ?? {
        ...current,
        review: outcome.review,
      };
      pushHistory(nextItem);
      setQueue((items) => {
        const withoutCurrent = items.filter((item) => item.id !== current.id);
        return [...withoutCurrent, nextItem];
      });
      const nextProgress = await markDailySkipped(current.id);
      setDailyProgress(nextProgress);
    } finally {
      busyRef.current = false;
    }
  };

  submitRef.current = () => {
    void submit();
  };
  skipRef.current = () => {
    void skip();
  };
  revealAnswerRef.current = () => {
    void revealAnswer();
  };

  useEffect(() => {
    if (!shortcutsOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const anchor = shortcutsAnchorRef.current;
      if (!anchor || !(event.target instanceof Node)) return;
      if (!anchor.contains(event.target)) {
        setShortcutsOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShortcutsOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [shortcutsOpen]);

  useEffect(() => {
    const isOtherEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.classList.contains('word-blank')) return false;
      if (target.isContentEditable) return true;
      const tagName = target.tagName;
      return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
    };

    const focusedBlankIndex = (): number =>
      inputRefs.current.findIndex((element) => element === document.activeElement);

    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (pageTabRef.current !== PageTab.Review) return;
      if (!currentRef.current) return;
      if (awaitingNextRoundRef.current) return;
      if (isOtherEditableTarget(event.target)) return;

      const activeResult = resultRef.current;
      const activeWordCount = wordCountRef.current;

      if (event.key === 'ArrowLeft' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        goPreviousRef.current();
        return;
      }

      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        skipRef.current();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        if (
          activeResult &&
          isPassedJudgment(activeResult.judgment, activeResult.revealed)
        ) {
          goNextRef.current();
        } else if (!activeResult) {
          submitRef.current();
        }
        return;
      }

      if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
        if (activeResult) return;
        event.preventDefault();
        event.stopPropagation();
        revealAnswerRef.current();
        return;
      }

      const wordIndex = focusedBlankIndex();
      if (wordIndex < 0 || activeResult) return;

      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        if (wordIndex < activeWordCount - 1) {
          focusBlankRef.current(wordIndex + 1);
        }
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || spaceLongPressActiveRef.current) return;
        if (spaceLongPressTimerRef.current !== undefined) return;

        const hintWordIndex = wordIndex;
        spaceLongPressTimerRef.current = window.setTimeout(() => {
          spaceLongPressTimerRef.current = undefined;
          spaceLongPressActiveRef.current = true;
          const expected = expectedWordsRef.current[hintWordIndex] ?? '';
          const prefix = wordHintPrefix(expected);
          if (!prefix) return;
          setSpaceHint({ wordIndex: hintWordIndex, prefix });
        }, SPACE_LONG_PRESS_MS);
        return;
      }

      if (
        event.key === 'Backspace' &&
        (wordAnswersRef.current[wordIndex] ?? '') === '' &&
        wordIndex > 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        focusBlankRef.current(wordIndex - 1);
      }
    };

    const onWindowKeyUp = (event: globalThis.KeyboardEvent) => {
      if (pageTabRef.current !== PageTab.Review) return;
      if (awaitingNextRoundRef.current) return;
      if (!currentRef.current || resultRef.current) return;
      if (event.key !== ' ') return;

      event.preventDefault();
      event.stopPropagation();

      const wasLongPress = spaceLongPressActiveRef.current;
      const timerPending = spaceLongPressTimerRef.current !== undefined;
      if (spaceLongPressTimerRef.current !== undefined) {
        window.clearTimeout(spaceLongPressTimerRef.current);
        spaceLongPressTimerRef.current = undefined;
      }
      spaceLongPressActiveRef.current = false;
      setSpaceHint(null);

      if (wasLongPress || !timerPending) return;

      const wordIndex = focusedBlankIndex();
      if (wordIndex < 0) return;
      const activeWordCount = wordCountRef.current;
      if (wordIndex < activeWordCount - 1) {
        focusBlankRef.current(wordIndex + 1);
      } else {
        submitRef.current();
      }
    };

    window.addEventListener('keydown', onWindowKeyDown, true);
    window.addEventListener('keyup', onWindowKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown, true);
      window.removeEventListener('keyup', onWindowKeyUp, true);
    };
  }, []);

  const onBlankChange = (
    wordIndex: number,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    if (result) return;
    const stripped = event.target.value.replace(/\s+/g, '');
    const raw =
      wordIndex === FIRST_WORD_INDEX
        ? capitalizeFirstLetter(stripped)
        : stripped;
    setWordAnswers((currentAnswers) => {
      const next = [...currentAnswers];
      next[wordIndex] = raw;
      return next;
    });

    const expectedWord = expectedWordsRef.current[wordIndex] ?? '';
    const wordMatched = normalize(raw) === normalize(expectedWord);
    if (!wordMatched) return;

    if (wordIndex < wordCountRef.current - 1) {
      requestAnimationFrame(() => {
        focusBlankRef.current(wordIndex + 1);
      });
    }
  };

  const blankClassName = (wordIndex: number, expected: string): string => {
    if (result?.revealed) return 'word-blank is-revealed';

    const typedNormalized = normalize(wordAnswers[wordIndex] ?? '');
    const expectedNormalized = normalize(expected);

    if (result) {
      return typedNormalized === expectedNormalized
        ? 'word-blank is-correct'
        : 'word-blank is-wrong';
    }

    if (!typedNormalized) return 'word-blank';
    if (typedNormalized === expectedNormalized) return 'word-blank is-correct';
    if (expectedNormalized.startsWith(typedNormalized)) return 'word-blank';
    return 'word-blank is-wrong';
  };

  return (
    <div className="app-shell review-page">
      {pageTab === PageTab.Review && (
        <div
          className="review-progress-rail"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressStats.percent}
          aria-label={`第 ${progressStats.round} 轮进度 ${progressStats.percent}%（完成 ${progressStats.completedCount}，跳过 ${progressStats.skippedCount}）`}
        >
          {progressSlots.map((slot) => (
            <div
              key={slot.sentenceId}
              className={
                slot.state === ProgressSlotState.Completed
                  ? 'review-progress-slot is-completed'
                  : slot.state === ProgressSlotState.Skipped
                    ? 'review-progress-slot is-skipped'
                    : 'review-progress-slot is-pending'
              }
            />
          ))}
        </div>
      )}
      <header className="review-top">
        <div className="brand brand-lockup">
          <img
            className="brand-logo"
            src="/icons/icon48.png"
            width={22}
            height={22}
            alt=""
          />
          <h1>芒果句库</h1>
        </div>
        <nav className="review-tabs" aria-label="页面切换">
          <button
            type="button"
            className={
              pageTab === PageTab.Review ? 'review-tab is-active' : 'review-tab'
            }
            onClick={() => {
              setShortcutsOpen(false);
              setPageTab(PageTab.Review);
            }}
          >
            复习
          </button>
          <button
            type="button"
            className={
              pageTab === PageTab.Vault ? 'review-tab is-active' : 'review-tab'
            }
            onClick={() => {
              setShortcutsOpen(false);
              setPageTab(PageTab.Vault);
              void refreshVaultSentences();
            }}
          >
            仓库
          </button>
        </nav>
      </header>

      {pageTab === PageTab.Review && (
        <main className="review-stage">
          {loading && <p className="hint">加载中…</p>}
          {!loading && awaitingNextRound && (
            <div className="round-gate">
              <p className="round-gate-title">
                第 {progressStats.round} 轮完成
              </p>
              <p className="round-gate-desc">
                还有 {queue.length} 句需要继续巩固，开始下一轮？
              </p>
              <button
                className="btn"
                type="button"
                onClick={() => void beginNextRound()}
              >
                再复习一轮
              </button>
            </div>
          )}
          {!loading && !awaitingNextRound && !current && (
            <p className="empty">
              {isRoundComplete(dailyProgress)
                ? '今日复习完成。去网页再收藏一些句子吧。'
                : '今天没有待复习的句子。去网页划词收藏一些吧。'}
            </p>
          )}
          {!awaitingNextRound && current && (
            <>
              <p className="prompt">{current.zh}</p>

              <div className="blank-sentence" aria-label="按单词填空">
                {tokens.map((token, tokenIndex) => {
                  if (token.type === 'other') {
                    return (
                      <span key={`other-${tokenIndex}`} className="blank-other">
                        {token.text === ' ' ? '\u00a0' : token.text}
                      </span>
                    );
                  }

                  return (
                    <span
                      key={`word-${token.wordIndex}-${current.id}`}
                      className="blank-wrap"
                    >
                      {spaceHint?.wordIndex === token.wordIndex && (
                        <span className="word-hint" aria-live="polite">
                          {spaceHint.prefix}
                        </span>
                      )}
                      <input
                        ref={(element) => {
                          inputRefs.current[token.wordIndex] = element;
                        }}
                        className={blankClassName(token.wordIndex, token.text)}
                        style={{ width: `${blankWidthCh(token.text)}ch` }}
                        value={wordAnswers[token.wordIndex] ?? ''}
                        onChange={(event) =>
                          onBlankChange(token.wordIndex, event)
                        }
                        disabled={!!result}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        aria-label={`第 ${token.wordIndex + 1} 个单词`}
                      />
                    </span>
                  );
                })}
              </div>

              {result &&
                !isPassedJudgment(result.judgment, result.revealed) && (
                  <div className="result">
                    <p className="answer-reveal">{current.en}</p>
                    <p className="result-line">
                      <span className={`badge ${result.judgment}`}>
                        {result.revealed
                          ? '已查看原句'
                          : JUDGMENT_LABEL[result.judgment]}
                      </span>
                      {!result.revealed && (
                        <span className="result-aside">
                          你的答案：{result.input}
                        </span>
                      )}
                    </p>
                    {!result.revealed && result.judgment === JUDGMENT.Wrong && (
                      <div className="diff">
                        {diffParts.map((part, partIndex) => (
                          <span
                            key={`${part.type}-${partIndex}`}
                            className={part.type}
                          >
                            {part.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              <div className="actions">
                <button
                  className="btn"
                  type="button"
                  onClick={() => void submit()}
                  disabled={!hasAnyAnswer || !!result}
                >
                  提交
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => void revealAnswer()}
                  disabled={!!result}
                >
                  查看原句
                </button>
                {result && !result.shouldDelete && (
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={redo}
                  >
                    重做
                  </button>
                )}
                <button
                  className="btn secondary"
                  type="button"
                  onClick={goPrevious}
                  disabled={history.length === 0}
                >
                  上一句
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => void skip()}
                >
                  {result ? '下一句' : '跳过'}
                </button>
              </div>
            </>
          )}
        </main>
      )}

      {pageTab === PageTab.Review &&
        !awaitingNextRound &&
        current &&
        result &&
        isPassedJudgment(result.judgment, result.revealed) && (
          <div className="result-toast" role="status" aria-live="polite">
            <span className={`badge ${result.judgment}`}>
              {result.shouldDelete
                ? '已掌握，已删除'
                : result.graduated
                  ? '连对达标，暂时休息'
                  : JUDGMENT_LABEL[result.judgment]}
            </span>
            {!result.shouldDelete && result.graduated && (
              <span className="result-aside">
                {formatDateTime(result.nextReviewAt)} 再出现
              </span>
            )}
            {!result.shouldDelete && !result.graduated && (
              <span className="result-aside">
                连对 {result.consecutiveCorrect}/
                {CONSECUTIVE_CORRECT_TO_GRADUATE}
              </span>
            )}
            {result.graduated &&
              !result.shouldDelete &&
              current.review.intervalLevel > 0 && (
                <span className="result-aside">
                  间隔档{' '}
                  {REVIEW_INTERVALS_DAYS[
                    Math.min(
                      current.review.intervalLevel - 1,
                      REVIEW_INTERVALS_DAYS.length - 1,
                    )
                  ]}{' '}
                  天
                </span>
              )}
          </div>
        )}

      {pageTab === PageTab.Review && (
        <div className="shortcuts-anchor review-shortcuts" ref={shortcutsAnchorRef}>
          <button
            type="button"
            className={
              shortcutsOpen ? 'shortcuts-trigger is-open' : 'shortcuts-trigger'
            }
            aria-label="快捷键说明"
            aria-expanded={shortcutsOpen}
            aria-controls="review-shortcuts-popover"
            onClick={() => setShortcutsOpen((open) => !open)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <rect
                x="2.5"
                y="5"
                width="15"
                height="10"
                rx="2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M5.5 8h1.2M8.2 8h1.2M10.9 8h1.2M13.6 8h1.2M6.2 11.2h7.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {shortcutsOpen && (
            <div
              id="review-shortcuts-popover"
              className="shortcuts-popover"
              role="dialog"
              aria-label="快捷键说明"
            >
              <ul className="shortcuts-list">
                <li>
                  <kbd>Space</kbd>
                  <kbd>Tab</kbd>
                  <span>短按下一词</span>
                </li>
                <li>
                  <kbd>Space</kbd>
                  <span>长按提示前两字母</span>
                </li>
                <li>
                  <kbd>Enter</kbd>
                  <span>
                    {result &&
                    isPassedJudgment(result.judgment, result.revealed)
                      ? '下一句'
                      : '提交（全对时会自动提交）'}
                  </span>
                </li>
                <li>
                  <kbd>?</kbd>
                  <span>查看原句</span>
                </li>
                <li>
                  <kbd>Ctrl/⌘</kbd>
                  <kbd>←</kbd>
                  <span>上一句</span>
                </li>
                <li>
                  <kbd>Ctrl/⌘</kbd>
                  <kbd>Enter</kbd>
                  <span>跳过 / 下一句</span>
                </li>
                {result && !result.shouldDelete && (
                  <li>
                    <span className="shortcuts-note">结果后可点重做</span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {pageTab === PageTab.Vault && (
        <main className="vault-stage">
          <div className="vault-toolbar">
            <input
              className="vault-search"
              type="search"
              value={vaultQuery}
              onChange={(event) => setVaultQuery(event.target.value)}
              placeholder="搜索中文、英文或来源…"
              aria-label="搜索句子"
            />
            <p className="vault-count">
              {loading
                ? '…'
                : vaultQuery.trim()
                  ? `${filteredVaultSentences.length} / ${vaultSentences.length}`
                  : `${vaultSentences.length} 条`}
            </p>
          </div>
          {loading && <p className="hint">加载中…</p>}
          {!loading && vaultSentences.length === 0 && (
            <p className="empty">还没有收藏句子。去网页划词保存一些吧。</p>
          )}
          {!loading &&
            vaultSentences.length > 0 &&
            filteredVaultSentences.length === 0 && (
              <p className="empty">没有匹配的句子。</p>
            )}
          <ul className="vault-list">
            {filteredVaultSentences.map((sentence) => {
              const review = normalizeReviewState(sentence.review);
              const dueState = getVaultDueState(sentence, vaultNow);
              return (
                <li key={sentence.id} className="vault-item">
                  <div className="vault-item-main">
                    <p className="vault-zh">{sentence.zh}</p>
                    <p className="vault-en">{sentence.en}</p>
                    <div className="vault-meta">
                      <span
                        className={
                          dueState === VaultDueState.Due
                            ? 'vault-badge is-due'
                            : 'vault-badge is-waiting'
                        }
                      >
                        {dueState === VaultDueState.Due ? '待复习' : '间隔中'}
                      </span>
                      <span className="vault-meta-text">
                        连对 {review.consecutiveCorrect}/
                        {CONSECUTIVE_CORRECT_TO_GRADUATE}
                      </span>
                      <span className="vault-meta-text">
                        {dueState === VaultDueState.Due
                          ? '现在可复习'
                          : `${formatDateTime(review.nextReviewAt)} 再出现`}
                      </span>
                      {sentence.pageTitle &&
                        (sentence.url ? (
                          <a
                            className="vault-source"
                            href={sentence.url}
                            target="_blank"
                            rel="noreferrer"
                            title={sentence.url}
                          >
                            {sentence.pageTitle}
                          </a>
                        ) : (
                          <span className="vault-source is-plain">
                            {sentence.pageTitle}
                          </span>
                        ))}
                    </div>
                  </div>
                  <button
                    className="btn secondary vault-delete"
                    type="button"
                    onClick={() => void deleteVaultSentence(sentence)}
                  >
                    删除
                  </button>
                </li>
              );
            })}
          </ul>
        </main>
      )}
    </div>
  );
}
