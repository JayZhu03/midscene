import type {
  ExecutionDump,
  ExecutionTask,
  ReportActionDump,
} from '@midscene/core';
import type { ScenarioRunState } from '@midscene/playground';
import { expect, test } from '@rstest/core';
import type { PlaywrightTasks } from '../../types';
import {
  createScenarioEvidenceResolver,
  parseScenarioReportDump,
  scenarioDisplayStepGroups,
  scenarioEvidenceFor,
  scenarioFrameIndex,
  scenarioGroupFrameIndex,
  scenarioOperationDetails,
  scenarioStepForTask,
  scenarioStepLabel,
} from './model';

function fixture() {
  const screenshot = (id: string) => ({
    base64: `data:image/png;base64,${id}`,
    sourceRef: { id },
    capturedAt: 100,
  });
  const executions = [
    {
      id: 'input-exec',
      tasks: [
        {
          taskId: 'input-task',
          uiContext: { screenshot: screenshot('before') },
          recorder: [{ screenshot: screenshot('input-final'), ts: 200 }],
        },
      ],
    },
    {
      id: 'agent-exec',
      tasks: [
        {
          taskId: 'agent-start',
          uiContext: { screenshot: screenshot('observed') },
        },
        {
          taskId: 'agent-action',
          recorder: [{ screenshot: screenshot('agent-final') }],
        },
      ],
    },
  ] as unknown as ExecutionDump[];
  const run: ScenarioRunState = {
    id: 'run',
    scenarioId: 's',
    status: 'completed',
    scriptIndex: 0,
    stepIndex: 0,
    scripts: [
      {
        id: 's',
        name: 'Orders',
        status: 'passed',
        completedSteps: 3,
        totalSteps: 3,
        steps: ['one', 'two', 'three'].map((id) => ({
          id,
          type: 'playwright-operation',
          description: id,
          status: 'passed',
        })),
      },
    ],
    evidenceLinks: [
      {
        scriptIndex: 0,
        stepIds: ['one', 'two'],
        taskId: 'input-task',
        label: 'Input outcome',
      },
      {
        scriptIndex: 0,
        stepIds: ['three'],
        taskId: 'agent-start',
        label: 'Agent operation',
      },
    ],
  };
  let reads = 0;
  const reports = [
    {
      get: () => {
        reads++;
        return { executions } as ReportActionDump;
      },
    },
  ] as PlaywrightTasks[];
  return { run, reports, reads: () => reads, executions };
}

test('lazy evidence index preserves explicit mappings and shared final input frames', () => {
  const { run, reports, reads } = fixture();
  const resolve = createScenarioEvidenceResolver(reports);
  expect(reads()).toBe(0);
  const first = scenarioEvidenceFor(run, 0, 'one', resolve);
  expect(first.shared).toBe(true);
  expect(first.frames.at(-1)?.screenshot.sourceRef?.id).toBe('input-final');
  const second = scenarioEvidenceFor(run, 0, 'two', resolve);
  expect(second.frames.at(-1)?.screenshot.sourceRef?.id).toBe('input-final');
  expect(
    second.frames.some(
      (frame) => frame.screenshot.sourceRef?.id === 'agent-final',
    ),
  ).toBe(false);
  expect(reads()).toBe(1);
});

test('missing task or different script never borrows another screenshot', () => {
  const { run, reports } = fixture();
  const resolve = createScenarioEvidenceResolver(reports);
  run.evidenceLinks![0].taskId = 'missing';
  expect(scenarioEvidenceFor(run, 0, 'one', resolve)).toMatchObject({
    missing: true,
    frames: [],
  });
  expect(scenarioEvidenceFor(run, 1, 'three', resolve).frames).toEqual([]);
});

test('whole-script replay deduplicates shared inputs and maps Agent subactions to their owning step', () => {
  const { run, reports } = fixture();
  const resolve = createScenarioEvidenceResolver(reports);
  const evidence = scenarioEvidenceFor(run, 0, undefined, resolve);
  expect(evidence.executions).toHaveLength(2);
  expect(scenarioStepForTask(run, 0, 'input-task', resolve)).toBe(1);
  expect(scenarioStepForTask(run, 0, 'agent-action', resolve)).toBe(2);
  expect(scenarioStepForTask(run, 0, 'unknown', resolve)).toBeUndefined();
});

