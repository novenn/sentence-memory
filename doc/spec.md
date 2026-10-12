# 芒果句库 MangoSentences — 需求文档

**版本**：v1.0  
**日期**：2026-10-11  
**状态**：待开发  
**目标浏览器**：Chrome 138+ 桌面版  
**技术核心**：Chrome 内置 Translator API（本地翻译，免费稳定）  
**项目代号**：Project JuYi  
**中文名**：芒果句库  
**英文名**：MangoSentences  
**Slogan**：划词即存，看中写英

---

## 0. 文档信息

| 项目 | 内容 |
|---|---|
| 产品名称 | 芒果句库 MangoSentences |
| 文档版本 | v1.0 |
| 创建日期 | 2026-10-11 |
| 目标平台 | Chrome 扩展（Manifest V3） |
| 目标用户 | 英语学习者、英文阅读者 |
| 核心功能 | 划词翻译、一键保存、看中文写英文复习 |
| 翻译方案 | Chrome 内置 Translator API |
| 数据存储 | chrome.storage.local / IndexedDB |
| 开发优先级 | 先跑通“划词 → 翻译 → 保存 → 复习”主链路 |

---

## 1. 项目概述

芒果句库（MangoSentences）是一款 Chrome 扩展，帮助英语学习者在浏览英文网站时：

1. 选中英文句子；
2. 自动翻译成中文；
3. 一键保存；
4. 后续复习时，只显示中文，用户默写英文原句；
5. 系统对比答案并安排下次复习。

所有翻译在本地完成，不依赖第三方 API，不需要密钥，不产生费用。

---

## 2. 目标与非目标

### 2.1 目标

- 划词即可翻译，翻译结果浮层可保存。
- 保存英文原句、中文翻译、来源 URL、页面标题、时间。
- 提供复习页面：显示中文，用户输入英文，自动对比。
- 数据本地存储，支持导入导出。
- 使用 Chrome 内置 Translator API，免费、稳定、隐私安全。

### 2.2 非目标

- 不做全页翻译。
- 不做单词本、语法讲解、发音评测。
- 不做云端账号系统。
- 不做移动端。
- MVP 不接入 Anki、FSRS 等复杂算法。

---

## 3. 目标用户

- 正在学习英语、经常阅读英文网站的用户。
- 希望收集地道句子，并通过“中译英”方式主动回忆的学习者。
- 对隐私敏感，不希望句子上传到第三方服务器的用户。
- 经常阅读英文技术文档、新闻、博客、论文的用户。

---

## 4. 核心用户故事

1. 作为用户，我在英文网页选中一个句子，希望立刻看到中文翻译。
2. 作为用户，我希望翻译浮层上有“保存”按钮，点击即可收藏。
3. 作为用户，我希望以后复习时只看到中文，然后默写英文原句。
4. 作为用户，我希望系统告诉我哪里写错了，并安排下次复习。
5. 作为用户，我希望数据保存在本地，并且可以导出备份。
6. 作为用户，我希望插件不要干扰我正常浏览网页。
7. 作为用户，我希望翻译速度快，并且不需要注册账号。

---

## 5. 功能需求

### 5.1 划词翻译

- 监听 `mouseup` 事件。
- 获取 `window.getSelection().toString().trim()`。
- 若选中文本为空，不处理。
- 若选中文本不是英文，可提示或忽略。
- 调用 Chrome 内置 Translator API，将英文翻译为中文。
- 翻译结果通过浮层展示。

### 5.2 翻译浮层

- 使用 Shadow DOM，避免页面样式污染。
- 位置：选区下方；若下方空间不足，显示在选区上方。
- 内容：
  - 中文翻译；
  - “保存”按钮；
  - “关闭”按钮。
- 点击“保存”后：
  - 按钮变为“已保存”并禁用；
  - 数据写入本地存储；
  - 若重复，提示“已存在”或静默忽略。
- 浮层最大宽度 360px，最大高度 240px，可滚动。
- 点击页面其他区域自动关闭浮层。

