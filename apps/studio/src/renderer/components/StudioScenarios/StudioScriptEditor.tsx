import { Button, Dropdown, Input } from 'antd';
import { Fragment, useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import {
  CheckIcon,
  EditIcon,
  TrashIcon,
} from '../Recorder/assets/recorder-icons';
import {
  type ScenarioScriptStep,
  agentStepInstruction,
  createAgentStep,
} from './script-model';

export function StudioScriptEditor({
  steps,
  onChange,
  onCancel,
  onSave,
  busy,
  focusStepId,
}: {
  steps: ScenarioScriptStep[];
  onChange: (steps: ScenarioScriptStep[]) => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
  focusStepId?: string;
}) {
  const [expanded, setExpanded] = useState<string | undefined>(focusStepId);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = Array.from(
      container.current?.querySelectorAll<HTMLElement>('[data-step-id]') || [],
    ).find((item) => item.dataset.stepId === expanded);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded]);
  const insertAt = (index: number) => (
    <div className="studio-script-insert">
      <Dropdown
        trigger={['click']}
        disabled={busy}
        overlayClassName="studio-scenario-menu"
        menu={{
          items: [
            {
              key: 'agent-assertion',
              label: t('Add assertion'),
              icon: <CheckIcon />,
            },
            {
              key: 'agent-operation',
              label: t('Add Agent operation'),
              icon: <EditIcon />,
            },
          ],
          onClick: ({ key }) => {
            if (busy) return;
            const step = createAgentStep(
              key as 'agent-assertion' | 'agent-operation',
            );
            onChange([...steps.slice(0, index), step, ...steps.slice(index)]);
            setExpanded(step.id);
          },
        }}
      >
        <Button
          type="text"
          size="small"
          disabled={busy}
          aria-label={`${t('Insert step')} ${index + 1}`}
          title={t('Insert step')}
        >
          +
        </Button>
      </Dropdown>
    </div>
  );
  return (
    <>
      <div className="studio-script-editor" ref={container}>
        {steps.map((step, index) => {
          const editable = step.type !== 'playwright-operation';
          return (
            <Fragment key={step.id}>
              {insertAt(index)}
              <div className="studio-script-editor-row" data-step-id={step.id}>
                <span className="studio-script-editor-index">{index + 1}</span>
                <div className="studio-script-editor-content">
                  {editable ? (
                    <div className="studio-script-editor-type">
                      {step.type === 'agent-assertion'
                        ? t('Assertion')
                        : t('Agent operation')}
                    </div>
                  ) : null}
                  {editable && expanded === step.id ? (
                    <Input.TextArea
                      autoFocus
                      aria-label={t('Step instruction')}
                      placeholder={t(
                        step.type === 'agent-assertion'
                          ? 'Describe the expected result'
                          : 'Describe what Agent should do',
                      )}
                      autoSize={{ minRows: 2, maxRows: 8 }}
                      maxLength={100000}
                      disabled={busy}
                      value={step.instruction}
                      onChange={(event) =>
                        onChange(
                          steps.map((item) =>
                            item.id === step.id
                              ? agentStepInstruction(item, event.target.value)
                              : item,
                          ),
                        )
                      }
                    />
                  ) : (
                    <div className="studio-script-editor-description">
                      {step.description}
                    </div>
                  )}
                </div>
                {editable ? (
                  <Dropdown
                    trigger={['click']}
                    disabled={busy}
                    overlayClassName="studio-scenario-menu"
                    menu={{
                      items: [
                        {
                          key: 'edit',
                          label: t('Edit step'),
                          icon: <EditIcon />,
                        },
                        {
                          key: 'delete',
                          label: t('Delete'),
                          danger: true,
                          icon: <TrashIcon />,
                        },
                      ],
                      onClick: ({ key }) => {
                        if (busy) return;
                        if (key === 'edit') setExpanded(step.id);
                        else
                          onChange(steps.filter((item) => item.id !== step.id));
                      },
                    }}
                  >
                    <Button
                      type="text"
                      size="small"
                      disabled={busy}
                      aria-label={`${t('Step actions')} ${index + 1}`}
                    >
                      •••
                    </Button>
                  </Dropdown>
                ) : null}
              </div>
            </Fragment>
          );
        })}
        {insertAt(steps.length)}
      </div>
      <div className="studio-script-editor-footer">
        <Button disabled={busy} onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button
          type="primary"
          loading={busy}
          disabled={
            busy ||
            !steps.length ||
            steps.some(
              (step) =>
                step.type !== 'playwright-operation' &&
                !step.instruction.trim(),
            )
          }
          onClick={onSave}
        >
          {t('Save changes')}
        </Button>
      </div>
    </>
  );
}