test('duplicate screenshot refs keep a single frame without reading base64 during indexing', () => {
  const { run, reports, executions } = fixture();
  const task = executions[0].tasks[0] as ExecutionTask;
  Object.defineProperty(task.uiContext!.screenshot, 'base64', {
    get() {
      throw new Error('Must stay lazy');
    },
  });
  task.recorder!.push(task.recorder![0]);
  const evidence = scenarioEvidenceFor(
    run,
    0,
    'one',
    createScenarioEvidenceResolver(reports),
  );
  expect(evidence.frames).toHaveLength(2);
});

test('report envelope validates data and preserves literal user instructions', () => {
  const { run } = fixture();
  run.scripts[0].steps![0].description = '<script>not executable</script>';
  expect(parseScenarioReportDump(JSON.stringify(run))).toEqual(run);
  for (const invalid of [{}, { ...run, scripts: [{ name: 42 }] }]) {
    expect(() => parseScenarioReportDump(JSON.stringify(invalid))).toThrow(
      'Invalid Studio',
    );
  }
});

test('display groups combine only consecutive passed edits with shared evidence and keep all step indices', () => {
  const { run } = fixture();
  expect(
    scenarioDisplayStepGroups(run, 0).map((group) => group.indices),
  ).toEqual([[0, 1], [2]]);
  run.scripts[0].steps![1].status = 'failed';
  expect(
    scenarioDisplayStepGroups(run, 0).map((group) => group.indices),
  ).toEqual([[0], [1], [2]]);
  run.scripts[0].steps![1].status = 'passed';
  run.scripts[0].steps![1].recovery = {
    status: 'recovered',
    originalError: 'Input missing',
    startedAt: 1,
  };
  expect(
    scenarioDisplayStepGroups(run, 0).map((group) => group.indices),
  ).toEqual([[0], [1], [2]]);
});

test('a form is one readable action while submit and Agent check remain independent', () => {
  const { run } = fixture();
  const edit = (
    id: string,
    action: string,
    target: string,
    description = id,
  ) => ({
    id,
    type: 'playwright-operation' as const,
    status: 'passed' as const,
    description,
    presentation: {
      action,
      target,
      editable: true,
      page: '登录',
      url: 'https://test/login',
    },
  });
  run.scripts[0].steps = [
    edit('focus-user', 'click', '用户名'),
    edit(
      'caps',
      'keydown',
      '用户名',
      'Press CapsLock on target element in 登录',
    ),
    edit('user-one', 'input', '用户名'),
    edit('user-final', 'input', '用户名'),
    edit('focus-password', 'click', '密码'),
    edit('password', 'input', '密码'),
    {
      ...edit('submit', 'click', '登录'),
      presentation: {
        action: 'click',
        target: '登录',
        page: '登录',
        url: 'https://test/login',
        editable: false,
      },
    },
    {
      id: 'assert',
      type: 'agent-assertion',
      status: 'failed',
      description: '显示工作台',
      error: '仍显示登录页',
    },
  ];
  run.evidenceLinks = [
    {
      scriptIndex: 0,
      stepIds: ['caps', 'user-one', 'user-final'],
      taskId: 'user',
      label: '',
    },
  ];
  const before = JSON.stringify(run);
  const groups = scenarioDisplayStepGroups(run, 0);
  expect(groups.map((group) => group.indices)).toEqual([
    [0, 1, 2, 3, 4, 5],
    [6],
    [7],
  ]);
  expect(groups[0]).toMatchObject({
    title: '填写表单',
    targets: ['用户名', '密码'],
  });
  expect(groups[1].title).toBe('点击“登录”');
  expect(groups[2].title).toBe('显示工作台');
  expect(JSON.stringify(run)).toBe(before);
});

test('unknown page clicks may be summarized but failures, recovery and pages are boundaries', () => {
  const { run } = fixture();
  const click = (id: string, page = '生产订单') => ({
    id,
    type: 'playwright-operation' as const,
    status: 'passed' as const,
    description: `Tap target element in ${page} - KMMOM CLOUD`,
  });
  run.scripts[0].steps = [
    click('one'),
    click('two'),
    { ...click('failed'), status: 'failed' },
    click('three'),
    {
      ...click('recovered'),
      recovery: {
        status: 'recovered',
        originalError: 'Locator missing',
        startedAt: 1,
      },
    },
    click('four', '制造任务'),
    click('five', '制造任务'),
  ];
  run.evidenceLinks = [];
  const groups = scenarioDisplayStepGroups(run, 0);
  expect(groups.map((group) => group.indices)).toEqual([
    [0, 1],
    [2],
    [3],
    [4],
    [5, 6],
  ]);
  expect(groups[0].title).toBe('生产订单页面操作');
  expect(groups.flatMap((group) => group.indices)).toEqual([
    0, 1, 2, 3, 4, 5, 6,
  ]);
});