### 5.3 保存句子

保存字段：

```ts
interface SavedSentence {
  id: string;
  en: string;          // 英文原句
  zh: string;          // 中文翻译
  url: string;         // 来源 URL
  pageTitle: string;   // 页面标题
  createdAt: number;   // 创建时间
  updatedAt: number;   // 更新时间
  tags?: string[];
  review: {
    times: number;            // 复习次数
    correct: number;          // 正确次数
    lastReviewedAt?: number;  // 上次复习时间
    nextReviewAt: number;     // 下次复习时间
    intervalLevel: number;    // 间隔等级 0-4
  };
}
```

去重规则：

- 同一 `url` + 同一 `en` 视为重复。
- 重复时不新增，可更新 `zh`、`updatedAt`。

### 5.4 复习模式

- 入口：
  - 点击扩展图标 -> “开始复习”；
  - 或独立页面 `review.html`。
- 复习页逻辑：
  1. 读取所有 `nextReviewAt <= now` 的句子；
  2. 随机或按时间排序；
  3. 显示中文翻译；
  4. 用户输入英文原句；
  5. 点击“提交”；
  6. 系统对比答案；
  7. 显示英文原句、判定结果、差异；
  8. 更新复习数据；
  9. 进入下一句。
- 复习页显示今日待复习数量、已完成数量。

### 5.5 答案对比

规范化：

```ts
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

判定规则：

- 规范化后完全一致：正确。
- 否则计算相似度（Levenshtein）。
- 相似度 ≥ 90%：基本正确。
- 相似度 < 90%：错误。
- 显示原文，并高亮差异。

### 5.6 复习间隔算法（MVP）

固定间隔：

```ts
const intervals = [1, 3, 7, 14, 30]; // 天
```

更新逻辑：

- 正确：`intervalLevel + 1`，最高到 4。
- 错误：`intervalLevel = 0`。
- `times += 1`。
- `lastReviewedAt = now`。
- `nextReviewAt = now + intervals[intervalLevel] * 24 * 60 * 60 * 1000`。

### 5.7 设置页

- 目标语言：默认中文。
- 源语言：默认英语。
- 每日复习上限：默认 20。
- 是否自动保存：默认关闭。
- 数据导入 / 导出。
- 清空数据。

### 5.8 导入导出

- 导出格式：JSON。
- 导出内容：`sentences`、`settings`、`version`。
- 导入：合并数据，按 `id` 或 `url + en` 去重。

### 5.9 右键菜单（可选）

- 在 `chrome.contextMenus` 中添加“翻译并保存这句话”。
- 选中文本后右键点击，直接翻译并保存，不显示浮层。
- 保存成功后显示系统通知或扩展图标角标提示。

---

## 6. 非功能需求

| 类别 | 要求 |
|---|---|
| 性能 | 模型已下载时，翻译响应 < 1s；浮层显示 < 200ms |
| 可靠性 | 保存成功率 > 99%；刷新浏览器数据不丢失 |
| 隐私 | 所有数据本地存储；翻译本地完成 |
| 兼容性 | Chrome 138+ 桌面版 |
| 可维护性 | TypeScript + 模块化 |
| 可测试性 | 核心逻辑可单元测试 |
| 权限 | 最小必要权限，明确告知用户 |
| 界面 | 简洁、低干扰、支持深色模式 |
| 存储 | 默认 chrome.storage.local，数据量大时迁移 IndexedDB |
| 国际化 | MVP 仅中文界面 |

---

## 7. 技术方案

### 7.1 技术栈建议

- 构建：WXT 或 Plasmo
- 语言：TypeScript
- UI：React + Tailwind CSS（可选）
- 存储：`chrome.storage.local`（MVP），数据量大时迁移 IndexedDB
- 翻译：Chrome 内置 Translator API
- 测试：Vitest + Playwright（可选）

### 7.2 架构

```text
content script
  ├─ 监听划词
  ├─ 调用 Translator API
  ├─ 显示浮层
  └─ 保存到 chrome.storage.local

