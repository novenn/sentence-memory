import { useEffect, useRef, useState } from 'react';
import {
  clearAllData,
  exportData,
  getSettings,
  importData,
  saveSettings,
} from '../../lib/storage';
import { DEFAULT_SETTINGS, type ExportPayload, type Settings } from '../../lib/types';
import { downloadJson } from '../../lib/utils';

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState('');
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  const updateSetting = <Key extends keyof Settings>(
    key: Key,
    value: Settings[Key],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const persist = async () => {
    await saveSettings(settings);
    setToast('设置已保存');
  };

  const handleExport = async () => {
    const payload = await exportData();
    downloadJson(`sentence-memory-${Date.now()}.json`, payload);
    setToast('导出完成');
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    const payload = JSON.parse(text) as ExportPayload;
    const result = await importData(payload);
    setToast(`导入完成：合并 ${result.imported} 条，跳过 ${result.skipped} 条`);
    setSettings(await getSettings());
  };

  const handleClear = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await clearAllData();
      setSettings(DEFAULT_SETTINGS);
      setClearConfirmOpen(false);
      setToast('数据已清空');
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : '清空失败，请重试',
      );
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="brand">
        <h1>芒果句库 · 设置</h1>
        <p>本地翻译与本地数据，隐私优先</p>
      </div>

      <div className="panel">
        <div className="field">
          <label htmlFor="sourceLanguage">源语言</label>
          <select
            id="sourceLanguage"
            value={settings.sourceLanguage}
            onChange={(event) => updateSetting('sourceLanguage', event.target.value)}
          >
            <option value="en">英语 (en)</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="targetLanguage">目标语言</label>
          <select
            id="targetLanguage"
            value={settings.targetLanguage}
            onChange={(event) => updateSetting('targetLanguage', event.target.value)}
          >
            <option value="zh">中文 (zh)</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="dailyReviewLimit">每日复习上限</label>
          <input
            id="dailyReviewLimit"
            type="number"
            min={1}
            max={200}
            value={settings.dailyReviewLimit}
            onChange={(event) =>
              updateSetting('dailyReviewLimit', Number(event.target.value) || 20)
            }
          />
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.autoSave}
            onChange={(event) => updateSetting('autoSave', event.target.checked)}
          />
          翻译后自动保存
        </label>

        <div className="actions">
          <button className="btn" type="button" onClick={() => void persist()}>
            保存设置
          </button>
          <button className="btn secondary" type="button" onClick={() => void handleExport()}>
            导出 JSON
          </button>
          <button
            className="btn secondary"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            导入 JSON
          </button>
        </div>

        <div className="danger-zone">
          <p className="danger-zone-hint">
            清空后句子与设置将无法恢复，请先导出备份。
          </p>
          {!clearConfirmOpen ? (
            <button
              className="btn danger"
              type="button"
              onClick={() => setClearConfirmOpen(true)}
            >
              清空数据
            </button>
          ) : (
            <div className="danger-zone-confirm">
              <p className="danger-zone-confirm-text">
                确定清空全部句子与设置？此操作不可恢复。
              </p>
              <div className="actions">
                <button
                  className="btn danger"
                  type="button"
                  disabled={clearing}
                  onClick={() => void handleClear()}
                >
                  {clearing ? '清空中…' : '确认清空'}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={clearing}
                  onClick={() => setClearConfirmOpen(false)}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImportFile(file);
            event.target.value = '';
          }}
        />

        {toast && <p className="toast">{toast}</p>}
      </div>
    </div>
  );
}