test('passive route notifications stay in details and do not merge form edits across pages', () => {
  const { run } = fixture();
  run.scripts[0].steps = [
    {
      id: 'one',
      type: 'playwright-operation',
      status: 'passed',
      description:
        'Input into unresolved input field in the current visible UI',
    },
    {
      id: 'url',
      type: 'playwright-operation',
      status: 'passed',
      description: 'Navigate to https://test/next',
      detail:
        'Observed URL is recording context; no navigation outcome was verified.',
    },
    {
      id: 'two',
      type: 'playwright-operation',
      status: 'passed',
      description:
        'Input into unresolved input field in the current visible UI',
    },
  ];
  run.evidenceLinks = [];
  expect(
    scenarioDisplayStepGroups(run, 0).map((group) => group.indices),
  ).toEqual([[0, 1], [2]]);
  run.evidenceLinks = [
    {
      scriptIndex: 0,
      taskId: 'same-input',
      stepIds: ['one', 'two'],
      label: '',
    },
  ];
  expect(
    scenarioDisplayStepGroups(run, 0).map((group) => group.indices),
  ).toEqual([[0, 1, 2]]);
});

test('logical action evidence is the ordered union of its exact source steps', () => {
  const { run, reports } = fixture();
  const resolve = createScenarioEvidenceResolver(reports);
  expect(
    scenarioEvidenceFor(run, 0, ['one', 'two', 'three'], resolve).executions,
  ).toHaveLength(2);
  expect(
    scenarioEvidenceFor(run, 0, ['one', 'two'], resolve).executions,
  ).toHaveLength(1);
  expect(
    scenarioStepLabel({
      ...run.scripts[0].steps![0],
      description: 'Tap 释放按钮',
    }).title,
  ).toBe('点击“释放按钮”');
});

test('grouped actions select only their own pictures and keep capture phases separate', () => {
  const { run, reports, executions } = fixture();
  const input = executions[0].tasks[0];
  input.type = 'Action Space';
  const after = input.recorder![0].screenshot!;
  input.uiContext!.screenshot = after;
  input.recorder!.push(input.recorder![0]);
  run.evidenceLinks![0].pageSettled = false;
  const evidence = scenarioEvidenceFor(
    run,
    0,
    ['one', 'two', 'three'],
    createScenarioEvidenceResolver(reports),
  );
  const inputIndex = scenarioFrameIndex(evidence.frames, ['one']);
  expect(inputIndex).not.toBeUndefined();
  expect(evidence.frames[inputIndex!]).toMatchObject({
    phase: 'after',
    pageSettled: false,
    stepIds: ['one', 'two'],
    taskId: 'input-task',
  });
  expect(
    evidence.frames.filter((frame) => frame.taskId === 'input-task'),
  ).toHaveLength(1);
  const agentIndex = scenarioFrameIndex(evidence.frames, ['three']);
  expect(evidence.frames[agentIndex!].taskId).toBe('agent-action');
  expect(scenarioFrameIndex(evidence.frames, ['missing'])).toBeUndefined();
  const passiveRoute = {
    ...run.scripts[0].steps![2],
    id: 'url-context',
    detail:
      'Observed URL is recording context; no navigation outcome was verified.',
  };
  expect(
    scenarioGroupFrameIndex(evidence.frames, [
      run.scripts[0].steps![0],
      passiveRoute,
    ]),
  ).toBe(inputIndex);
  expect(
    scenarioGroupFrameIndex(evidence.frames, [
      run.scripts[0].steps![0],
      { ...passiveRoute, detail: undefined },
    ]),
  ).toBeUndefined();
});

test('frame order follows capture time, not link or report-write order', () => {
  const { run, reports, executions } = fixture();
  run.evidenceLinks!.reverse();
  Object.assign(executions[0].tasks[0].uiContext!.screenshot, {
    capturedAt: 10,
  });
  Object.assign(executions[0].tasks[0].recorder![0].screenshot!, {
    capturedAt: 20,
  });
  const evidence = scenarioEvidenceFor(
    run,
    0,
    undefined,
    createScenarioEvidenceResolver(reports),
  );
  expect(evidence.frames.map((frame) => frame.capturedAt)).toEqual([
    10, 20, 100, 100,
  ]);
  expect(
    evidence.frames[scenarioFrameIndex(evidence.frames, ['two'])!].screenshot
      .sourceRef?.id,
  ).toBe('input-final');
});

