import JSZip from 'jszip';
import { saveStudioPreference } from '../../studio-preferences-backup';
import { type ScenarioScript, validateScenarioScript } from './script-model';
import {
  getScenarioScriptAsset,
  insertScenarioScriptCopies,
  listScenarioScripts,
  removeScenarioScriptCopies,
} from './script-storage';
import { type SequenceEntry, loadSequence } from './sequence';
import { type SessionMode, loadSessionMode } from './session-mode';
import {
  SCENARIOS_STORAGE_KEY,
  type StudioScenario,
  loadStudioScenarios,
} from './storage';

export type PackageKind = 'script' | 'scenario';
interface Manifest {
  platformId?: 'web' | 'android';
  format: 'midscene-studio-bundle';
  version: 1;
  kind: PackageKind;
  name: string;
  description: string;
  scripts: ScenarioScript[];
  sequence: SequenceEntry[];
  sessionMode: SessionMode;
}
export interface PreparedPackage {
  manifest: Manifest;
  assets: Map<string, Blob>;
  fingerprint: string;
}
const LIMIT = 100 * 1024 * 1024;
const ENTRY_LIMIT = 20 * 1024 * 1024;
const RECEIPTS = 'studio.import-receipts.v1';
const fields = [
  'screenshotAsset',
  'screenshotBefore',
  'screenshotAfter',
  'screenshotWithBox',
] as const;
function fail(): never {
  throw new Error('Invalid or incomplete Studio package.');
}

function validateManifest(value: unknown): Manifest {
  const m = value as Manifest;
  if (!m || m.format !== 'midscene-studio-bundle' || m.version !== 1)
    throw new Error('Unsupported Studio package version.');
  if (
    !['script', 'scenario'].includes(m.kind) ||
    typeof m.name !== 'string' ||
    !m.name.trim() ||
    m.name.length > 80 ||
    typeof m.description !== 'string' ||
    m.description.length > 500 ||
    !Array.isArray(m.scripts) ||
    m.scripts.length > 200 ||
    !Array.isArray(m.sequence) ||
    !['current', 'fresh'].includes(m.sessionMode)
  )
    fail();
  if (m.kind === 'script' && m.scripts.length !== 1) fail();
  const scripts = m.scripts.map(validateScenarioScript);
  const platformId =
    m.platformId || scripts[0]?.sourceSession.target.platformId || 'web';
  if (
    !['web', 'android'].includes(platformId) ||
    scripts.some((s) => s.sourceSession.target.platformId !== platformId)
  )
    fail();
  const ids = new Set(scripts.map((s) => s.id));
  if (ids.size !== scripts.length || m.sequence.length !== scripts.length)
    fail();
  for (const item of m.sequence) {
    if (
      !item ||
      !ids.delete(item.id) ||
      !['automatic', 'manual'].includes(item.startMode)
    )
      fail();
  }
  const assetIds = new Set<string>();
  for (const script of scripts) {
    for (const ref of script.assets) {
      if (assetIds.has(ref.id)) fail();
      assetIds.add(ref.id);
    }
    for (const event of script.sourceSession.events) {
      for (const field of fields) {
        if (
          event[field] &&
          !script.assets.some(
            (a) => a.eventHashId === event.hashId && a.field === field,
          )
        )
          fail();
      }
    }
  }
  return {
    platformId: platformId as 'web' | 'android',
    format: m.format,
    version: 1,
    kind: m.kind,
    name: m.name.trim(),
    description: m.description,
    scripts,
    sequence: m.sequence.map(({ id, startMode }) => ({ id, startMode })),
    sessionMode: m.sessionMode,
  };
}

