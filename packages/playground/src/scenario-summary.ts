import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ModelRuntime,
  callAIWithStringResponse,
} from '@midscene/core/ai-model';
import Ajv from 'ajv';
import { scenarioAssertionResults } from './scenario-agent-plan';
import type {
  ScenarioReportPhase,
  ScenarioRunState,
} from './scenario-contract';
import {
  type ScenarioReportAnalysis,
  reportStepIsAbnormal,
} from './scenario-report';
import { renderScenarioHtmlConclusion } from './scenario-report-html';

const prose = {
  type: 'string',
  minLength: 1,
  maxLength: 400,
  pattern: '\\S',
} as const;
export const scenarioReportSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'findings', 'limitations'],
  properties: {
    overview: { ...prose, maxLength: 180 },
    findings: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'scriptIndex',
          'stepIndex',
          'category',
          'certainty',
          'evidence',
          'impact',
          'recommendation',
        ],
        properties: {
          scriptIndex: { type: 'integer', minimum: 0 },
          stepIndex: { type: ['integer', 'null'], minimum: 0 },
          category: {
            type: 'string',
            enum: [
              'assertion',
              'automation',
              'environment',
              'prerequisite',
              'uncertain',
            ],
          },
          certainty: { type: 'string', enum: ['confirmed', 'needs-review'] },
          evidence: { ...prose, maxLength: 240 },
          impact: { type: 'string', maxLength: 160 },
          recommendation: { type: 'string', maxLength: 160 },
        },
      },
    },
    limitations: {
      type: 'array',
      maxItems: 4,
      uniqueItems: true,
      items: { ...prose, maxLength: 160 },
    },
  },
};
const validate = new Ajv({ allErrors: true }).compile<ScenarioReportAnalysis>(
  scenarioReportSchema,
);

