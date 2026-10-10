# Native Playwright export

Start a Web recording in Studio, perform the flow manually, and stop recording. Choose **Native Playwright** in the recording's Code view, or **Export Playwright** in a replay item's three-dot menu. Save the `.spec.ts` file.

Compilation and export make no model calls. Replay uses only `@playwright/test` (validated with 1.58.1); it does not depend on Midscene or consume model tokens. Existing recording descriptions and Markdown generation are separate AI features and may still call models.

## Running a test

```powershell
corepack pnpm add -D @playwright/test@1.58.1
corepack pnpm exec playwright install chromium
# Use the variable names listed at the top of your exported test.
$env:MIDSCENE_INPUT_006 = 'actual password'
corepack pnpm exec playwright test ./recording-playwright-native.spec.ts
```

Password inputs use per-step environment variables instead of literal values. Append, clear, replace, and selection semantics are preserved. Exports check locator uniqueness and wait for observed navigation. Add business assertions for expected order states, query results, and other outcomes.

## Locator capture and limitations

DOM metadata is captured before each manual action. Locators prefer test attributes, semantic attributes, text, and component scopes. Ant Design Select clear buttons and arrows remain distinct targets. When a selected value overlays its input, clicks target the clickable select control. Drags store both DOM endpoints and positions relative to those elements.

Hidden duplicates are excluded. Form labels, card/dialog titles, and table row keys distinguish repeated controls. Row locators survive reordering without relying on row indexes. Multiple inputs or component subcontrols in one field can use relative structural paths inside a unique business scope; record again if the internal component structure changes. Separate button labels are preferred so badge count changes do not affect query buttons.

When semantic capture is insufficient, the pinned Playwright 1.58.1 selector generator supplies a fallback. Every generated selector is checked against the exact captured element. No application frontend changes or manual selectors are required. The engine loads lazily; it does not enable a recorder overlay or execute actions twice.

Indistinguishable controls can use structural or positional selectors. Generated scripts annotate this strategy and check candidate counts before `nth` selections. Changed counts stop playback, but reordering identical controls without changing counts can still change the target. Record again after such changes. Unresolved steps still produce errors; export success alone is not a passing test.

Supported actions include clicks, double clicks, right clicks, long presses, input/textarea and contenteditable typing with selections, keys, explicit-distance and four-direction edge scrolling, drags between DOM targets, open Shadow DOM, navigation, and viewport changes. Scroll capture selects containers by direction and accounts for chaining at nested scroll boundaries. Custom drag implementations and infinite lists need application-specific verification. Canvas, iframe, and closed Shadow DOM remain unsupported.

Older Markdown ZIP files and AI-only descriptions lack recording-time DOM metadata and cannot be directly compiled. These improvements apply to new recordings after upgrading. Business assertions still need to reflect the test case. An 18-step local fixture passed three fresh-context replays; this is not evidence of a 99% success rate on MOM.
