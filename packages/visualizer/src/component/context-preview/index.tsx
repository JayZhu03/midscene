import type { UIContext } from '@midscene/core';
import { Button } from 'antd';
import type React from 'react';
import Blackboard from '../blackboard';
import { iconForStatus } from '../misc';
import DemoData from '../playground/playground-demo-ui-context.json';
import './index.less';

interface ContextPreviewProps {
  uiContextPreview: UIContext | undefined;
  setUiContextPreview: (context: UIContext) => void;
  showContextPreview: boolean;
}

export const ContextPreview: React.FC<ContextPreviewProps> = ({
  uiContextPreview,
  setUiContextPreview,
  showContextPreview,
}) => {
  if (!showContextPreview) {
    return null;
  }

  return (
    <div className="form-part context-panel">
      <h3>页面信息</h3>
      {uiContextPreview ? (
        <Blackboard uiContext={uiContextPreview} hideController />
      ) : (
        <div>
          {iconForStatus('failed')} 暂无页面信息
          <Button
            type="link"
            onClick={(e) => {
              e.preventDefault();
              setUiContextPreview(DemoData as unknown as UIContext);
            }}
          >
            加载示例
          </Button>
          <div>
            要加载页面信息，可使用上方示例数据，或在报告页面点击「发送到操作调试」。
          </div>
        </div>
      )}
    </div>
  );
};