// Filenames never contain user-provided names or IDs.
const assetPath = (script: number, asset: number, mime: string) => {
  const extension = (
    {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    } as Record<string, string>
  )[mime];
  if (!extension) fail();
  return `assets/${script}-${asset}.${extension}`;
};
function markdown(manifest: Manifest): string {
  const android = manifest.platformId === 'android';
  const lines = [
    '# Midscene Studio 测试包 / Test package',
    '',
    manifest.name,
    '',
    manifest.description,
    '',
    '## 执行说明 / Execution contract',
    ...(android
      ? [
          '- 安卓测试：连接可用安卓设备，按步骤顺序使用实时截图和设备操作工具执行 Agent 操作与断言；设备序列号可映射到当前手机，不需要 Playwright。fresh 表示重启目标应用，保留应用数据，不是清空登录状态。 / Android: connect an available device and execute Agent operations and assertions in order using live screenshots and device tools. Map the recorded serial to the current phone; Playwright is not required. fresh restarts the target app without clearing its data.',
        ]
      : []),
    '- 按 manifest.json 的 sequence 和各脚本 steps 顺序，在同一测试对象中执行，保留会话上下文；manual 表示等待用户继续。README 仅作说明。 / Follow manifest.json sequence and script steps on the same target, preserving session context; manual means wait for user continuation. README is explanatory only.',
    '- playwright-operation：执行保存的 code，可补齐运行依赖和必要等待，不得擅改操作目标或断言条件。 / Execute saved code; supply runtime dependencies and necessary waits without changing operation targets or assertion conditions.',
    '- agent-operation：执行助手充当 Agent，主动截图观察当前页面，按 instruction 使用浏览器或 Computer Use 工具实际操作，检查操作结果后继续。无需强制调用 Midscene aiAct。 / Act as the Agent: take a live screenshot, use browser or Computer Use tools to carry out instruction, then check the outcome. Midscene aiAct is optional.',
    '- agent-assertion：执行助手等待页面加载完成后，主动截取当前页面并视觉识别，按 instruction 判断通过或失败；可用 DOM 辅助核验，不得用录制截图代替实时证据。无需强制调用 Midscene aiAssert。 / Wait for the page to finish loading, take a fresh screenshot and visually evaluate instruction; DOM may corroborate it. Recording screenshots are not live evidence. Midscene aiAssert is optional.',
    '- agent-task：按已保存的 agentPlan.actions 依次执行操作、等待和断言，不重新解释或重排原始需求。operation 由执行助手根据实时页面亲自操作；assertion 使用实时截图判断；wait 由程序按 milliseconds 计时。code 中 executeScenarioAgentTask 的 tools 对应上述操作和断言方式，外部助手可自行实现同等执行器。 / Follow the saved agentPlan.actions in order without replanning: operation uses live Agent interaction, assertion uses fresh visual evidence, and wait is a programmatic delay in milliseconds. Implement the code helper executeScenarioAgentTask with equivalent tools if running outside Studio.',
    '- 断言 onFailure 为 continue 时，确认不符合仍记录失败，继续后续步骤；stop 则结束本脚本。无法判断或操作未完成必须记录阻塞，不能套用“失败继续”；下一脚本仍须满足业务前提，manual 仍需用户继续。 / Assertion onFailure=continue records a confirmed mismatch as failed and continues; stop ends this script. An inconclusive check or incomplete operation is blocked, never overridden by continue. Later scripts still require their business prerequisites; manual boundaries still require user continuation.',
    '- Agent 步骤中的代码是 Studio 调用形式，外部助手可按上述方式接替，但必须实际执行和验证。找不到目标或证据不足时记录失败或阻塞，不得跳过后记为通过；结果附关键截图和执行适配说明。 / Agent code shows the Studio invocation; external assistants may substitute the actions above but must perform and verify them. Report missing targets or insufficient evidence as failed or blocked, never skipped-as-passed; include key screenshots and execution adaptations.',
    '',
    '包内保留录制输入和网址，不含登录会话、模型配置或执行报告；录制截图仅作参考。 / Recorded inputs and URLs are included; login sessions, model configuration and run reports are excluded. Packaged screenshots are reference only.',
    `- 会话 / Session: ${manifest.sessionMode}`,
    '',
    '## 脚本顺序 / Script order',
    '',
  ];
  for (const [index, entry] of manifest.sequence.entries()) {
    const s = manifest.scripts.find((s) => s.id === entry.id)!;
    const si = manifest.scripts.indexOf(s);
    lines.push(
      `### ${index + 1}. ${s.name}`,
      '',
      `开始方式 / Start: ${index === 0 ? 'first' : entry.startMode}`,
      `起始网址 / URL: ${s.sourceSession.url || s.sourceSession.target.values.url || ''}`,
      '',
    );
    s.steps.forEach((step, i) => {
      lines.push(`#### ${i + 1}. ${step.type}`, '', step.description, '');
      const fence = '`'.repeat(
        Math.max(
          3,
          ...Array.from(step.code.matchAll(/`+/g), (m) => m[0].length + 1),
        ),
      );
      lines.push(`${fence}typescript`, step.code, fence, '');
      if ('sourceEvent' in step && step.sourceEvent) {
        s.assets.forEach((a, ai) => {
          if (a.eventHashId === step.sourceEvent?.hashId)
            lines.push(
              `![录制参考 / Recording reference](${assetPath(si, ai, a.mimeType)})`,
              '',
            );
        });
      }
    });
  }
  return lines.join('\n');
}

export async function createStudioPackage(
  scenario: StudioScenario,
  script?: ScenarioScript,
): Promise<Uint8Array> {
  const source = script
    ? [validateScenarioScript(script)]
    : await listScenarioScripts(scenario.id);
  // Debug annotation paths and transient browser IDs have no meaning on another computer.
  const scripts = source.map((s) =>
    validateScenarioScript(
      JSON.parse(
        JSON.stringify(s, (key, value) =>
          key === 'annotatedScreenshotPath' || key === 'sessionId'
            ? undefined
            : value,
        ),
      ),
    ),
  );
  if (scripts.reduce((n, s) => n + s.assets.length, 3) > 5000)
    throw new Error('Studio package is too large.');
  const manifest = validateManifest({
    platformId: scenario.platformId || 'web',
    format: 'midscene-studio-bundle',
    version: 1,
    kind: script ? 'script' : 'scenario',
    name: script?.name ?? scenario.name,
    description: script ? '' : scenario.description,
    scripts,
    sequence: script
      ? [{ id: script.id, startMode: 'manual' }]
      : loadSequence(scenario.id, scripts),
    sessionMode: loadSessionMode(scenario.id),
  });
  const zip = new JSZip();
  const json = JSON.stringify(manifest, null, 2);
  const readme = markdown(manifest);
  let total = new TextEncoder().encode(json + readme).byteLength;
  if (
    new TextEncoder().encode(json).byteLength > ENTRY_LIMIT ||
    new TextEncoder().encode(readme).byteLength > ENTRY_LIMIT
  )
    throw new Error('Studio package is too large.');
  for (const [si, s] of scripts.entries()) {
    for (const [ai, ref] of s.assets.entries()) {
      const blob = await getScenarioScriptAsset(ref.id);
      if (!blob || blob.size !== ref.bytes || blob.type !== ref.mimeType)
        fail();
      total += blob.size;
      if (total > LIMIT || blob.size > ENTRY_LIMIT)
        throw new Error('Studio package is too large.');
      zip.file(assetPath(si, ai, ref.mimeType), await blob.arrayBuffer());
    }
  }
  zip.file('manifest.json', json);
  zip.file('README.md', readme);
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
  });
  if (bytes.byteLength > LIMIT) throw new Error('Studio package is too large.');
  return bytes;
}

/** Bound actual output as well as advertised sizes to reject compressed bombs. */
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let c = value;
  for (let bit = 0; bit < 8; bit++)
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function readEntry(entry: JSZip.JSZipObject): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let crc = -1;
    const stream = (
      entry as JSZip.JSZipObject & {
        internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream('uint8array');
    stream.on('data', (chunk) => {
      size += chunk.byteLength;
      if (size > ENTRY_LIMIT) {
        stream.pause();
        reject(new Error('Studio package is too large.'));
        return;
      }
      chunks.push(chunk);
      for (const byte of chunk)
        crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    });
    stream.on('error', reject);
    stream.on('end', () => {
      const expected = (entry as unknown as { _data?: { crc32?: number } })
        ._data?.crc32;
      if (expected !== undefined && (crc ^ -1) !== (expected | 0)) {
        reject(new Error('Invalid or incomplete Studio package.'));
        return;
      }
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(result);
    });
    stream.resume();
  });
}

export async function readStudioPackage(
  bytes: Uint8Array,
  kind: PackageKind,
): Promise<PreparedPackage> {
  if (bytes.byteLength > LIMIT) throw new Error('Studio package is too large.');
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files);
  if (files.length > 5000) throw new Error('Studio package is too large.');
  let advertised = 0;
  for (const file of files) {
    const original = file.unsafeOriginalName ?? file.name;
    if (
      original !== file.name ||
      original.includes('\\') ||
      original.startsWith('/') ||
      original.includes(':') ||
      original.split('/').includes('..')
    )
      fail();
    const size =
      (file as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0;
    advertised += size;
    if (size > ENTRY_LIMIT || advertised > LIMIT)
      throw new Error('Studio package is too large.');
  }
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) fail();
  const data = await readEntry(manifestFile);
  const manifest = validateManifest(JSON.parse(new TextDecoder().decode(data)));
  if (manifest.kind !== kind)
    throw new Error('Choose a package of the correct type.');
  const expected = new Set(['manifest.json', 'README.md']);
  const assets = new Map<string, Blob>();
  let total = data.length;
  for (const [si, script] of manifest.scripts.entries()) {
    for (const [ai, ref] of script.assets.entries()) {
      const path = assetPath(si, ai, ref.mimeType);
      expected.add(path);
      const file = zip.file(path);
      if (!file) fail();
      const content = await readEntry(file);
      total += content.length;
      if (total > LIMIT) throw new Error('Studio package is too large.');
      if (content.length !== ref.bytes) fail();
      assets.set(ref.id, new Blob([content], { type: ref.mimeType }));
    }
  }
  if (files.some((f) => !f.dir && !expected.has(f.name))) fail();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(manifest)),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
  return { manifest, assets, fingerprint };
}

export function importedBefore(fingerprint: string): boolean {
  return receipts().includes(fingerprint);
}
function receipts(): string[] {
  const data = JSON.parse(localStorage.getItem(RECEIPTS) || '[]');
  return Array.isArray(data) ? data.filter((x) => typeof x === 'string') : [];
}
export function importName(name: string, used: string[]): string {
  if (!used.includes(name)) return name;
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? '（导入）' : `（导入 ${i}）`;
    const candidate = name.slice(0, 80 - suffix.length) + suffix;
    if (!used.includes(candidate)) return candidate;
  }
}

function cloneScript(
  input: ScenarioScript,
  scenarioId: string,
  name: string,
  blobs: Map<string, Blob>,
  copiedBlobs: Map<string, Blob>,
): ScenarioScript {
  const s = validateScenarioScript(input);
  s.id = crypto.randomUUID();
  s.scenarioId = scenarioId;
  s.name = name;
  s.createdAt = s.updatedAt = Date.now();
  s.sourceSession.id = crypto.randomUUID();
  s.sourceSession.scenarioId = scenarioId;
  const events = new Map(
    s.sourceSession.events.map((e) => [e.hashId, crypto.randomUUID()]),
  );
  const checkpoints = new Map(
    (s.sourceSession.checkpoints || []).map((c) => [c.id, crypto.randomUUID()]),
  );
  const stepIds = new Map<string, string>();
  for (const [old, id] of events)
    stepIds.set(`operation:${old}`, `operation:${id}`);
  for (const [old, id] of checkpoints)
    stepIds.set(`assertion:${old}`, `assertion:${id}`);
  for (const step of s.steps)
    if (step.manual) stepIds.set(step.id, `manual:${crypto.randomUUID()}`);
  for (const ref of s.assets) {
    const old = ref.id;
    ref.id = crypto.randomUUID();
    copiedBlobs.set(ref.id, blobs.get(old)!);
    const event = s.sourceSession.events.find(
      (e) => e.hashId === ref.eventHashId,
    )!;
    if (ref.field === 'screenshotAsset')
      event.screenshotAsset = {
        id: ref.id,
        mimeType: ref.mimeType,
        bytes: ref.bytes,
      };
    else event[ref.field] = `scenario-asset:${ref.id}`;
    ref.eventHashId = events.get(ref.eventHashId)!;
  }
  for (const e of s.sourceSession.events) e.hashId = events.get(e.hashId)!;
  for (const c of s.sourceSession.checkpoints || []) {
    c.id = checkpoints.get(c.id)!;
    c.afterEventHashIds = c.afterEventHashIds.map((id) => events.get(id)!);
  }
  for (const step of new Set([...s.steps, ...(s.recordedSteps || [])])) {
    step.id = stepIds.get(step.id)!;
    if ('sourceEvent' in step && step.sourceEvent)
      step.sourceEvent =
        s.sourceSession.events.find(
          (e) => e.hashId === events.get(step.sourceEvent!.hashId),
        ) ??
        s.sourceSession.events.find(
          (e) => e.hashId === step.sourceEvent!.hashId,
        )!;
    if ('sourceCheckpoint' in step && step.sourceCheckpoint)
      step.sourceCheckpoint =
        s.sourceSession.checkpoints?.find(
          (c) => c.id === checkpoints.get(step.sourceCheckpoint!.id),
        ) ??
        s.sourceSession.checkpoints?.find(
          (c) => c.id === step.sourceCheckpoint!.id,
        );
  }
  return validateScenarioScript(s);
}

let importing = false;
export async function importStudioPackage(
  bundle: PreparedPackage,
  target?: StudioScenario,
): Promise<StudioScenario> {
  if (importing) throw new Error('An import is already in progress.');
  importing = true;
  try {
    const m = validateManifest(bundle.manifest);
    if ((m.kind === 'script') !== Boolean(target)) fail();
    if (target && (target.platformId || 'web') !== (m.platformId || 'web'))
      throw new Error('A scenario must use one platform.');
    const scenarios = loadStudioScenarios();
    if (target && !scenarios.some((s) => s.id === target.id))
      throw new Error('The destination scenario no longer exists.');
    const now = Date.now();
    const scenario = target ?? {
      platformId: m.platformId || 'web',
      id: crypto.randomUUID(),
      name: importName(
        m.name,
        scenarios.map((s) => s.name),
      ),
      description: m.description,
      createdAt: now,
      updatedAt: now,
    };
    const existing = target ? await listScenarioScripts(target.id) : [];
    const used = existing.map((s) => s.name);
    const assets = new Map<string, Blob>();
    const copies = m.scripts.map((s) => {
      const name = importName(s.name, used);
      used.push(name);
      return cloneScript(s, scenario.id, name, bundle.assets, assets);
    });
    const ids = new Map(m.scripts.map((s, i) => [s.id, copies[i].id]));
    const sequence = target
      ? [
          ...loadSequence(target.id, existing),
          ...copies.map((s) => ({ id: s.id, startMode: 'manual' as const })),
        ]
      : m.sequence.map((e) => ({ ...e, id: ids.get(e.id)! }));
    const changes: Array<[string, string]> = [
      [`studio.scenario-sequence.v1.${scenario.id}`, JSON.stringify(sequence)],
      [
        RECEIPTS,
        JSON.stringify(
          [...new Set([...receipts(), bundle.fingerprint])].slice(-500),
        ),
      ],
    ];
    if (!target)
      changes.push(
        [`studio.scenario-session.v1.${scenario.id}`, m.sessionMode],
        [SCENARIOS_STORAGE_KEY, JSON.stringify([...scenarios, scenario])],
      );
    const previous = changes.map(
      ([key]) => [key, localStorage.getItem(key)] as const,
    );
    await insertScenarioScriptCopies(copies, assets);
    try {
      // Probe all writes before scheduling backups. Roll back both stores on failure.
      for (const [key, value] of changes) localStorage.setItem(key, value);
    } catch (cause) {
      try {
        for (const [key, value] of previous) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      } finally {
        await removeScenarioScriptCopies(copies);
      }
      throw cause;
    }
    for (const [key, value] of changes) saveStudioPreference(key, value);
    return scenario;
  } finally {
    importing = false;
  }
}