/** Read the shipped skill at runtime, in both source and installed dist layouts. */
export function loadScenarioReportSkill() {
  const directory = dirname(fileURLToPath(import.meta.url));
  for (const base of ['..', '../..']) {
    try {
      return readFileSync(
        resolve(directory, base, 'runtime-skills/test-report/SKILL.md'),
        'utf8',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Runtime test-report skill is missing.');
}

export function scenarioSummaryEvidence(run: ScenarioRunState) {
  const steps = run.scripts.flatMap((script) => script.steps || []);
  const checkpoints = steps.flatMap(scenarioAssertionResults);
  let remaining = 24000;
  let omittedSteps = 0;
  const scripts = run.scripts.map((script, scriptIndex) => ({
    scriptIndex,
    name: script.name.slice(0, 200),
    status: script.status,
    error: script.error?.slice(0, 1000),
    continuation: script.continuation
      ? {
          status: script.continuation.status,
          reason: script.continuation.reason?.slice(0, 1500),
        }
      : undefined,
    completedSteps: script.completedSteps,
    totalSteps: script.totalSteps,
    steps: [] as Array<ReturnType<typeof evidenceStep>>,
  }));
  function evidenceStep(step: (typeof steps)[number], stepIndex: number) {
    return {
      stepIndex,
      type: step.type,
      description: step.description.slice(0, 500),
      instruction: step.instruction?.slice(0, 1000),
      operation: step.presentation
        ? {
            action: step.presentation.action,
            target: step.presentation.target,
            page: step.presentation.page,
            contextOnly: step.presentation.contextOnly,
          }
        : undefined,
      status: step.status,
      detail: step.detail?.slice(0, 1500),
      error: step.error?.slice(0, 1500),
      continuedAfterFailure: step.continuedAfterFailure,
      checks: scenarioAssertionResults(step).map((check) => ({
        ...check,
        instruction: check.instruction.slice(0, 1000),
        detail: check.detail?.slice(0, 1000),
      })),
      actions: step.agentTask?.actions.slice(0, 24).map((result) => ({
        type: result.action.type,
        instruction:
          result.action.type === 'wait'
            ? undefined
            : result.action.instruction.slice(0, 1000),
        milliseconds:
          result.action.type === 'wait'
            ? result.action.milliseconds
            : undefined,
        status: result.status,
        detail: result.detail?.slice(0, 1000),
      })),
      recovery: step.recovery
        ? {
            status: step.recovery.status,
            originalError: step.recovery.originalError.slice(0, 1000),
            observation: step.recovery.observation?.slice(0, 1500),
            instruction: step.recovery.instruction?.slice(0, 1000),
            reason: step.recovery.reason?.slice(0, 1500),
            attempts: step.recovery.attempts?.slice(0, 3).map((attempt) => ({
              ...attempt,
              reason: attempt.reason.slice(0, 600),
              instruction: attempt.instruction?.slice(0, 600),
              error: attempt.error?.slice(0, 600),
              verification: attempt.verification?.slice(0, 600),
            })),
          }
        : undefined,
    };
  }
  const priority = (step: (typeof steps)[number]) =>
    reportStepIsAbnormal(step)
      ? 0
      : scenarioAssertionResults(step).length
        ? 1
        : 2;
  // Prioritize across the whole run, so early successful scripts cannot crowd out later failures.
  run.scripts
    .flatMap((script, scriptIndex) =>
      (script.steps || []).map((step, stepIndex) => ({
        scriptIndex,
        stepIndex,
        step,
      })),
    )
    .sort((a, b) => priority(a.step) - priority(b.step))
    .forEach(({ scriptIndex, stepIndex, step }) => {
      const item = evidenceStep(step, stepIndex);
      const size = JSON.stringify(item).length;
      if (size > remaining) {
        omittedSteps++;
        return;
      }
      remaining -= size;
      scripts[scriptIndex].steps.push(item);
    });
  scripts.forEach((script) =>
    script.steps.sort((a, b) => a.stepIndex - b.stepIndex),
  );
  return {
    scenario: run.scenarioName,
    platform: run.platformId || 'web',
    intent: run.scenarioDescription?.slice(0, 4000),
    scope: run.scope,
    status: run.status,
    error: run.error?.slice(0, 2000),
    totalSteps: steps.length,
    passedSteps: steps.filter((s) => s.status === 'passed').length,
    skippedSteps: steps.filter((s) => s.status === 'skipped').length,
    unexecutedSteps: steps.filter((s) => s.status === 'pending').length,
    blockedSteps: steps.filter((s) => s.status === 'blocked').length,
    checkpoints: {
      total: checkpoints.length,
      passed: checkpoints.filter((s) => s.status === 'passed').length,
      failed: checkpoints.filter((s) => s.status === 'failed').length,
      blocked: checkpoints.filter((s) => s.status === 'blocked').length,
      skipped: checkpoints.filter((s) => s.status === 'skipped').length,
      unexecuted: checkpoints.filter((s) => s.status === 'pending').length,
    },
    omittedSteps,
    scripts,
  };
}

export function parseScenarioReportAnalysis(
  text: string,
  evidence: ReturnType<typeof scenarioSummaryEvidence>,
): ScenarioReportAnalysis {
  if (text.length > 200000) throw new Error('Analysis exceeds the size limit.');
  const data: unknown = JSON.parse(text);
  if (!validate(data))
    throw new Error(
      `Invalid report structure: ${JSON.stringify(validate.errors).slice(0, 2000)}`,
    );
  const refs = new Set<string>();
  for (const finding of data.findings) {
    const script = evidence.scripts[finding.scriptIndex];
    const step = script?.steps.find(
      (step) => step.stepIndex === finding.stepIndex,
    );
    if (!script || (finding.stepIndex !== null && !step))
      throw new Error('Finding references evidence that was not provided.');
    if (
      finding.stepIndex === null &&
      !script.error &&
      !script.continuation?.reason
    )
      throw new Error(
        'Script finding has no supporting error or continuation record.',
      );
    if (step && !['failed', 'blocked'].includes(step.status) && !step.recovery)
      throw new Error('Finding references a normal step.');
    if (
      finding.category === 'assertion' &&
      (!step || !step.checks.some((check) => check.status === 'failed'))
    )
      throw new Error('Assertion mismatch must reference a failed checkpoint.');
    const key = `${finding.scriptIndex}/${finding.stepIndex}`;
    if (refs.has(key))
      throw new Error('Duplicate finding for the same evidence.');
    refs.add(key);
  }
  for (const script of evidence.scripts) {
    for (const step of script.steps) {
      if (
        (['failed', 'blocked'].includes(step.status) || step.recovery) &&
        !refs.has(`${script.scriptIndex}/${step.stepIndex}`)
      )
        throw new Error(
          'A supplied failure, blocker or recovery record is missing from the findings.',
        );
    }
    if (
      (script.continuation?.status === 'blocked' ||
        (script.error &&
          !script.steps.some((step) =>
            ['failed', 'blocked'].includes(step.status),
          ))) &&
      !refs.has(`${script.scriptIndex}/null`)
    )
      throw new Error(
        'A script-level error or blocker is missing from the findings.',
      );
  }
  return data;
}

function validateReportLanguage(
  analysis: ScenarioReportAnalysis,
  language: ScenarioRunState['language'],
) {
  if (language === 'en') return;
  const fields: Array<[string, string]> = [
    ['overview', analysis.overview],
    ...analysis.findings.flatMap(
      (finding, index): Array<[string, string]> => [
        [`findings[${index}].evidence`, finding.evidence],
        [`findings[${index}].impact`, finding.impact],
        [`findings[${index}].recommendation`, finding.recommendation],
      ],
    ),
    ...analysis.limitations.map((value, index): [string, string] => [
      `limitations[${index}]`,
      value,
    ]),
  ];
  for (const [field, value] of fields) {
    // Quoted UI labels, code and URLs are evidence literals, not prose.
    // In particular, an English sentence quoting “总2268条” is still English.
    const narrative = value.replace(
      /https?:\/\/\S+|\x60[^\x60]*\x60|"[^"\r\n]*"|'[^'\r\n]*'|“[^”\r\n]*”|‘[^’\r\n]*’/g,
      '',
    );
    const words = narrative.match(/\b[A-Za-z][A-Za-z'-]*\b/g) || [];
    if (
      (!/[\u3400-\u9fff]/.test(narrative) && words.length >= 2) ||
      /(?:\b[A-Za-z][A-Za-z'-]*[ \t]+){3,}[A-Za-z][A-Za-z'-]*/.test(narrative)
    )
      throw new Error(
        `${field} contains English prose. Write all report explanations in Simplified Chinese; preserve quoted evidence, values and verdicts.`,
      );
  }
}

export function basicScenarioSummary(
  run: ScenarioRunState,
): NonNullable<ScenarioRunState['summary']> {
  return {
    status: 'failed',
    format: 'html',
    skillVersion: '3',
    text: renderScenarioHtmlConclusion(run),
  };
}

export async function generateScenarioSummary(
  run: ScenarioRunState,
  runtime: ModelRuntime,
  signal: AbortSignal,
  call: typeof callAIWithStringResponse = callAIWithStringResponse,
  onProgress?: (phase: ScenarioReportPhase) => void,
): Promise<NonNullable<ScenarioRunState['summary']>> {
  signal.throwIfAborted();
  onProgress?.('preparing');
  const evidence = scenarioSummaryEvidence(run);
  const system = `${loadScenarioReportSkill()}\nOutput language: ${run.language === 'en' ? 'English' : 'Simplified Chinese'}.\nJSON Schema:\n${JSON.stringify(scenarioReportSchema)}`;
  let correction = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    onProgress?.(attempt === 0 ? 'analyzing' : 'repairing');
    const result = await call(
      [
        { role: 'system', content: system + correction },
        { role: 'user', content: JSON.stringify(evidence) },
      ],
      runtime,
      { abortSignal: signal },
    );
    signal.throwIfAborted();
    onProgress?.('validating');
    try {
      const analysis = parseScenarioReportAnalysis(
        result.content || '',
        evidence,
      );
      validateReportLanguage(analysis, run.language);
      return {
        status: 'completed',
        format: 'html',
        skillVersion: '3',
        analysis,
        omittedSteps: evidence.omittedSteps,
        text: renderScenarioHtmlConclusion(
          run,
          analysis,
          evidence.omittedSteps,
        ),
      };
    } catch (error) {
      correction = `\nYour previous response was rejected: ${error instanceof Error ? error.message : 'Invalid JSON'}. Regenerate a complete conforming JSON object. This is the final attempt.`;
    }
  }
  return basicScenarioSummary(run);
}
