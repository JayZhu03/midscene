import { setUiLanguage } from '@midscene/visualizer/ui-language';

// Existing Studio fixtures use English. The desktop startup separately
// hydrates the user's persisted choice (Chinese on first launch).
setUiLanguage('en');