test('native clicks show the control before dismissal while input and Agent results stay final', () => {
  const { run, reports, executions } = fixture();
  const task = executions[0].tasks[0];
  Object.assign(task, {
    type: 'Action Space',
    subType: 'Tap',
    hitBy: { from: 'Playwright' },
  });
  Object.assign(task.uiContext!.screenshot, { capturedAt: 10 });
  Object.assign(task.recorder![0].screenshot!, { capturedAt: 20 });
  const selected = () => {
    const evidence = scenarioEvidenceFor(
      run,
      0,
      ['one', 'two', 'three'],
      createScenarioEvidenceResolver(reports),
    );
    return {
      evidence,
      frame: evidence.frames[scenarioFrameIndex(evidence.frames, ['one'])!],
    };
  };
  const click = selected();
  expect(click.frame).toMatchObject({ phase: 'before', nativeAction: 'Tap' });
  expect(click.frame.screenshot.sourceRef?.id).toBe('before');
  expect(
    click.evidence.frames.some(
      (frame) =>
        frame.phase === 'after' &&
        frame.screenshot.sourceRef?.id === 'input-final',
    ),
  ).toBe(true);
  expect(
    scenarioGroupFrameIndex(click.evidence.frames, [run.scripts[0].steps![0]]),
  ).toBe(scenarioFrameIndex(click.evidence.frames, ['one']));
  task.subType = 'Input';
  expect(selected().frame.screenshot.sourceRef?.id).toBe('input-final');
  executions[1].tasks[1].type = 'Action Space';
  executions[1].tasks[1].subType = 'Tap';
  const agent = selected().evidence;
  expect(
    agent.frames[scenarioFrameIndex(agent.frames, ['three'])!].screenshot
      .sourceRef?.id,
  ).toBe('agent-final');
});

test('a click failure or subsequent recovery never defaults back to its successful-looking target', () => {
  const { run, reports, executions } = fixture();
  const task = executions[0].tasks[0];
  Object.assign(task, {
    type: 'Action Space',
    subType: 'Tap',
    hitBy: { from: 'Playwright' },
  });
  const failure = {
    taskId: 'failure',
    type: 'Log',
    subType: 'Error',
    recorder: [{ screenshot: { base64: 'failure', capturedAt: 300 } }],
  } as ExecutionTask;
  executions.push({ id: 'failure-exec', tasks: [failure] } as ExecutionDump);
  run.evidenceLinks!.push({
    scriptIndex: 0,
    stepIds: ['one'],
    taskId: 'failure',
    label: 'Failure',
  });
  const evidence = scenarioEvidenceFor(
    run,
    0,
    'one',
    createScenarioEvidenceResolver(reports),
  );
  expect(
    evidence.frames[scenarioFrameIndex(evidence.frames, ['one'])!],
  ).toMatchObject({ phase: 'failure', taskId: 'failure' });
  failure.type = 'Insight';
  failure.subType = 'Assert';
  const recovered = scenarioEvidenceFor(
    run,
    0,
    'one',
    createScenarioEvidenceResolver(reports),
  );
  expect(
    recovered.frames[scenarioFrameIndex(recovered.frames, ['one'])!],
  ).toMatchObject({ phase: 'observed', taskId: 'failure' });
});

test('pending operations can be read as groups without mixing them with completed work', () => {
  const { run } = fixture();
  run.scripts[0].steps = ['passed', 'pending', 'pending'].map(
    (status, index) => ({
      id: String(index),
      type: 'playwright-operation',
      status,
      description: 'Tap target element in 制造任务 - KMMOM CLOUD',
    }),
  ) as ScenarioRunState['scripts'][number]['steps'];
  run.evidenceLinks = [];
  expect(
    scenarioDisplayStepGroups(run, 0).map((group) => group.indices),
  ).toEqual([[0], [1, 2]]);
});

function inputDetailFixture() {
  const data = fixture();
  for (const step of data.run.scripts[0].steps!) {
    step.description =
      'Input into unresolved input field in the current visible UI';
    step.presentation = {
      action: 'input',
      editable: true,
      page: '登录',
      url: 'https://test/login',
      target: step.id === 'three' ? '密码' : '用户名',
    };
  }
  const user = data.executions[0].tasks[0];
  Object.assign(user, {
    subType: 'Input',
    status: 'finished',
    hitBy: { from: 'Playwright', context: {} },
    param: { value: 'Super' },
  });
  const password = data.executions[1].tasks[0];
  Object.assign(password, {
    subType: 'Input',
    status: 'finished',
    hitBy: { from: 'Playwright', context: {} },
    param: { value: '88888888' },
  });
  return {
    ...data,
    user,
    password,
    resolve: createScenarioEvidenceResolver(data.reports),
  };
}

