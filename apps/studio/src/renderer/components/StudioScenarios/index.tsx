import { Button, Form, Input, type InputRef, Modal } from 'antd';
import { useContext, useRef, useState } from 'react';
import { t, useStudioLanguage } from '../../i18n';
import { StudioPlaygroundContext } from '../../playground/useStudioPlayground';
import { EditIcon, TrashIcon } from '../Recorder/assets/recorder-icons';
import { StudioActionMenu } from '../StudioActionMenu';
import { StudioScenarioScripts } from './StudioScenarioScripts';
import {
  SCENARIO_DESCRIPTION_MAX_LENGTH,
  SCENARIO_NAME_MAX_LENGTH,
  type StudioScenario,
  deleteStudioScenario,
  loadStudioScenarios,
  saveStudioScenarios,
} from './storage';
import { TransferIcon, useStudioTransfer } from './useStudioTransfer';
import './studio-scenarios.css';

function ScenarioFolderIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
      <path
        d="M2.5 3.5h3l1.5 1.5h6.5v7a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.333"
      />
    </svg>
  );
}

function ScenarioPlusIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
      <path
        d="M8 3.5v9M3.5 8h9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.333"
      />
    </svg>
  );
}

export function StudioScenarios({ active }: { active: boolean }) {
  useStudioLanguage();
  const playground = useContext(StudioPlaygroundContext);
  const platformId: 'android' | 'web' =
    playground?.phase === 'ready' &&
    (playground.controller.state.runtimeInfo?.platformId ||
      playground.controller.state.formValues?.platformId) === 'android'
      ? 'android'
      : 'web';
  const [scenarios, setScenarios] = useState(loadStudioScenarios);
  const transfer = useStudioTransfer(() => {
    setScenarios(loadStudioScenarios());
    setQuery('');
  }, platformId);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameInvalid, setNameInvalid] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StudioScenario | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const nameInputRef = useRef<InputRef>(null);
  const selected = scenarios.find(
    (scenario) =>
      scenario.id === selectedId &&
      (scenario.platformId || 'web') === platformId,
  );
  const search = query.trim().toLocaleLowerCase();
  const visibleScenarios = scenarios.filter(
    (scenario) =>
      (scenario.platformId || 'web') === platformId &&
      `${scenario.name} ${scenario.description}`
        .toLocaleLowerCase()
        .includes(search),
  );

  const openEditor = (scenario?: StudioScenario) => {
    setEditing({ id: scenario?.id ?? null });
    setName(scenario?.name ?? '');
    setDescription(scenario?.description ?? '');
    setNameInvalid(false);
    setSaveError(null);
  };
  const persist = (next: StudioScenario[], onSaved: () => void) => {
    saveStudioScenarios(next);
    setScenarios(next);
    onSaved();
  };
  const save = () => {
    if (!editing) return;
    const trimmedName = name.trim();
    if (!trimmedName || name.length > SCENARIO_NAME_MAX_LENGTH) {
      setNameInvalid(true);
      return;
    }
    try {
      const now = Date.now();
      const next: StudioScenario[] = editing.id
        ? scenarios.map((scenario) =>
            scenario.id === editing.id
              ? {
                  ...scenario,
                  name: trimmedName,
                  description: description.trim(),
                  updatedAt: Math.max(now, scenario.updatedAt),
                }
              : scenario,
          )
        : [
            ...scenarios,
            {
              id: crypto.randomUUID(),
              platformId,
              name: trimmedName,
              description: description.trim(),
              createdAt: now,
              updatedAt: now,
            },
          ];
      persist(next, () => setEditing(null));
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Unable to save scenarios locally. Please retry.',
      );
    }
  };
  const remove = async () => {
    if (!deleting || deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      const next = await deleteStudioScenario(deleting.id);
      setScenarios(next);
      if (selectedId === deleting.id) setSelectedId(null);
      setDeleting(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : 'Unable to save scenarios locally. Please retry.',
      );
    } finally {
      setDeletePending(false);
    }
  };
  const actions = (scenario: StudioScenario) =>
    active ? (
      <StudioActionMenu
        ariaLabel={t('Scenario actions')}
        items={[
          {
            icon: <TransferIcon />,
            label: t('Export scenario'),
            onClick: () => transfer.openExport(scenario),
          },
          {
            icon: <EditIcon />,
            label: t('Edit scenario'),
            onClick: () => openEditor(scenario),
          },
          {
            danger: true,
            icon: <TrashIcon />,
            label: t('Delete scenario'),
            onClick: () => {
              setDeleting(scenario);
              setDeleteError(null);
            },
          },
        ]}
        triggerClassName="studio-scenario-actions"
      />
    ) : null;

  return (
    <section
      aria-hidden={!active}
      className="studio-scenarios"
      style={active ? undefined : { display: 'none' }}
    >
      {selected ? (
        <StudioScenarioScripts
          key={selected.id}
          scenario={selected}
          active={active}
          onBack={() => setSelectedId(null)}
        />
      ) : (
        <div className="studio-scenario-panel">
          <header className="studio-scenario-toolbar">
            <h2 className="studio-scenario-panel-title">
              {t('Scenario list')}
            </h2>
            <div className="studio-scenario-toolbar-actions">
              <Button
                className="studio-scenario-create"
                icon={<TransferIcon upload />}
                type="text"
                onClick={() => transfer.openImport('scenario')}
              >
                {t('Import')}
              </Button>
              <Button
                className="studio-scenario-create"
                icon={<ScenarioPlusIcon />}
                onClick={() => openEditor()}
                type="text"
              >
                {t('New')}
              </Button>
            </div>
          </header>
          <div className="studio-scenario-search">
            <Input
              allowClear
              placeholder={t('Search scenarios')}
              aria-label={t('Search scenarios')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="studio-scenario-panel-body">
            {visibleScenarios.length ? (
              <div className="studio-scenario-list">
                {visibleScenarios.map((scenario) => (
                  <div className="studio-scenario-row" key={scenario.id}>
                    <button
                      className="studio-scenario-select"
                      onClick={() => setSelectedId(scenario.id)}
                      type="button"
                    >
                      <ScenarioFolderIcon />
                      <span className="studio-scenario-copy">
                        <span
                          className="studio-scenario-name"
                          title={scenario.name}
                        >
                          {scenario.name}
                        </span>
                        {scenario.description ? (
                          <span
                            className="studio-scenario-description"
                            title={scenario.description}
                          >
                            {scenario.description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {actions(scenario)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="studio-scenario-empty">
                {t(
                  scenarios.length
                    ? 'No matching scenarios'
                    : 'No scenarios yet',
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {transfer.dialog}
      <Modal
        afterOpenChange={(open) => {
          if (open) nameInputRef.current?.focus();
        }}
        cancelText={t('Cancel')}
        maskClosable={false}
        okText={t('Save')}
        onCancel={() => setEditing(null)}
        onOk={save}
        open={active && editing !== null}
        title={t(editing?.id ? 'Edit scenario' : 'New scenario')}
        width={400}
      >
        <Form component="div" layout="vertical">
          <Form.Item
            htmlFor="studio-scenario-name"
            help={nameInvalid ? t('Please enter a scenario name.') : undefined}
            label={t('Scenario name')}
            required
            validateStatus={nameInvalid ? 'error' : undefined}
          >
            <Input
              id="studio-scenario-name"
              aria-label={t('Scenario name')}
              maxLength={SCENARIO_NAME_MAX_LENGTH}
              onChange={(event) => {
                setName(event.target.value);
                setNameInvalid(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  save();
                }
              }}
              ref={nameInputRef}
              value={name}
            />
          </Form.Item>
          <Form.Item
            htmlFor="studio-scenario-description"
            label={t('Scenario description (optional)')}
          >
            <Input.TextArea
              id="studio-scenario-description"
              aria-label={t('Scenario description (optional)')}
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={SCENARIO_DESCRIPTION_MAX_LENGTH}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </Form.Item>
        </Form>
        {saveError ? (
          <div className="studio-scenario-error" role="alert">
            {t(saveError)}
          </div>
        ) : null}
      </Modal>
      <Modal
        closable={!deletePending}
        confirmLoading={deletePending}
        cancelButtonProps={{ disabled: deletePending }}
        cancelText={t('Cancel')}
        maskClosable={false}
        okButtonProps={{ danger: true }}
        okText={t('Delete')}
        onCancel={() => {
          if (!deletePending) setDeleting(null);
        }}
        onOk={remove}
        open={active && deleting !== null}
        title={t('Delete scenario')}
        width={360}
      >
        <p>{t('Delete this scenario?')}</p>
        <p className="studio-scenario-delete-name">{deleting?.name}</p>
        {deleteError ? (
          <div className="studio-scenario-error" role="alert">
            {t(deleteError)}
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
