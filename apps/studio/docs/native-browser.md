# Native web display in Studio

The embedded web mode uses Electron `WebContentsView` through the existing page, recording, scenario and report UI. The visible Chrome option continues to use a separate Chromium instance.

## Execution and input

Normal display no longer uses MJPEG, image decoding or HTTP input forwarding. Puppeteer, Playwright and Agent screenshots attach to the same Chromium target over loopback CDP. Client cleanup disconnects without closing Electron.

Native zoom fits the logical viewport inside the existing preview area. Viewport replay goes through this same layout path; Agent dimensions are refreshed. Native event capture reuses existing locator generation, descriptions, compilation and mixed execution. Input and wheel events are coalesced; double-click disambiguation happens in Node so navigation cannot destroy its timer. Only recording keeps a low-frequency screenshot cache for descriptions. Unsupported iframe operations remain Agent operations, rather than being assigned misleading DOM locators.

A transparent sibling native view prevents manual input during execution. Do not cancel Electron `before-mouse-event`: CDP events also reach that hook. Shell overlays hide the native view and display a still frame until the overlay closes.

## Storage

Studio settings, scenarios, scripts and reports retain their existing storage. Web profiles live under `userData/native-web-profiles`, isolated by origin. Normal sessions persist; fresh executions use an in-memory session and can restore the original page. Cookie and sessionStorage snapshots are saved with Electron safeStorage encryption on graceful close. Electron persists localStorage and IndexedDB itself.

The first migration reads cookies, localStorage and sessionStorage using the legacy Chromium profile and imports them into the new session. Electron never opens Chrome's profile files directly. **Existing web IndexedDB, caches and service workers are not imported.** Original profiles are preserved; Studio's own model settings and scenario data are unaffected.

## Validation and rollback

Real Electron tests cover native input, zoom, recording through the server, Playwright replay, double-click and wheel gestures, document reinjection, input shielding, overlay visibility, fresh-session isolation/restoration, legacy login migration and profile reopening. A built Studio smoke test covers its existing page form, absence of MJPEG images, native clicks, resizing and overlays.

A real model run completed Playwright action → Agent action → positive visual assertion → deliberately false visual assertion. The first three steps passed, the last failed, and a Markdown report and execution record were generated. This used a controlled local fixture. The earlier standalone proof also checked the actual MOM login page, but does not establish full MOM workflow coverage or indefinite reliability.

A complete application restart preserved the saved page list, cookies, localStorage and sessionStorage. The final app was also launched with the original user profile: model configuration and the saved page remained present, with native Web preview active and no MJPEG image element.

Run focused checks from the repository root:

```powershell
corepack pnpm --filter studio exec vitest run tests/native-browser.test.ts tests/native-browser-integration.test.mjs tests/execution-session.test.ts
corepack pnpm --filter @midscene/playground exec rstest tests/unit/server-interact.test.ts tests/unit/recorder-native-playwright.test.ts
corepack pnpm exec nx build @midscene/playground --skip-nx-cache --exclude-task-dependencies
corepack pnpm exec nx build studio --skip-nx-cache --exclude-task-dependencies
```

For rollback, close Studio and launch with `MIDSCENE_STUDIO_LEGACY_PREVIEW=1`. Clear that variable to return to native display. Scenario/script formats stay the same, but login changes made after migration are not synchronized back into the old Chromium profile. CDP uses a dynamic loopback port by default; `MIDSCENE_STUDIO_CDP_PORT` explicitly selects a debugging port.