test('operation details show one actual final input per explicit field outcome, including mode changes', () => {
  const { run, resolve } = inputDetailFixture();
  const first = run.scripts[0].steps![0];
  first.description = 'Press CapsLock on target element in 登录';
  first.presentation!.action = 'keydown';
  const before = JSON.stringify(run);
  const groups = scenarioDisplayStepGroups(run, 0);
  expect(groups).toHaveLength(1);
  const rows = scenarioOperationDetails(run, 0, groups[0], resolve);
  expect(rows).toHaveLength(2);
  expect(rows).toMatchObject([
    {
      action: '填写',
      target: '用户名',
      value: 'Super',
      valueKind: 'final',
      stepIds: ['one', 'two'],
    },
    {
      action: '填写',
      target: '密码',
      value: '88888888',
      valueKind: 'final',
      stepIds: ['three'],
    },
  ]);
  expect(JSON.stringify(run)).toBe(before);
});

test('input outcomes preserve empty values, zero and false rather than treating them as missing', () => {
  const { run, user, resolve } = inputDetailFixture();
  const group = scenarioDisplayStepGroups(run, 0)[0];
  for (const value of ['', 0, false]) {
    user.param.value = value;
    expect(scenarioOperationDetails(run, 0, group, resolve)[0]).toMatchObject({
      action: value === '' ? '清空' : '填写',
      value: String(value),
      valueKind: 'final',
    });
  }
});

test('pending or partial edit blocks cannot borrow their shared final value from a later step', () => {
  const { run, resolve } = inputDetailFixture();
  run.scripts[0].steps![1].status = 'pending';
  const groups = scenarioDisplayStepGroups(run, 0);
  for (const group of groups.slice(0, 2)) {
    expect(scenarioOperationDetails(run, 0, group, resolve)[0]).toMatchObject({
      value: undefined,
      valueKind: 'missing',
    });
  }
});

test('failed native input can report an observed value without presenting a successful fill', () => {
  const { run, resolve } = inputDetailFixture();
  run.scripts[0].steps![2].status = 'failed';
  const group = scenarioDisplayStepGroups(run, 0).at(-1)!;
  expect(scenarioOperationDetails(run, 0, group, resolve)).toMatchObject([
    { value: '88888888', valueKind: 'observed', status: 'failed' },
  ]);
});

test('only exact native task outcomes supply values, never another task, script or Agent request', () => {
  const { run, user, resolve } = inputDetailFixture();
  const group = scenarioDisplayStepGroups(run, 0)[0];
  const firstRow = () => scenarioOperationDetails(run, 0, group, resolve)[0];
  user.param.value = undefined;
  expect(firstRow().valueKind).toBe('missing');
  user.param.value = 'requested-only';
  user.hitBy!.from = 'AI';
  expect(firstRow().valueKind).toBe('missing');
  user.hitBy!.from = 'Playwright';
  run.evidenceLinks![0].scriptIndex = 1;
  expect(firstRow().valueKind).toBe('missing');
  expect(firstRow().value).toBeUndefined();
});

test('named clicks and clears are concrete, passive routes stay hidden, and old missing names are grouped honestly', () => {
  const { run, resolve } = inputDetailFixture();
  run.scripts[0].steps = [
    {
      id: 'query',
      type: 'playwright-operation',
      description: 'Tap 查询按钮',
      status: 'passed',
    },
    {
      id: 'clear',
      type: 'playwright-operation',
      description: 'Clear',
      presentation: { action: 'clear', target: '所属工厂' },
      status: 'passed',
    },
    {
      id: 'unknown-a',
      type: 'playwright-operation',
      description: 'Tap target element in 生产订单',
      status: 'passed',
    },
    {
      id: 'unknown-b',
      type: 'playwright-operation',
      description: 'Tap target element in 生产订单',
      status: 'passed',
    },
    {
      id: 'route',
      type: 'playwright-operation',
      description: 'Navigate to https://test/orders',
      presentation: { action: 'navigation', contextOnly: true },
      status: 'passed',
    },
  ];
  const rows = scenarioOperationDetails(
    run,
    0,
    {
      kind: 'action',
      title: '',
      targets: [],
      indices: [0, 1, 2, 3, 4],
    },
    resolve,
  );
  expect(rows).toHaveLength(3);
  expect(rows).toMatchObject([
    { action: '点击', target: '查询按钮', count: 1 },
    { action: '清空', target: '所属工厂', count: 1 },
    { action: '点击', target: '控件名称未记录', count: 2, missingTarget: true },
  ]);
});
