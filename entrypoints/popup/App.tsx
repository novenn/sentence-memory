import { useEffect, useState } from 'react';
import { getSentences, getSettings } from '../../lib/storage';
import { getDueSentences } from '../../lib/review';
import { requestWarmUp } from '../../lib/translate-bridge';
import { MESSAGE_TYPE } from '../../lib/types';

export default function App() {
  const [dueCount, setDueCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [warmUpStatus, setWarmUpStatus] = useState('');
  const [warming, setWarming] = useState(false);

  useEffect(() => {
    void (async () => {
      const [sentences, settings] = await Promise.all([
        getSentences(),
        getSettings(),
      ]);
      setTotalCount(sentences.length);
      setDueCount(
        getDueSentences(sentences, Date.now(), settings.dailyReviewLimit).length,
      );
    })();
  }, []);

  const openReview = () => {
    void chrome.runtime.sendMessage({ type: MESSAGE_TYPE.OpenReview });
    window.close();
  };

  const openOptions = () => {
    void chrome.runtime.openOptionsPage();
  };

  const warmUp = async () => {
    setWarming(true);
    setWarmUpStatus('正在准备翻译模型…');
    try {
      const settings = await getSettings();
      await requestWarmUp(settings.sourceLanguage, settings.targetLanguage);
      setWarmUpStatus('翻译模型已就绪，可以划词翻译了');
    } catch (error) {
      setWarmUpStatus(
        error instanceof Error ? error.message : '准备失败，请检查 Chrome 语言设置',
      );
    } finally {
      setWarming(false);
    }
  };

  return (
    <div className="popup-body">
      <div className="brand">
        <div className="brand-lockup">
          <img
            className="brand-logo"
            src="/icons/icon48.png"
            width={28}
            height={28}
            alt=""
          />
          <h1>芒果句库</h1>
        </div>
        <p>划词即存，看中写英</p>
      </div>
      <div className="stats" style={{ marginBottom: 14 }}>
        <div className="stat">
          <span>待复习</span>
          <strong>{dueCount}</strong>
        </div>
        <div className="stat">
          <span>已收藏</span>
          <strong>{totalCount}</strong>
        </div>
      </div>
      <div className="popup-actions">
        <button className="btn" type="button" onClick={openReview}>
          开始复习
        </button>
        <button
          className="btn secondary"
          type="button"
          onClick={() => void warmUp()}
          disabled={warming}
        >
          {warming ? '准备中…' : '准备翻译模型'}
        </button>
        <button className="btn secondary" type="button" onClick={openOptions}>
          设置
        </button>
      </div>
      {warmUpStatus && <p className="toast">{warmUpStatus}</p>}
    </div>
  );
}
