# Studio 原生网页显示

内置网页使用 Electron `WebContentsView`，沿用原来的打开网页、录制、场景执行和报告入口。显示 Chrome 窗口的选项继续使用独立 Chromium。

## 数据与执行链路

- 原生网页直接显示并接收鼠标、键盘和输入法事件，正常预览不再使用 MJPEG、图片解码或 HTTP 输入转发。
- Puppeteer 和 Playwright 通过本机 CDP 连接同一个网页 target；Agent 截图也来自这个 target。连接结束只断开自动化客户端，不关闭 Studio。
- 页面逻辑尺寸与左侧可见区域分开处理，通过原生缩放适配。回放调整页面尺寸时仍使用同一套布局，并刷新 Agent 使用的尺寸。
- 原生事件在网页捕获阶段采集 DOM，复用已有定位器生成、录制描述、编译和混合执行流程。连续输入和滚动合并；双击在主进程区分，避免页面跳转丢失点击。录制期间保留低频截图供 AI 描述，停止录制即停止采集。
- 无法固化的 iframe 等操作保留为需要 Agent 执行的操作，不能伪装成可靠的 DOM 步骤。
- 执行时使用透明原生视图拦截人工输入。不能取消 `before-mouse-event`：Electron 也会对 CDP 输入触发它，会造成自动化点击无效。
- Studio 弹窗覆盖网页时隐藏原生视图，以静态截图填充原位置，关闭弹窗后恢复原页面。

## 持久化

Studio 自身的配置、场景、脚本和报告继续使用原有存储。

网页存储位于原有 userData 下的 `native-web-profiles`，按网站 origin 隔离。常规网页持久化，临时执行使用独立内存 session，执行后可恢复原页面。正常关闭时保存 Cookie 和 sessionStorage，快照通过 Electron safeStorage 加密；localStorage、IndexedDB 等由 Electron 的持久 session 保存。

第一次迁移旧 Chromium 网页时，启动旧 profile 读取 Cookie、localStorage 和 sessionStorage，再导入新网页；不让 Electron 直接打开旧 Chrome 数据文件。**旧网页的 IndexedDB、缓存和 Service Worker 不迁移**，也不删除原 profile。这个限制不影响 Studio 自身的模型配置和场景数据。

## 验证

已验证真实 Electron 原生输入、逻辑尺寸与缩放、录制进入现有服务器、Playwright 回放、双击与滚动、完整页面跳转后的重新注入、执行输入挡层、弹窗遮挡、临时会话隔离及恢复、登录数据迁移和网页重开持久化。

完整构建的 Studio 已验证通过原表单打开网页、没有 MJPEG 图片元素、原生点击、窗口缩放及弹窗开关。实际配置的模型完成一条混合场景：Playwright 操作 → Agent 操作 → 正确视觉断言 → 故意错误的视觉断言，结果为三步通过、一步失败，并生成 Markdown 报告和执行记录。

完整退出并重启 Studio 后，网页列表、Cookie、localStorage 和 sessionStorage 均通过持久化验证。最终启动原用户配置的 Studio，已确认模型配置和已保存网页仍在，Web 会话使用原生预览且没有 MJPEG 图片元素。

验证使用本地可控页面；此前独立验证还确认 MOM 登录页能够原生显示并完成视觉断言。这不等于已验证全部 MOM 业务主线或长期运行无卡顿。

自动化检查：

```powershell
corepack pnpm --filter studio exec vitest run tests/native-browser.test.ts tests/native-browser-integration.test.mjs tests/execution-session.test.ts
corepack pnpm --filter @midscene/playground exec rstest tests/unit/server-interact.test.ts tests/unit/recorder-native-playwright.test.ts
corepack pnpm exec nx build @midscene/playground --skip-nx-cache --exclude-task-dependencies
corepack pnpm exec nx build studio --skip-nx-cache --exclude-task-dependencies
```

## 回退显示实现

关闭 Studio 后，用以下环境变量启动，可恢复旧图片预览，不改变已有场景和脚本格式：

```powershell
$env:MIDSCENE_STUDIO_LEGACY_PREVIEW = '1'
corepack pnpm --filter studio start
```

取消该变量后恢复原生显示。两种浏览器使用各自的网页 profile；迁移之后的登录状态不会自动反向同步到旧 Chromium。默认 CDP 端口动态分配且绑定本机，可通过 `MIDSCENE_STUDIO_CDP_PORT` 显式指定调试端口。
