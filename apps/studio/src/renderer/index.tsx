import { initializeStudioPreferences } from './studio-preferences-backup';

void initializeStudioPreferences()
  .then(() => import('./bootstrap'))
  .catch(() => {
    const root = document.getElementById('root');
    if (root) {
      root.textContent =
        '本地数据读取失败，请关闭并重启 Studio。为保护已有记录，暂未载入空白配置。';
    }
  });
