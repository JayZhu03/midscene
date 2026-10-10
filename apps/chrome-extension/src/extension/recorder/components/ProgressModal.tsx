import {
  CheckCircleOutlined,
  CheckOutlined,
  CodeOutlined,
  CopyOutlined,
  DownOutlined,
  DownloadOutlined,
  FileTextOutlined,
  LoadingOutlined,
  PushpinFilled,
  PushpinOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { CodeGenerationChunk, StreamingCallback } from '@midscene/core';
import type { ChromeRecordedEvent } from '@midscene/recorder-ui';
import { globalModelConfigManager } from '@midscene/shared/env';
import {
  AutoComplete,
  Button,
  Select,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useRecordingSessionStore } from '../../../store';
import { generateAIDescription } from '../../../utils/eventOptimizer';
import {
  generatePlaywrightTestStream,
  generateYamlTestStream,
} from '../generators';
import { recordLogger } from '../logger';
import {
  getLatestEvents,
  resolveSessionName,
  stopRecordingIfActive,
} from '../shared/exportControlsUtils';
import {
  YAML_LANGUAGE_SUGGESTIONS,
  type YamlLanguagePreference,
  getStoredYamlLanguagePreference,
  persistYamlLanguagePreference,
  resolveYamlGenerationLanguage,
} from '../shared/yamlLanguage';
import { generateRecordTitle } from '../utils';
import { CodeBlock } from './ProgressModal/CodeBlock';
import { StepList } from './ProgressModal/StepList';

export interface ProgressStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'loading' | 'completed' | 'error';
  progress?: number;
  details?: string;
}

// Max concurrent AI description calls to limit peak memory usage
const MAX_DESCRIPTION_CONCURRENCY = 3;

export type CodeGenerationType = 'yaml' | 'playwright' | 'none';

interface ProgressModalProps {
  eventsCount?: number;
  sessionName?: string;
  events?: ChromeRecordedEvent[];
  sessionId?: string;
  onStopRecording?: () => void | Promise<void>;
  isFromStopRecording?: boolean;
}