background service worker
  ├─ 安装初始化
  ├─ 右键菜单（可选）
  └─ 打开复习页

review.html
  ├─ 读取 sentences
  ├─ 显示中文
  ├─ 接收用户输入
  ├─ 对比答案
  └─ 更新复习数据

options.html
  ├─ 设置项
  └─ 导入导出
```

### 7.3 Chrome Translator API

要求：

- Chrome 138+ 桌面版。
- 语言对：`en` -> `zh`。
- 首次使用可能需要下载语言模型。
- 不支持 Web Worker，因此优先在 content script 或 offscreen document 中调用。

示例：

```ts
if ('Translator' in self) {
  const availability = await Translator.availability({
    sourceLanguage: 'en',
    targetLanguage: 'zh'
  });

  if (availability !== 'unavailable') {
    const translator = await Translator.create({
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          console.log(`模型下载进度: ${Math.round(e.loaded * 100)}%`);
        });
      }
    });

    const result = await translator.translate('This is a sample sentence.');
    console.log(result);

    translator.destroy();
  }
}
```

降级策略：

- API 不可用：提示用户升级 Chrome 138+ 桌面版。
- 模型下载中：显示进度。
- 翻译失败：提示用户重试或复制原文。

### 7.4 权限

```json
{
  "permissions": [
    "storage",
    "contextMenus",
    "unlimitedStorage"
  ],
  "host_permissions": ["<all_urls>"],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ]
}
```

如需 offscreen document：

```json
{
  "permissions": ["offscreen"]
}
```

### 7.5 目录结构建议

```text
src/
  manifest.json
  background.ts
  content/
    index.ts
    popup.css
  review/
    index.html
    index.tsx
  options/
    index.html
    index.tsx
  shared/
    types.ts
    storage.ts
    translator.ts
    review.ts
    utils.ts
```

---

## 8. 数据模型

```ts
interface Settings {
  sourceLanguage: string;   // 默认 'en'
  targetLanguage: string;   // 默认 'zh'
  dailyReviewLimit: number; // 默认 20
  autoSave: boolean;        // 默认 false
}

interface StorageSchema {
  sentences: SavedSentence[];
  settings: Settings;
  version: string;
}
```

---

## 9. 关键流程

### 9.1 划词翻译并保存

```text
用户选中英文句子
  -> content script 获取选中文本
  -> 检查 Translator API 可用性
  -> 翻译 en -> zh
  -> 显示浮层：中文 + 保存按钮
  -> 用户点击保存
  -> 去重检查
  -> 写入 chrome.storage.local
  -> 按钮变为“已保存”
```

### 9.2 复习

```text
用户打开复习页
  -> 读取 sentences
  -> 筛选 nextReviewAt <= now
  -> 显示中文
  -> 用户输入英文
  -> 提交
  -> 规范化对比
  -> 显示结果与原文
  -> 更新 review 数据
  -> 下一句
