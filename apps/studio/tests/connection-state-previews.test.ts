import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ConnectionFailedPreview from '../src/renderer/components/ConnectionFailedPreview';
import DisconnectedPreview from '../src/renderer/components/DisconnectedPreview';

describe('connection state previews', () => {
  it('renders the disconnected preview with the local icon and english copy', () => {
    const html = renderToStaticMarkup(
      createElement(DisconnectedPreview, {
        iconSrc: 'connection-closed.svg',
      }),
    );

    expect(html).toContain('connection-closed.svg');
    expect(html).toContain('Open test page');
  });

  it('renders custom disconnected copy for non-Android platforms', () => {
    const html = renderToStaticMarkup(
      createElement(DisconnectedPreview, {
        iconSrc: 'connection-closed.svg',
        title: 'Open Web Page',
      }),
    );

    expect(html).toContain('connection-closed.svg');
    expect(html).toContain('Open Web Page');
    expect(html).not.toContain('Connect Android Device');
  });

  it('renders the failed preview with the local icon and english copy', () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionFailedPreview, {
        pageUrl: 'https://mom.test/',
        iconSrc: 'connection-failed.svg',
      }),
    );

    expect(html).toContain('connection-failed.svg');
    expect(html).toContain('Connection failed');
    expect(html).toContain('Unable to connect to this page.');
    expect(html).not.toContain('ADB');
    expect(html).toContain('Reconnect');
  });
});
