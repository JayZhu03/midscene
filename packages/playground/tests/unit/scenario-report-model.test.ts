import { expect, test } from '@rstest/core';
import type { ScenarioRunState } from '../../src/scenario-contract';
import {
  scenarioReportIssues,
  scenarioReportOverview,
} from '../../src/scenario-report-model';

function run(): ScenarioRunState {
  return {
    id: 'run',
    scenarioId: 's',
    status: 'completed',
    scriptIndex: 0,
    stepIndex: 0,
    scripts: [
      {
        id: 'a',
        name: 'Orders',
        status: 'failed',
        completedSteps: 3,
        totalSteps: 3,
        steps: [
          {
            id: 'nav',
            description: 'Open orders',
            type: 'playwright-operation',
            status: 'passed',
            recovery: {
              status: 'recovered',
              originalError: 'Target missing',
              startedAt: 1,
              reason: 'Recovered and verified',
            },
          },
          {
            id: 'check',
            description: 'Count is 20',
            instruction: 'Count is 20',
            type: 'agent-assertion',
            status: 'failed',
            error: 'Actual count is 10',
            continuedAfterFailure: true,
          },
          {
            id: 'next',
            description: 'Open next page',
            type: 'playwright-operation',
            status: 'passed',
          },
        ],
      },
      {
        id: 'b',
        name: 'Skipped',
        status: 'skipped',
        completedSteps: 0,
        totalSteps: 1,
        steps: [
          {
            id: 'skipped',
            description: 'Check',
            type: 'agent-assertion',
            status: 'skipped',
          },
        ],
      },
    ],
  };
}

test('completed execution, failed check and recovered action retain independent results', () => {
  const state = run();
  expect(scenarioReportOverview(state)).toMatchObject({
    scripts: 2,
    finishedScripts: 1,
    checks: 2,
    passedChecks: 0,
    failedChecks: 1,
    unverifiedChecks: 1,
    recovered: 1,
  });
  expect(scenarioReportIssues(state)).toEqual([
    {
      scriptIndex: 0,
      stepIndex: 0,
      kind: 'recovered',
      evidence: 'Recovered and verified',
    },
    {
      scriptIndex: 0,
      stepIndex: 1,
      kind: 'failed',
      evidence: 'Actual count is 10',
    },
  ]);
});

test('script-level prerequisite blockers and checkpoints without evidence are not passes', () => {
  const state = run();
  state.scripts[1].status = 'blocked';
  state.scripts[1].continuation = {
    status: 'blocked',
    reason: 'Required order was not created',
  };
  state.scripts[1].steps![0].status = 'pending';
  expect(scenarioReportIssues(state).at(-1)).toMatchObject({
    scriptIndex: 1,
    stepIndex: null,
    kind: 'blocked',
    evidence: 'Required order was not created',
  });
  expect(scenarioReportOverview(state).passedChecks).toBe(0);
});

test('Agent recovery of an operation does not create business-check coverage', () => {
  const state = run();
  state.scripts = [state.scripts[0]];
  state.scripts[0].steps = [state.scripts[0].steps![0]];
  expect(scenarioReportOverview(state)).toMatchObject({
    checks: 0,
    recovered: 1,
  });
});

test('AI descriptions cannot change the authoritative failure or step reference', () => {
  const state = run();
  state.summary = {
    status: 'completed',
    analysis: {
      overview: 'All passed',
      limitations: [],
      findings: [
        {
          scriptIndex: 0,
          stepIndex: 1,
          category: 'assertion',
          certainty: 'confirmed',
          evidence: 'Expected 20; actual 10',
          impact: '',
          recommendation: '',
        },
      ],
    },
  };
  expect(scenarioReportIssues(state)[1]).toEqual({
    scriptIndex: 0,
    stepIndex: 1,
    kind: 'failed',
    evidence: 'Expected 20; actual 10',
  });
  expect(scenarioReportOverview(state).failedChecks).toBe(1);
});
