import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '芒果句库 MangoSentences',
    description: '划词翻译，一键保存，看中文写英文复习。',
    version: '1.0.1',
    permissions: [
      'storage',
      'contextMenus',
      'unlimitedStorage',
      'notifications',
      'offscreen',
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '芒果句库',
    },
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },
});
