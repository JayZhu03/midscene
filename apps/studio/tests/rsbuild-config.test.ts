import { describe, expect, it } from 'vitest';
import config from '../rsbuild.config';

describe('rsbuild config', () => {
  it('uses relative renderer asset paths outside development', () => {
    expect(config.environments?.renderer?.output?.assetPrefix).toBe('./');
  });

  it('resolves renderer workspace packages from source-safe entries', () => {
    const alias = config.resolve?.alias as Record<string, string | false>;

    expect(
      String(alias['@midscene/playground-app$']).split('\\').join('/'),
    ).toContain('packages/playground-app/src/index.ts');
    expect(
      String(alias['@midscene/playground$']).split('\\').join('/'),
    ).toContain('packages/playground/src/index.browser.ts');
    expect(
      String(alias['@midscene/visualizer$']).split('\\').join('/'),
    ).toContain('packages/visualizer/src/index.tsx');
    expect(
      String(alias['@midscene/web/static$']).split('\\').join('/'),
    ).toContain('packages/web-integration/src/static/index.ts');
    expect(String(alias['@/utils$']).split('\\').join('/')).toContain(
      'packages/visualizer/src/utils/index.ts',
    );
    expect(alias['@silvia-odwyer/photon']).toBe(false);
  });
});
