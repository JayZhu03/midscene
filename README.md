# MOM UI Test Studio

A desktop tool built on Midscene Studio for recording, replaying and regression testing MOM workflows. Recorded web operations run through Playwright; Agent handles visual checks and additional actions. HTML reports preserve execution results and screenshot evidence.

[简体中文使用说明](./README.zh.md) · [Development guide](./CONTRIBUTING.md) · [MIT license](./LICENSE)

## Features

| Feature | Description |
| --- | --- |
| Webpage management | Persist URLs, viewport settings and browser sessions; manage different routes on the same site separately |
| Recording | Capture clicks, input, selection and scrolling; insert natural-language assertions while recording |
| Hybrid execution | Run web operations through Playwright, with Agent operations, waits and assertions based on live evidence |
| Script editing | Inspect steps and recording screenshots; insert or edit Agent instructions while keeping recorded Playwright operations fixed |
| Scenarios | Group scripts, reorder them, configure automatic or manual continuation, and run a scenario or one script |
| Recovery | Let Agent attempt recovery after a Playwright failure, then check prerequisites before continuing with later scripts |
| Reports | Preview and download HTML reports with readable actions, step evidence, original replay and recovery records |
| Import and export | Exchange scripts or scenarios as ZIP packages, including recording screenshots, script order and execution settings |
| Android | Connect phones or Android PDAs through ADB and use Agent actions and assertions with the same scenario, script and report management |

Upstream SDKs and other platform code remain in this repository. This delivery focuses on the Web and Android entry points.

## Install and get started

Regular users can install the internally distributed Windows x64 installer without Node.js, Git or a source build. The installer supports a custom installation directory, desktop and Start menu shortcuts, and uninstallation through Windows settings or the uninstaller in the installation directory.

1. Open Studio and configure the model service URL, API key, model name and model family. Visual actions and assertions require an image-capable model; model name and model family are separate settings.
2. Make sure the computer can reach the test environment and model service. Add a webpage; the default viewport is `1920 × 1080` and can be customized.
3. Create a scenario with a name and description, then choose **Record new script**.
4. Perform the workflow in the left-hand browser and insert assertions where needed, such as “The save-success message appears” or “There are 2165 production orders.” Recording saves the expectation; execution evaluates it.
5. Stop recording and review the steps. Replay in the current view before saving if needed. Agent operations and assertions can be inserted later from script details.
6. Run one script or the entire scenario. Choose **View report** afterward, inspect the results and download the HTML file for retention.

See the [upstream model configuration guide](https://midscenejs.com/model-common-config.html) for model parameters. Custom scenario, hybrid-script and report workflows follow this Studio implementation.

## Execution behavior

- **Use current session** continues with the browser's current state, including an existing login.
- **Fresh session** runs in an isolated browser session without clearing the original session. Return to the original session afterward if needed.
- **Manual continuation** waits at a configured script boundary for **Next step**. **Skip** skips that script and preserves its skipped status in the results.

An Agent instruction can combine an operation, expectation and wait, for example “Click Search, verify the total is 2165, and record a mismatch but continue” or “Wait three seconds before continuing.” Pure waits use a programmatic timer. Continuing after a confirmed mismatch preserves the failure; insufficient evidence or an incomplete operation is blocked.

When Playwright fails, Agent attempts recovery using the live page and records the outcome. Execution stops if a later script depends on business data that earlier steps did not produce. Recovery does not guarantee adaptation to every UI change.

Android requires USB debugging authorization or an established wireless ADB connection. **Restart application then run** requires a target package name and restarts the application without clearing app data or login state. Web and Android packages are validated by platform and cannot be mixed.

## Local data and collaboration

- Webpages, configuration, scenarios and scripts are local to each computer. GitHub stores tool source code and does not synchronize users' local test data.
- Only the latest **10 execution records** are retained. Download reports that need to be kept, and export scenarios or scripts separately for backup or sharing.
- A scenario package contains scripts and execution order; a script package contains one script. Imports create copies rather than overwriting existing content.
- Packages preserve recorded input values, including test passwords, URLs and screenshots. They exclude login sessions, model configuration and execution reports. Configure the model, log in and prepare required business data on the destination computer.
- Exported `manifest.json` and `README.md` document step order and execution rules for Playwright, Agent operations and visual assertions. Other execution assistants can implement the corresponding runtime.
- Development and installed builds use separate data directories. Migrate scenarios through export and import rather than assuming the builds share records.

**Successful operations do not establish complete business correctness.** Define expected results and manually review important assertions and reports. Recording actions alone does not create a complete test specification.

## Develop from source

Requires Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` and pnpm `>=9.3.0`. Run from the repository root:

```powershell
corepack enable
pnpm install
pnpm --filter studio dev
```

Installation triggers the repository's initial build. Development startup may use different local data from an installed build.

Build a Windows installer with the existing packaging script:

```powershell
pnpm --filter studio package:release -- --platform win32 --arch x64
```

Append `--version` with the desired delivery version when packaging. Outputs are written to `.release/studio/artifacts/`. Installers, model configuration and local business data are not included in Git source commits.

Run code checks:

```powershell
pnpm run lint
```

| Directory | Purpose |
| --- | --- |
| `apps/studio` | Electron shell, browser preview, recording and scenario UI |
| `apps/report` | HTML reports and execution evidence |
| `packages/playground` | Scenario runner, Agent recovery, assertion observation and report persistence |
| `packages/shared` | Recording events, DOM locators and Playwright code generation |
| `packages/core` | Midscene Agent and model integration |

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development and build details. When rebuilding reports, finish Playground first, then Report, then Studio. Do not build Playground and Report concurrently, which can leave stale templates.

## Upstream and license

This project is derived from [web-infra-dev/midscene](https://github.com/web-infra-dev/midscene). It retains the Midscene name, upstream source and original copyright notice. Thanks to Midscene, Playwright, Puppeteer and Electron for the underlying capabilities.

The code is [MIT licensed](./LICENSE). Custom features differ from upstream Midscene; this README describes the MOM testing tool. Consult the [upstream documentation](https://midscenejs.com/) for general SDK usage.