```

---

## 10. UI/UX 要求

### 10.1 翻译浮层

- 阴影、圆角、白底。
- 中文翻译字号 14px。
- 按钮：保存、关闭。
- 保存后按钮禁用并显示“已保存”。
- 使用 Shadow DOM 隔离样式。
- 支持深色模式，跟随系统。

### 10.2 复习页

- 顶部：今日待复习数量、已完成数量。
- 卡片：中文翻译、输入框、提交按钮。
- 提交后显示：
  - 你的答案；
  - 正确原文；
  - 判定：正确 / 基本正确 / 错误；
  - 下次复习时间。
- 支持键盘：Enter 提交，Ctrl+Enter 下一句。

### 10.3 设置页

- 源语言、目标语言。
- 每日复习上限。
- 导入 / 导出按钮。
- 清空数据按钮（二次确认）。

---

## 11. 开发里程碑

| 阶段 | 内容 | 预计时间 |
|---|---|---|
| M1 | 项目初始化、manifest、content script 划词监听 | 0.5 天 |
| M2 | 集成 Translator API，显示翻译浮层 | 1 天 |
| M3 | 保存到 storage，去重，导入导出 | 1 天 |
| M4 | 复习页、答案对比、复习算法 | 1.5 天 |
| M5 | UI 打磨、设置页、异常处理 | 1 天 |
| M6 | 测试、打包、发布 | 1 天 |

---

## 12. 验收标准

- [ ] Chrome 138+ 桌面版可安装。
- [ ] 英文网页选中句子，1 秒内显示中文浮层。
- [ ] 点击保存，数据写入本地存储。
- [ ] 重复保存同一句子，不产生重复数据。
- [ ] 打开复习页，显示中文，输入英文，提交后正确对比。
- [ ] 正确 / 错误判定符合规则。
- [ ] 复习后 `nextReviewAt` 正确更新。
- [ ] 刷新浏览器，数据不丢失。
- [ ] 导出 JSON 可重新导入。
- [ ] 无控制台报错。
- [ ] 翻译完全本地，无第三方网络请求。

---

## 13. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| Chrome 版本低于 138 | API 不可用 | 提示升级；降级为复制文本 |
| 语言模型未下载 | 首次翻译慢 | 显示下载进度；允许后台下载 |
| content script 中 API 不可用 | 无法翻译 | 使用 offscreen document |
| 浮层被页面样式影响 | UI 错乱 | 使用 Shadow DOM |
| 存储空间不足 | 保存失败 | 申请 `unlimitedStorage`；迁移 IndexedDB |
| 权限警告过多 | 用户不敢安装 | 明确说明用途；最小权限 |
| 复习答案差异大 | 误判 | 规范化 + 相似度 + 显示差异 |

---

## 14. 后续迭代

- 标签与搜索。
- 按来源网站筛选。
- 导出 Anki CSV。
- 接入 FSRS 间隔重复算法。
- 云同步（可选，端到端加密）。
- 移动端浏览器支持（若未来 Chrome 支持）。
- 发音播放。
- AI 生成例句填空。
- 句子上下文自动抓取。
- 生词高亮与生词本联动。

---

## 15. 发布清单

- [ ] 图标 16 / 32 / 48 / 128。
- [ ] 商店描述与截图。
- [ ] 隐私政策：说明数据仅本地存储。
- [ ] 打包 zip。
- [ ] 上传 Chrome Web Store。
- [ ] 版本号 `1.0.0`。
- [ ] 商店名称：芒果句库 MangoSentences。
- [ ] 商店副标题：划词翻译，看中文写英文。
- [ ] 商店分类：教育 / 生产力。

---

## 16. 命名与品牌

| 用途 | 名称 |
|---|---|
| 插件显示名 | 芒果句库 |
| 英文名 / 商店名 | MangoSentences |
| 项目代号 | Project JuYi |
| 图标文字 | 句 或 忆 |
| Slogan | 划词即存，看中写英 |
| 商店副标题 | 划词翻译复习助手 |
| 备选英文名 | MangoSentences |

---

## 17. 附录：manifest.json 示例

```json
{
  "manifest_version": 3,
  "name": "芒果句库 MangoSentences",
  "version": "1.0.0",
  "description": "划词翻译，一键保存，看中文写英文复习。",
  "permissions": [
    "storage",
    "contextMenus",
    "unlimitedStorage"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_title": "芒果句库"
  },
  "options_page": "options.html",
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## 18. 开发原则

1. 先跑通主链路：划词 → 翻译 → 保存 → 复习。
2. 翻译必须本地完成，不引入第三方 API 密钥。
3. 数据默认只存本地，不上传服务器。
4. UI 使用 Shadow DOM，避免污染宿主页面。
5. 所有核心逻辑可单元测试。
6. 权限最小化，隐私政策透明。
7. 每个版本可导出数据，避免用户数据被锁死。

---

**文档结束**