export const ProgressModal: React.FC<ProgressModalProps> = ({
  eventsCount = 0,
  sessionName = '',
  events = [],
  sessionId,
  onStopRecording,
  isFromStopRecording,
}) => {
  const [selectedType, setSelectedType] = useState<CodeGenerationType>('yaml');

  // Initialize defaultType from localStorage
  const [defaultType, setDefaultType] = useState<CodeGenerationType>(() => {
    try {
      const stored = localStorage.getItem('midscene-default-code-type');
      if (stored && ['yaml', 'playwright', 'none'].includes(stored)) {
        return stored as CodeGenerationType;
      }
    } catch (error) {
      console.warn(
        'Failed to read default code type from localStorage:',
        error,
      );
    }
    return 'yaml'; // fallback default
  });
  const [yamlLanguagePreference, setYamlLanguagePreference] =
    useState<YamlLanguagePreference>(() => getStoredYamlLanguagePreference());
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [slidingOutSteps, setSlidingOutSteps] = useState<Set<string>>(
    new Set(),
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedTest, setGeneratedTest] = useState('');
  const [generatedYaml, setGeneratedYaml] = useState('');
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [showGeneratedCode, setShowGeneratedCode] = useState(false);

  // Streaming states
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingProcess, setThinkingProcess] = useState('');
  const [actualCode, setActualCode] = useState('');
  const [accumulatedThinking, setAccumulatedThinking] = useState('');

  const { updateSession } = useRecordingSessionStore();
  // Function to update defaultType and persist to localStorage
  const updateDefaultType = (newType: CodeGenerationType) => {
    setDefaultType(newType);
    try {
      localStorage.setItem('midscene-default-code-type', newType);
    } catch (error) {
      console.warn('Failed to save default code type to localStorage:', error);
    }
  };

  const updateYamlLanguagePreference = (
    newPreference: YamlLanguagePreference,
  ) => {
    setYamlLanguagePreference(newPreference);
    persistYamlLanguagePreference(newPreference);
  };

  // Get current session helper
  const getCurrentSession = () => {
    if (!sessionId) return null;
    return (
      useRecordingSessionStore
        .getState()
        .sessions.find((s) => s.id === sessionId) || null
    );
  };

  // Get the latest events with AI descriptions
  const getCurrentEvents = (): ChromeRecordedEvent[] => {
    if (sessionId) {
      return getLatestEvents(sessionId);
    }
    return events;
  };

  // Merge: load persisted code and handle auto-generation/display logic
  useEffect(() => {
    const session = getCurrentSession();

    // If this is from stop recording, use the pinned default type
    if (isFromStopRecording && eventsCount > 0) {
      setSelectedType(defaultType);
      // Only generate code if the pinned default is not 'none'
      if (defaultType === 'playwright' || defaultType === 'yaml') {
        handleGenerateCode(defaultType);
      }
      return;
    }

    // If the pinned default is 'none', set selected type to 'none' and don't generate anything
    if (defaultType === 'none') {
      setSelectedType('none');
      return;
    }

    // Prefer loading persisted code from session
    if (session?.generatedCode) {
      if (session.generatedCode.playwright && !generatedTest) {
        setGeneratedTest(session.generatedCode.playwright);
      }
      if (session.generatedCode.yaml && !generatedYaml) {
        setGeneratedYaml(session.generatedCode.yaml);
      }
    }

    // Check if the pinned default type has generated code
    const hasDefaultTypeCode =
      defaultType === 'yaml'
        ? generatedYaml || session?.generatedCode?.yaml
        : defaultType === 'playwright'
          ? generatedTest || session?.generatedCode?.playwright
          : false;

    // If the pinned default type has code, show it directly
    if (hasDefaultTypeCode) {
      setSelectedType(defaultType);
      setShowGeneratedCode(true);
      return;
    }

    // If the pinned default type doesn't have code and we have events, generate it
    if (
      eventsCount > 0 &&
      (defaultType === 'playwright' || defaultType === 'yaml')
    ) {
      setSelectedType(defaultType);
      handleGenerateCode(defaultType);
    } else {
      // Set selected type to the pinned default (even if it's a valid type but no events)
      setSelectedType(defaultType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isFromStopRecording]);

  // Helper function to update progress step
  const updateProgressStep = (
    stepIndex: number,
    updates: Partial<ProgressStep>,
  ) => {
    setSteps((prevSteps) =>
      prevSteps.map((step, index) =>
        index === stepIndex ? { ...step, ...updates } : step,
      ),
    );
  };

  const defaultModelConfig = globalModelConfigManager.getModelConfig('default');
  const resolvedYamlLanguage = resolveYamlGenerationLanguage(
    yamlLanguagePreference,
  );

  // Generate session title and description using AI
  const generateSessionTitleAndDescription = async (
    finalEvents: ChromeRecordedEvent[],
    stepIndex: number,
  ): Promise<string> => {
    let currentSessionName = sessionName; // Default to the original prop

    if (sessionId) {
      const session = useRecordingSessionStore
        .getState()
        .sessions.find((s) => s.id === sessionId);

      if (
        session &&
        (!session.name || session.name.includes('-') || !session.description)
      ) {
        // Update progress: Step 1 in progress
        updateProgressStep(stepIndex, {
          status: 'loading',
          details: '正在分析录制内容…',
        });

        const { title, description } = await generateRecordTitle(
          finalEvents,
          defaultModelConfig,
        );

        if (title || description) {
          updateSession(sessionId, {
            name: title || session.name,
            description: description || session.description,
          });

          // Update the session name to use for export
          currentSessionName = title || session.name;
        }

        // Update progress: Step 1 completed
        updateProgressStep(stepIndex, {
          status: 'completed',
          details: `已生成：「${currentSessionName}」`,
        });
      } else if (session) {
        // Use the current session name from the store in case it was updated elsewhere
        currentSessionName = session.name;

        // Update progress: Step 1 completed (skipped)
        updateProgressStep(stepIndex, {
          status: 'completed',
          details: `使用现有名称：「${currentSessionName}」`,
        });
      }
    } else {
      // Update progress: Step 1 completed (no session)
      updateProgressStep(stepIndex, {
        status: 'completed',
        details: `使用指定名称：「${currentSessionName}」`,
      });
    }

    return currentSessionName;
  };

  // Generate element descriptions for events that need them
  const generateElementDescriptions = async (
    events: ChromeRecordedEvent[],
    stepIndex: number,
  ): Promise<ChromeRecordedEvent[]> => {
    const eventsNeedingDescriptions = events.filter(
      (event: ChromeRecordedEvent) =>
        event.type !== 'navigation' && event.type !== 'scroll',
    );

    if (eventsNeedingDescriptions.length === 0) {
      updateProgressStep(stepIndex, {
        status: 'completed',
        details: '所有元素均已有描述',
      });
      return events;
    }

    updateProgressStep(stepIndex, {
      status: 'loading',
      progress: 0,
      details: `正在为 ${eventsNeedingDescriptions.length} 个元素生成描述…`,
    });

    let completedCount = 0;

    recordLogger.info('eventsNeedingDescriptions', {
      needingCount: eventsNeedingDescriptions.length,
      totalCount: events.length,
    });

    // Mark navigation/scroll events upfront (no AI call needed)
    for (const event of events) {
      if (event.type === 'navigation' || event.type === 'scroll') {
        event.elementDescription = 'navigation or scroll';
        event.descriptionLoading = false;
      }
    }

    // Process only events that need AI descriptions, with limited concurrency
    const processEvent = async (event: ChromeRecordedEvent) => {
      try {
        let description = '';
        if (event.elementDescription && event.descriptionLoading === false) {
          description = event.elementDescription;
        } else {
          description = await generateAIDescription(event, event.hashId);
        }

        event.elementDescription = description;
        event.descriptionLoading = false;

        completedCount++;

        const progress = Math.round(
          (completedCount / eventsNeedingDescriptions.length) * 100,
        );
        updateProgressStep(stepIndex, {
          status: 'loading',
          progress,
          details: `已生成 ${completedCount}/${eventsNeedingDescriptions.length} 个元素描述`,
        });
      } catch (error) {
        console.error('Failed to optimize event:', error);
        event.elementDescription = 'failed to generate element description';
        event.descriptionLoading = false;
        completedCount++;
      }
    };

    // Process in batches to limit peak memory usage
    for (
      let i = 0;
      i < eventsNeedingDescriptions.length;
      i += MAX_DESCRIPTION_CONCURRENCY
    ) {
      const batch = eventsNeedingDescriptions.slice(
        i,
        i + MAX_DESCRIPTION_CONCURRENCY,
      );
      await Promise.all(batch.map(processEvent));
    }

    // Update session with new event descriptions if sessionId exists
    if (sessionId) {
      updateSession(sessionId, {
        events,
        updatedAt: Date.now(),
      });
    }

    updateProgressStep(stepIndex, {
      status: 'completed',
      progress: 100,
      details: `已为 ${events.length} 个元素生成描述`,
    });

    return events;
  };

  // Streaming callback handler factory
  const createStreamingChunkHandler =
    (targetType: 'playwright' | 'yaml'): StreamingCallback =>
    (chunk: CodeGenerationChunk) => {
      setStreamingContent(chunk.accumulated);
      const code = chunk.accumulated;
      const thinking = chunk.reasoning_content;

      // Accumulate thinking process content
      if (thinking) {
        setAccumulatedThinking((prev) => prev + thinking);
      }

      setThinkingProcess(thinking);
      setActualCode(code);

      if (chunk.isComplete) {
        setIsStreaming(false);

        // Use the actual code for final result
        const finalCode = code || chunk.accumulated;

        // Set the final generated code based on the target type, not current selectedType
        if (targetType === 'playwright') {
          setGeneratedTest(finalCode);
        } else if (targetType === 'yaml') {
          setGeneratedYaml(finalCode);
        }

        // Update session with final code
        if (sessionId) {
          updateSession(sessionId, {
            generatedCode: {
              ...getCurrentSession()?.generatedCode,
              [targetType]: finalCode,
            },
            updatedAt: Date.now(),
          });
        }
      }
    };

  // Common function to handle code generation with streaming support
  const handleCodeGeneration = async (type: 'playwright' | 'yaml') => {
    // Get the most current events
    const currentEvents = getCurrentEvents();

    if (currentEvents.length === 0) {
      message.warning(`暂无可用于生成 ${type} 的操作`);
      return;
    }

    setIsGenerating(true);
    setIsStreaming(true);
    setStreamingContent('');
    setThinkingProcess('');
    setActualCode('');
    setAccumulatedThinking('');

    // Initialize progress steps
    const progressSteps: ProgressStep[] = [
      {
        id: 'descriptions',
        title: '生成元素描述',
        description: '正在分析界面元素并生成描述',
        status: 'pending',
      },
      {
        id: 'title',
        title: '生成名称和说明',
        description: '正在使用 AI 生成录制名称和说明',
        status: 'pending',
      },
      {
        id: type,
        title:
          type === 'playwright' ? '生成 Playwright 代码' : '生成 YAML 配置',
        description:
          type === 'playwright'
            ? '正在生成可执行的 Playwright 测试代码'
            : '正在生成 YAML 配置',
        status: 'pending',
      },
    ];

    setSteps(progressSteps);
    // Reset completed states
    setCompletedSteps(new Set());
    setSlidingOutSteps(new Set());
    // Hide code generation area when starting new generation
    setShowGeneratedCode(false);
    // Only clear the code that we're about to regenerate, preserve the other type
    if (type === 'playwright') {
      setGeneratedTest('');
    } else {
      setGeneratedYaml('');
    }

    try {
      // Step 0: Stop recording if currently recording
      await stopRecordingIfActive(onStopRecording);

      // After stopping recording, get the latest events from session
      let finalEvents = getCurrentEvents();
      recordLogger.info('start generating code', {
        eventsCount: finalEvents.length,
        sessionId,
      });

      // Step 1: Generate element descriptions
      updateProgressStep(0, { status: 'loading' });
      finalEvents = await generateElementDescriptions(finalEvents, 0);
      recordLogger.info('Generated element descriptions', {
        eventsCount: finalEvents.length,
        sessionId,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Step 2: Generate session title and description if not already generated
      updateProgressStep(1, { status: 'loading' });

      finalEvents = getCurrentEvents();
      const currentSessionName = await generateSessionTitleAndDescription(
        finalEvents,
        1,
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      recordLogger.info('Generated session title and description', {
        eventsCount: finalEvents.length,
        sessionId,
        currentSessionName,
      });

      // Step 3: Generate code with streaming support
      updateProgressStep(2, {
        status: 'loading',
        details:
          type === 'playwright'
            ? '正在生成 Playwright 测试代码…'
            : `正在生成 YAML 配置（${resolvedYamlLanguage}）…`,
      });

      finalEvents = getCurrentEvents();

      // Show the code generation area immediately when streaming starts
      setShowGeneratedCode(true);

      let generatedCode: string;

      if (type === 'playwright') {
        // Use streaming for Playwright
        const streamingResult = await generatePlaywrightTestStream(
          finalEvents,
          {
            stream: true,
            onChunk: createStreamingChunkHandler(type),
          },
          defaultModelConfig,
        );
        generatedCode = streamingResult.content;
      } else {
        // Use streaming for YAML
        const streamingResult = await generateYamlTestStream(
          finalEvents,
          {
            stream: true,
            onChunk: createStreamingChunkHandler(type),
            testName: currentSessionName,
            description: `Test session recorded on ${new Date().toLocaleDateString()}`,
            includeTimestamps: true,
            language: resolvedYamlLanguage,
          },
          defaultModelConfig,
        );
        generatedCode = streamingResult.content;
      }

      // Update session with generated code if sessionId exists
      if (sessionId) {
        updateSession(sessionId, {
          generatedCode: {
            ...getCurrentSession()?.generatedCode,
            [type]: generatedCode,
          },
          updatedAt: Date.now(),
        });
      }

      // Set the generated code in state
      if (type === 'playwright') {
        setGeneratedTest(generatedCode);
      } else {
        setGeneratedYaml(generatedCode);
      }

      // Mark all steps as completed
      progressSteps.forEach((_, index) => {
        updateProgressStep(index, { status: 'completed' });
      });

      // Show the generated code after generation is complete
      setShowGeneratedCode(true);

      // Show success message
      message.success(
        `${type === 'playwright' ? 'Playwright 测试代码' : 'YAML 配置'}已成功生成！`,
      );
    } catch (error) {
      recordLogger.error(`Failed to generate ${type}`, undefined, error);

      // Update current step to error status
      const currentStep = steps.findIndex((step) => step.status === 'loading');
      if (currentStep >= 0) {
        updateProgressStep(currentStep, {
          status: 'error',
          details: `错误：${error instanceof Error ? error.message : '未知错误'}`,
        });
      }

      setTimeout(() => {
        message.error(
          `生成 ${type} 失败： ${error instanceof Error ? error.message : '未知错误'}`,
        );
      }, 2000);
    } finally {
      setIsGenerating(false);
      setIsStreaming(false);
    }
  };

  // Function to handle code generation from dropdown
  const handleGenerateCode = async (type: CodeGenerationType) => {
    if (getCurrentEvents().length === 0 || type === 'none') {
      return;
    }

    await handleCodeGeneration(type);
  };

  // Copy generated test to clipboard
  const handleCopyTest = () => {
    navigator.clipboard.writeText(generatedTest);
    message.success('测试代码已复制到剪贴板');
  };

  // Copy generated YAML to clipboard
  const handleCopyYaml = () => {
    navigator.clipboard.writeText(generatedYaml);
    message.success('YAML 已复制到剪贴板');
  };

  // Download generated test as a TypeScript file
  const handleDownloadTest = () => {
    const downloadSessionName = resolveSessionName(sessionName, sessionId);

    const dataBlob = new Blob([generatedTest], {
      type: 'application/typescript',
    });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${downloadSessionName}-playwright-test.ts`;
    link.click();

    URL.revokeObjectURL(url);
    message.success(`「${downloadSessionName}」的 Playwright 脚本已下载`);
  };

  // Download generated YAML as a YAML file
  const handleDownloadYaml = () => {
    const downloadSessionName = resolveSessionName(sessionName, sessionId);

    const dataBlob = new Blob([generatedYaml], {
      type: 'application/x-yaml',
    });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${downloadSessionName}-test.yaml`;
    link.click();

    URL.revokeObjectURL(url);
    message.success(`「${downloadSessionName}」的 YAML 脚本已下载`);
  };

  // Regenerate Playwright test
  const handleRegenerateTest = async () => {
    await handleCodeGeneration('playwright');
  };

  // Regenerate YAML test
  const handleRegenerateYaml = async () => {
    await handleCodeGeneration('yaml');
  };

  // Monitor step completion state changes, add sliding animation
  useEffect(() => {
    steps.forEach((step) => {
      if (step.status === 'completed' && !completedSteps.has(step.id)) {
        // Mark as sliding out state
        setSlidingOutSteps((prev) => new Set([...prev, step.id]));

        // Mark as completed after 500ms (remove from DOM)
        setTimeout(() => {
          setCompletedSteps((prev) => new Set([...prev, step.id]));
          setSlidingOutSteps((prev) => {
            const newSet = new Set(prev);
            newSet.delete(step.id);
            return newSet;
          });
        }, 500);
      }
    });
  }, [steps, completedSteps]);

  // Reset state when starting new generation
  const handleSelectChange = (value: CodeGenerationType) => {
    console.log('handleSelectChange', value);
    setSelectedType(value);

    if (value === 'playwright') {
      // Don't clear yaml code, just check if playwright code exists
      if (generatedTest) {
        setShowGeneratedCode(true);
      } else {
        setShowGeneratedCode(false);
        if (!isGenerating) {
          handleGenerateCode(value);
        }
      }
    } else if (value === 'yaml') {
      // Don't clear playwright code, just check if yaml code exists
      if (generatedYaml) {
        setShowGeneratedCode(true);
      } else {
        setShowGeneratedCode(false);
        if (!isGenerating) {
          handleGenerateCode(value);
        }
      }
    } else if (value === 'none') {
      setShowGeneratedCode(false);
      // Don't clear generated code when selecting 'none', preserve it for future switches
    } else {
      setShowGeneratedCode(false);
    }
  };

  const codeTypeOptions = [
    {
      label: (
        <>
          <CodeOutlined className="text-blue-500" /> Playwright
        </>
      ),
      value: 'playwright' as const,
    },
    {
      label: (
        <>
          <FileTextOutlined className="text-green-500" /> YAML
        </>
      ),
      value: 'yaml' as const,
    },
    { label: '不自动生成', value: 'none' as const },
  ];

  const getStepIcon = (step: ProgressStep) => {
    switch (step.status) {
      case 'loading':
        return <LoadingOutlined style={{ color: '#1890ff' }} />;
      case 'completed':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'error':
        return <CheckCircleOutlined style={{ color: '#ff4d4f' }} />;
      default:
        return (
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              backgroundColor: '#d9d9d9',
            }}
          />
        );
    }
  };

  const getStepColor = (step: ProgressStep) => {
    switch (step.status) {
      case 'loading':
        return '#1890ff';
      case 'completed':
        return '#52c41a';
      case 'error':
        return '#ff4d4f';
      default:
        return '#d9d9d9';
    }
  };

  const thirdStepStarted =
    steps.length >= 3 &&
    (steps[2].status === 'loading' ||
      steps[2].status === 'completed' ||
      steps[2].status === 'error');

  return (
    <>
      {eventsCount === 0 ? (
        <div className="text-center text-gray-400 py-5">
          <div className="text-lg mb-2">暂无可用于生成代码的操作</div>
          <div className="text-sm">请先录制网页操作</div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <Select
              value={selectedType}
              onChange={(value) => {
                // Prevent selecting "None" directly - only allow through pin icon
                if (value === 'none') {
                  return;
                }
                handleSelectChange(value);
              }}
              className="w-60"
              size="middle"
              suffixIcon={<DownOutlined />}
              disabled={isGenerating}
            >
              {codeTypeOptions.map((option) => (
                <Select.Option
                  key={option.value}
                  value={option.value}
                  disabled={option.value === 'none'}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={option.value === 'none' ? 'text-gray-400' : ''}
                    >
                      {option.label}
                    </span>
                    <div className="flex items-center gap-1">
                      <Tooltip
                        title={
                          option.value === 'none'
                            ? '设为默认不自动生成代码'
                            : '设为默认代码生成类型'
                        }
                      >
                        {defaultType === option.value ? (
                          <PushpinFilled
                            className="text-blue-500 cursor-pointer hover:text-blue-600 ml-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateDefaultType(option.value);
                              // If pinning "None", also set it as selected type
                              if (option.value === 'none') {
                                setSelectedType('none');
                                handleSelectChange('none');
                              }
                            }}
                          />
                        ) : (
                          <PushpinOutlined
                            className="text-gray-400 cursor-pointer hover:text-gray-600 ml-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateDefaultType(option.value);
                              // If pinning "None", also set it as selected type
                              if (option.value === 'none') {
                                setSelectedType('none');
                                handleSelectChange('none');
                              }
                            }}
                          />
                        )}
                      </Tooltip>
                    </div>
                  </div>
                </Select.Option>
              ))}
            </Select>
            {selectedType === 'yaml' && (
              <AutoComplete
                value={yamlLanguagePreference}
                onChange={updateYamlLanguagePreference}
                options={YAML_LANGUAGE_SUGGESTIONS.map((option) => ({
                  label:
                    option.value === 'auto'
                      ? `自动（${resolvedYamlLanguage}）`
                      : option.label,
                  value: option.value,
                }))}
                className="w-40"
                size="middle"
                disabled={isGenerating}
                placeholder="生成语言"
              />
            )}
            {(selectedType === 'playwright' || selectedType === 'yaml') &&
              (showGeneratedCode || isStreaming) && (
                <div className="flex gap-0.2 ml-auto">
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={
                      selectedType === 'playwright'
                        ? handleCopyTest
                        : handleCopyYaml
                    }
                    className="!border-none !bg-none !shadow-none"
                    disabled={
                      isStreaming ||
                      (selectedType === 'playwright'
                        ? !generatedTest
                        : !generatedYaml)
                    }
                    title="复制到剪贴板"
                  />
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={
                      selectedType === 'playwright'
                        ? handleRegenerateTest
                        : handleRegenerateYaml
                    }
                    disabled={isGenerating || isStreaming}
                    className="!border-none !bg-none !shadow-none"
                    title="重新生成代码"
                  />
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    className="!border-none !bg-none !shadow-none"
                    onClick={
                      selectedType === 'playwright'
                        ? handleDownloadTest
                        : handleDownloadYaml
                    }
                    disabled={
                      isStreaming ||
                      (selectedType === 'playwright'
                        ? !generatedTest
                        : !generatedYaml)
                    }
                    title={
                      selectedType === 'playwright'
                        ? '下载 .ts 文件'
                        : '下载 .yaml 文件'
                    }
                  />
                </div>
              )}
          </div>
          {selectedType === 'none' && (
            <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm">
              <div className="font-semibold mb-1">尚未选择自动生成类型</div>
              <div>
                选择 <b>不自动生成</b> 表示停止录制后不自动生成代码。
              </div>
              <div className="mt-1">
                要自动生成 <b>YAML</b> 或 <b>Playwright</b>{' '}
                代码，请点击右侧图钉，将其设为默认类型。
                <br />
                停止录制时，系统会按默认类型自动生成代码。
              </div>
            </div>
          )}
        </>
      )}

      {/* Steps for selectedType only */}
      {steps.length > 0 &&
        // !steps.every((step) => step.status === 'completed') &&
        (() => {
          // Hide step display if the third step has started
          if (thirdStepStarted) {
            return null;
          }

          return (
            <StepList
              steps={steps}
              completedSteps={completedSteps}
              slidingOutSteps={slidingOutSteps}
              getStepIcon={getStepIcon}
              getStepColor={getStepColor}
            />
          );
        })()}

      {/* Code block for selectedType only */}
      {(showGeneratedCode || isStreaming) && (
        <>
          {selectedType === 'playwright' &&
            (generatedTest ||
              (isStreaming && selectedType === 'playwright')) && (
              <CodeBlock
                key={'playwright'}
                code={generatedTest}
                type={'playwright'}
                loading={isGenerating}
                isStreaming={isStreaming && selectedType === 'playwright'}
                streamingContent={streamingContent}
                thinkingProcess={thinkingProcess}
                actualCode={actualCode}
                accumulatedThinking={accumulatedThinking}
                stepDisplay={thirdStepStarted || steps.length === 0}
              />
            )}
          {selectedType === 'yaml' &&
            (generatedYaml || (isStreaming && selectedType === 'yaml')) && (
              <CodeBlock
                key={'yaml'}
                code={generatedYaml}
                type={'yaml'}
                loading={isGenerating}
                isStreaming={isStreaming && selectedType === 'yaml'}
                streamingContent={streamingContent}
                thinkingProcess={thinkingProcess}
                actualCode={actualCode}
                accumulatedThinking={accumulatedThinking}
                stepDisplay={thirdStepStarted || steps.length === 0}
              />
            )}
        </>
      )}
    </>
  );
};
