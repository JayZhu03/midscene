import { scenarioAssertionResults } from './scenario-agent-plan';
import type { ScenarioRunState } from './scenario-contract';
import { reportStepIsAbnormal } from './scenario-report';

export interface ScenarioReportIssue {
  scriptIndex: number;
  stepIndex: number | null;
  kind: 'failed' | 'blocked' | 'recovered' | 'recovery-failed';
  evidence: string;
}

/** Counts are derived from execution records, never from model prose. */
export function scenarioReportOverview(run: ScenarioRunState) {
  const steps = run.scripts.flatMap((script) => script.steps || []);
  const checks = steps.flatMap(scenarioAssertionResults);
  const count = (items: Array<{ status: string }>, status: string) =>
    items.filter((item) => item.status === status).length;
  return {
    scripts: run.scripts.length,
    finishedScripts: run.scripts.filter((script) =>
      ['passed', 'failed'].includes(script.status),
    ).length,
    steps: steps.length,
    checks: checks.length,
    passedChecks: count(checks, 'passed'),
    failedChecks: count(checks, 'failed'),
    unverifiedChecks: checks.filter(
      (check) => !['passed', 'failed'].includes(check.status),
    ).length,
    recovered: steps.filter((step) => step.recovery?.status === 'recovered')
      .length,
  };
}

/** Every issue points to an actual script/step. Successful recovery is distinct
 * from an unresolved failure; no product root cause is inferred here. */
export function scenarioReportIssues(
  run: ScenarioRunState,
): ScenarioReportIssue[] {
  return run.scripts.flatMap((script, scriptIndex) => {
    const issues: ScenarioReportIssue[] = [];
    (script.steps || []).forEach((step, stepIndex) => {
      if (!reportStepIsAbnormal(step)) return;
      const finding = run.summary?.analysis?.findings.find(
        (item) =>
          item.scriptIndex === scriptIndex && item.stepIndex === stepIndex,
      );
      issues.push({
        scriptIndex,
        stepIndex,
        kind:
          step.status === 'blocked'
            ? 'blocked'
            : step.recovery?.status === 'recovered' && step.status === 'passed'
              ? 'recovered'
              : step.recovery && step.status !== 'passed'
                ? 'recovery-failed'
                : 'failed',
        evidence:
          finding?.evidence ||
          step.error ||
          step.recovery?.reason ||
          step.recovery?.originalError ||
          step.detail ||
          step.description,
      });
    });
    if (
      script.continuation?.status === 'blocked' ||
      (script.error && !issues.some((issue) => issue.kind !== 'recovered')) ||
      (['failed', 'blocked'].includes(script.status) && !issues.length)
    ) {
      issues.push({
        scriptIndex,
        stepIndex: null,
        kind: script.status === 'blocked' ? 'blocked' : 'failed',
        evidence:
          run.summary?.analysis?.findings.find(
            (item) =>
              item.scriptIndex === scriptIndex && item.stepIndex === null,
          )?.evidence ||
          script.continuation?.reason ||
          script.error ||
          script.name,
      });
    }
    return issues;
  });
}
