import {
  AimOutlined,
  CompassOutlined,
  CopyOutlined,
  EditOutlined,
  KeyOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons';
import {
  getMidsceneRecorderEventDescription,
  getMidsceneRecorderSemantic,
} from '@midscene/shared/recorder';
import {
  App as AntdApp,
  Button,
  Card,
  Image,
  Popover,
  Space,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ShinyText } from './components/shiny-text';
import type { RecordedEvent } from './recorder';
import './RecordTimeline.css';

const { Text } = Typography;

interface RecordTimelineProps {
  events: RecordedEvent[];
  /** Ordered display entries, including annotations that are not recorded actions. */
  entries?: RecordTimelineEntry[];
  layout?: 'bounded' | 'parent-scroll';
  scrollContainerRef?: RefObject<HTMLElement>;
  onEventClick?: (event: RecordedEvent, index: number) => void;
  variant?: 'default' | 'chrome-extension';
  autoScroll?: boolean;
  renderGap?: (index: number) => ReactNode;
  renderActions?: (index: number) => ReactNode;
  renderEditor?: (index: number) => ReactNode;
}

export type RecordTimelineEntry =
  | { event: RecordedEvent; details?: string }
  | {
      id: string;
      description: ReactNode;
      descriptionText: string;
      icon: ReactNode;
      color: string;
      details: string;
    };

function TwoLineEventDescription({
  children,
  tooltip,
}: {
  children: ReactNode;
  tooltip: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const updateTruncation = () => {
      const element = contentRef.current;
      if (!element) {
        return;
      }
      setIsTruncated(element.scrollHeight > element.clientHeight + 1);
    };

    updateTruncation();
    if (typeof ResizeObserver === 'undefined' || !contentRef.current) {
      return;
    }

    const observer = new ResizeObserver(updateTruncation);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [tooltip]);

  return (
    <Tooltip title={isTruncated ? tooltip : undefined}>
      <div ref={contentRef} className="record-timeline-event-description">
        {children}
      </div>
    </Tooltip>
  );
}

export const RecordTimeline = ({
  events,
  entries,
  layout = 'bounded',
  scrollContainerRef,
  onEventClick,
  variant = 'default',
  autoScroll = true,
  renderGap,
  renderActions,
  renderEditor,
}: RecordTimelineProps) => {
  const { message } = AntdApp.useApp();
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const timelineRootRef = useRef<HTMLDivElement>(null);
  const entryCount = entries?.length ?? events.length;

  useEffect(() => {
    if (autoScroll && entryCount > 0) {
      const timeline =
        scrollContainerRef?.current ??
        timelineRootRef.current?.querySelector<HTMLElement>('.ant-timeline');
      if (timeline) {
        const nextScrollTop = timeline.scrollHeight;
        if (typeof timeline.scrollTo === 'function') {
          timeline.scrollTo({
            top: nextScrollTop,
            behavior: 'smooth',
          });
        } else {
          timeline.scrollTop = nextScrollTop;
        }
      }
    }
  }, [entryCount, scrollContainerRef, autoScroll]);

  const toggleEventExpansion = (index: string) => {
    const newExpanded = new Set(expandedEvents);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedEvents(newExpanded);
  };

  const truncateJsonStrings = (obj: any, maxLength = 30): any => {
    if (typeof obj === 'string') {
      return obj.length > maxLength ? `${obj.substring(0, maxLength)}...` : obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => truncateJsonStrings(item, maxLength));
    }
    if (obj && typeof obj === 'object') {
      const truncated: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          truncated[key] = truncateJsonStrings(obj[key], maxLength);
        }
      }
      return truncated;
    }
    return obj;
  };

  const copyToClipboard = (text: string, plainText = false) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        message.success(plainText ? '已复制到剪贴板' : 'JSON 已复制到剪贴板');
      })
      .catch(() => {
        message.error('复制失败');
      });
  };
  const getEventIcon = (type: string) => {
    switch (type) {
      case 'click':
        return <AimOutlined style={{ color: '#1890ff' }} />;
      case 'drag':
        return <AimOutlined style={{ color: '#13c2c2' }} />;
      case 'input':
        return <EditOutlined style={{ color: '#52c41a' }} />;
      case 'scroll':
        return <VerticalAlignTopOutlined style={{ color: '#faad14' }} />;
      case 'navigation':
        return <CompassOutlined style={{ color: '#722ed1' }} />;
      case 'setViewport':
        return <CompassOutlined style={{ color: '#eb2f96' }} />;
      case 'keydown':
        return <KeyOutlined style={{ color: '#fa8c16' }} />;
      default:
        return <AimOutlined style={{ color: '#d9d9d9' }} />;
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case 'click':
        return '#1890ff';
      case 'drag':
        return '#13c2c2';
      case 'input':
        return '#52c41a';
      case 'scroll':
        return '#faad14';
      case 'navigation':
        return '#722ed1';
      case 'setViewport':
        return '#eb2f96';
      case 'keydown':
        return '#fa8c16';
      default:
        return '#d9d9d9';
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const isCoordinateValue = (value?: string) =>
    Boolean(value && /^\s*\d+(?:\.\d+)?,\s*\d+(?:\.\d+)?\s*$/.test(value));

  const getDisplayDescription = (event: RecordedEvent) =>
    getMidsceneRecorderEventDescription(event);

  const getViewportDescription = (event: RecordedEvent) => {
    const width = event.pageInfo?.width;
    const height = event.pageInfo?.height;
    if (
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return undefined;
    }
    return `${width}x${height} px`;
  };

  const getEventTitle = (event: RecordedEvent) => {
    switch (event.type) {
      case 'click':
        if (event.targetTagName === 'BUTTON') {
          return '点击按钮';
        }
        if (event.value && !isCoordinateValue(event.value)) {
          return `点击元素「${event.value}」`;
        }
        return '点击';
      case 'drag':
        return '拖拽';
      case 'input':
        return '输入';
      case 'scroll':
        return '滚动';
      case 'navigation':
        return '页面跳转';
      case 'setViewport':
        return '视口变化';
      case 'keydown':
        return '键盘按键';
      default:
        return event.type;
    }
  };

  const getEventDescription = (event: RecordedEvent) => {
    const eventTitle = getEventTitle(event);

    switch (event.type) {
      case 'click':
      case 'drag':
        if (getMidsceneRecorderSemantic(event)?.status === 'pending') {
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Text>{eventTitle} - </Text>
              <ShinyText
                text="正在分析目标…"
                disabled={false}
                speed={3}
                className="step-title-shiny"
              />
            </span>
          );
        }

        if (getMidsceneRecorderSemantic(event)?.status === 'ready') {
          return (
            <Text>
              {eventTitle} - {getDisplayDescription(event)}
            </Text>
          );
        }

        return <Text>{eventTitle}</Text>;

      case 'input':
        if (getMidsceneRecorderSemantic(event)?.status === 'ready') {
          return (
            <Text>
              {eventTitle} - {getDisplayDescription(event)}
            </Text>
          );
        }

        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Text>{eventTitle} - </Text>
            <ShinyText
              text={event.value ? `"${event.value}"` : ''}
              disabled={false}
              speed={3}
              className="step-title-shiny"
            />
          </span>
        );

      case 'scroll':
        if (getDisplayDescription(event)) {
          return (
            <Text>
              {eventTitle} - {getDisplayDescription(event)}
            </Text>
          );
        }
        return (
          <Text>
            {eventTitle} - {event.value?.split(' ')[0] || '已录制的滚动操作'}
          </Text>
        );

      case 'navigation': {
        const navigationDescription = getDisplayDescription(event);
        if (navigationDescription) {
          return (
            <Text>
              {eventTitle} - {navigationDescription}
            </Text>
          );
        }
        const truncatedUrl =
          event.url && event.url.length > 50
            ? `${event.url.substring(0, 50)}...`
            : event.url;
        return (
          <Text>
            {eventTitle} - {truncatedUrl}
          </Text>
        );
      }

      case 'setViewport': {
        const viewportDescription = getViewportDescription(event);
        return (
          <Text>
            {eventTitle}
            {viewportDescription ? ` - ${viewportDescription}` : ''}
          </Text>
        );
      }

      case 'keydown':
        return (
          <Text>
            {eventTitle} - 按键： {event.value || '未知'}
          </Text>
        );

      default:
        return <Text>{eventTitle}</Text>;
    }
  };

  const getEventDescriptionText = (event: RecordedEvent) => {
    const eventTitle = getEventTitle(event);
    const description = getDisplayDescription(event);

    switch (event.type) {
      case 'click':
      case 'drag':
        return getMidsceneRecorderSemantic(event)?.status === 'pending'
          ? `${eventTitle} - 正在分析目标…`
          : description
            ? `${eventTitle} - ${description}`
            : eventTitle;
      case 'input':
        return getMidsceneRecorderSemantic(event)?.status === 'ready'
          ? `${eventTitle} - ${description}`
          : `${eventTitle} - ${event.value ? `"${event.value}"` : ''}`;
      case 'scroll':
        return description
          ? `${eventTitle} - ${description}`
          : `${eventTitle} - ${event.value?.split(' ')[0] || '已录制的滚动操作'}`;
      case 'navigation':
        return `${eventTitle} - ${description || event.url || ''}`;
      case 'setViewport': {
        const viewportDescription = getViewportDescription(event);
        return viewportDescription
          ? `${eventTitle} - ${viewportDescription}`
          : eventTitle;
      }
      case 'keydown':
        return `${eventTitle} - 按键： ${event.value || '未知'}`;
      default:
        return eventTitle;
    }
  };

  const displayEntries: RecordTimelineEntry[] =
    entries ?? events.map((event) => ({ event }));
  const timelineItems = displayEntries.map((entry, index) => {
    const event = 'event' in entry ? entry.event : null;
    const boxedImage = event?.screenshotWithBox;
    const afterImage = event?.screenshotAfter;
    const entryId =
      ('event' in entry ? entry.event.hashId : entry.id) || String(index);
    const isExpanded = expandedEvents.has(entryId);
    const eventDescription =
      'event' in entry ? getEventDescription(entry.event) : entry.description;
    const eventDescriptionText =
      'event' in entry
        ? getEventDescriptionText(entry.event)
        : entry.descriptionText;
    const eventColor =
      'event' in entry ? getEventColor(entry.event.type) : entry.color;
    const detailText =
      entry.details ??
      (isExpanded ? JSON.stringify(truncateJsonStrings(event), null, 2) : '');

    return {
      ...(entries
        ? { key: 'event' in entry ? entry.event.hashId : entry.id }
        : {}),
      dot: 'event' in entry ? getEventIcon(entry.event.type) : entry.icon,
      color: eventColor,
      children: (
        <div data-entry-id={entryId}>
          <Card
            className="record-timeline-event-card"
            size="small"
            bordered={false}
            style={{ marginBottom: isExpanded ? 8 : 8, cursor: 'pointer' }}
            onClick={() => {
              toggleEventExpansion(entryId);
              if (event) onEventClick?.(event, index);
            }}
            styles={{
              body: {
                padding: '8px 12px',
                backgroundColor: '#F2F4F7',
                borderRadius: '8px',
              },
            }}
          >
            <Space
              className={
                variant === 'chrome-extension'
                  ? 'record-timeline-event-row'
                  : undefined
              }
              style={{
                width: '100%',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: 'rgba(0, 0, 0, 0.85)',
              }}
            >
              <Space
                className={
                  variant === 'chrome-extension'
                    ? 'record-timeline-event-copy'
                    : undefined
                }
                style={{ flex: 1, minWidth: 0 }}
              >
                {variant === 'chrome-extension' ? (
                  <TwoLineEventDescription tooltip={eventDescriptionText}>
                    {eventDescription}
                  </TwoLineEventDescription>
                ) : (
                  eventDescription
                )}
              </Space>
              <Space
                className={
                  variant === 'chrome-extension'
                    ? 'record-timeline-event-media'
                    : undefined
                }
              >
                {renderActions?.(index)}
                {(boxedImage || afterImage) && (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {boxedImage && (
                      <div
                        className="record-timeline-screenshot-thumbnail"
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          boxShadow: '1px 1px 1px 1px #00000014',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease-in-out',
                          zIndex: 2,
                        }}
                        onMouseEnter={(e) => {
                          const target = e.currentTarget as HTMLElement;
                          target.style.transform = 'scale(1.2)';
                          target.style.boxShadow = `0 2px 8px ${eventColor}60`;
                        }}
                        onMouseLeave={(e) => {
                          const target = e.currentTarget as HTMLElement;
                          target.style.transform = 'scale(1)';
                          target.style.boxShadow = '1px 1px 1px 1px #00000014';
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <Image
                          src={boxedImage}
                          width="100%"
                          height="100%"
                          style={{
                            objectFit: 'cover',
                            display: 'block',
                          }}
                          preview={{
                            mask: false,
                          }}
                        />
                      </div>
                    )}
                    {afterImage && (
                      <div
                        className="record-timeline-screenshot-thumbnail"
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          boxShadow: '1px 1px 1px 1px #00000014',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease-in-out',
                          marginLeft: boxedImage ? '-8px' : '0',
                          zIndex: 1,
                        }}
                        onMouseEnter={(e) => {
                          const target = e.currentTarget as HTMLElement;
                          target.style.transform = 'scale(1.2)';
                          target.style.boxShadow = '0 2px 8px #52c41a60';
                        }}
                        onMouseLeave={(e) => {
                          const target = e.currentTarget as HTMLElement;
                          target.style.transform = 'scale(1)';
                          target.style.boxShadow = '1px 1px 1px 1px #00000014';
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <Image
                          src={afterImage}
                          width="100%"
                          height="100%"
                          style={{
                            objectFit: 'cover',
                            display: 'block',
                          }}
                          preview={{
                            mask: false,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </Space>
            </Space>

            {isExpanded && (
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <Card
                  size="small"
                  style={{ backgroundColor: '#f5f5f5' }}
                  styles={{ body: { padding: '0px' } }}
                >
                  <div style={{ position: 'relative' }}>
                    <pre
                      style={{
                        fontSize: '12px',
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        backgroundColor: '#ffffff',
                        padding: '12px',
                        // paddingRight: '50px',
                        borderRadius: '8px',
                        // border: '1px solid #d9d9d9',
                        maxHeight:
                          layout === 'parent-scroll' ? undefined : '250px',
                        overflow:
                          layout === 'parent-scroll' ? 'visible' : 'auto',
                        overflowWrap:
                          layout === 'parent-scroll' ? 'anywhere' : undefined,
                      }}
                    >
                      {detailText}
                    </pre>
                    <Button
                      type="text"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(
                          entry.details ?? JSON.stringify(event, null, 2),
                          entry.details !== undefined,
                        );
                      }}
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        background: 'rgba(255, 255, 255, 0.9)',
                        border: '1px solid #d9d9d9',
                      }}
                      title={entry.details === undefined ? '复制 JSON' : '复制'}
                    />
                  </div>
                </Card>
              </div>
            )}
          </Card>
          {renderEditor?.(index)}
          {renderGap?.(index + 1)}
        </div>
      ),
    };
  });

  return (
    <div
      ref={timelineRootRef}
      className={`record-timeline-${variant}${layout === 'parent-scroll' ? ' record-timeline-parent-scroll' : ''}`}
      style={{ minHeight: 0, padding: '3px' }}
    >
      {renderGap?.(0)}
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Timeline
          mode="left"
          className="timeline-scrollable"
          items={timelineItems}
          style={{ paddingTop: 16 }}
        />
      </Space>
    </div>
  );
};
