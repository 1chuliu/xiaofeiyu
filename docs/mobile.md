# 小肥鱼移动化 / 打包方案

> 目标：**不上架应用商店**，把现有 Web 应用变成手机可安装的 App，同时保留桌面版。
> 参考对象：Chatbox（Electron + Capacitor，一份代码跑桌面/Web/手机，直接发安装包）。

## 一、结论先行

**不需要用 Kotlin 重写。** 选 Capacitor 套壳 + 少量原生桥（SSE/HTTP/文件），前端 100% 复用。
Kotlin 代码量估计 300~500 行，集中在「网络桥」和「文件导入导出」。

## 二、Chatbox 的做法（可参考）

| 维度 | Chatbox | 来源 |
| --- | --- | --- |
| 代码库 | 单一 TS/React；Electron 桌面、Capacitor 移动、Web 三端 | [架构概览](https://deepwiki.com/chatboxai/chatbox/1.2-initial-project-structure)、[跨平台抽象](https://deepwiki.com/chatboxai/chatbox/3.6-cross-platform-abstractions) |
| 平台差异 | platform adapter：存储/网络/系统能力按平台实现 | 同上 |
| 存储 | 桌面 `config.json`+IndexedDB；Web IndexedDB；移动端 SQLite | [存储地图](https://github.com/chatboxai/chatbox/blob/75bb9355f826f9070ff5c53527674aab93eb8b9f/docs/technical/storage-map.md) |
| 网络 | 明确处理移动端 CORS 与原生流式，不重写业务 | 跨平台抽象 |
| 分发 | GitHub Releases 直接发 `Setup.exe` / `.APK`，不上商店 | [Releases](https://newreleases.io/project/github/chatboxai/chatbox/release/v1.21.1) |
| 许可 | 社区版 **GPLv3**；官方版闭源 | 仓库 README |

**注意**：GPLv3 只能参考架构与交互，不能把代码抄进我们 MIT 系项目，否则会传染整个仓库。

## 三、三条路线对比

| 路线 | 要重写吗 | 成本 | 体验 | 适合 |
| --- | --- | --- | --- | --- |
| **PWA**（现状） | 不用 | 0 | 加到主屏能独立窗口；受浏览器地址栏/CORS 限制 | 先让手机能用 |
| **Capacitor 套壳**（推荐） | 不用 | 3~7 天 | 真正 App，可发 APK，可放原生桥 | 要安装包、要绕 CORS/流式 |
| **Kotlin / Flutter 原生** | 全部重写 | 2~3 个月起 | 原生最好 | 只有强原生需求才值得 |

## 四、真正的难点：网络，不是 UI

现在的第三方网关能用，靠的是桌面 `server.mjs` 代理。手机上不能跑 Node 服务，而 WebView 里
`fetch` 一样受 CORS 限制，SSE 流式也需要原生支持。

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. 原生网络桥 | Kotlin 插件：原生发起请求 + 逐块回传文本 | 体验最好、Key 不出设备 | 要写约 300 行 Kotlin |
| B. 托管代理 | 自己部署一个中转（和桌面 server 同逻辑） | 手机端零改动 | Key 过你的服务器，成本/合规上升 |
| C. 只支持官方 API | DeepSeek 官方地址若允许跨域则直连 | 最简单 | 第三方网关在手机端不可用 |

推荐 **A**（与 Chatbox 的「原生流式」思路一致）。

## 五、平台适配层（已开始落地）

已建 `official/src/platform/index.ts`：

```ts
export type KeyValueStorage = { get(key): string | null; set(key, value): void; remove(key): void }
export type PlatformFetch = (input: string, init?: RequestInit) => Promise<Response>

export const platform = { storage, fetch }
```

- 当前：Web 实现（localStorage + 浏览器 fetch），业务代码无感知
- 之后：Capacitor 版在 `platform` 里换成 Preferences/SQLite 与原生 fetch 桥，业务代码不动
- 已迁移：`settings.ts` 的读写、`client.ts` 的请求入口

后续按同样方式迁移：会话存储（IndexedDB）、附件读写、文件导入导出。

## 六、分阶段计划

| 阶段 | 内容 | 交付物 | 估时 |
| --- | --- | --- | --- |
| 0 | 手机浏览器访问 + 添加到主屏，验证输入法/键盘/触控 | 一份体验问题清单 | 半天 |
| 1 | 平台适配层（storage/network）+ 已迁移的调用点 | 本仓库 `platform/` | 已完成初版 |
| 2 | Capacitor Android 工程 + 原生 SSE/HTTP 插件 + 文件导入导出 | 可安装 APK | 3~5 天 |
| 3 | 签名、版本号、检查更新（指向下载页） | 正式分发包 | 1 天 |
| 4 | 桌面打包（Tauri 优先，或 Electron） | `.exe` / `.dmg` | 3~5 天 |
| 5 | iOS（同一套 Capacitor，需 Mac + 证书；不上架只能 TestFlight/自签） | 评估后决定 | 另议 |

## 七、APK 分发（不上架）

1. **签名**：生成 keystore 并妥善保管，后续升级必须同一签名
2. **版本号**：`versionCode` 递增，`versionName` 与 CHANGELOG 对应
3. **分发渠道**：网盘/对象存储直链 + 微信群文件；页面放 SHA-256 校验值
4. **升级**：应用内「检查更新」请求一个静态 JSON（版本、下载地址、更新说明），比对后提示下载
5. **提醒**：Android 安装需允许「未知来源」；提示用户核对签名/哈希，防止被二次打包

## 八、合规风险

- **不内置 API Key**：所有请求由用户自己的 Key 发起（现状保持）
- **定位为本地工具**：数据存本机、不提供在线模型服务
- **生成式 AI 合规**：国内对「向公众提供生成式 AI 服务」有备案/安全评估要求；
  小范围自用/分享风险较低，但不要做成公开 SaaS 或大规模引流售卖
- **内容**：`safety_check` 保持开启；不内置同人/明星角色卡，不做卡市场
- **隐私**：本项目不需要位置权限、不采集聊天内容；如申请存储权限，仅用于导入导出

## 九、数据与迁移

- 现有数据在 IndexedDB（会话）与 localStorage（设置），Capacitor WebView 两者都支持
- 迁移到 SQLite 不是第一优先级；先用「导出备份 / 导入」保证换机不丢数据
- 附件（图片）内联在消息里，体积增长快，移动端要保留清理入口

## 十、风险清单

1. 第三方网关在移动端的 CORS/流式，必须靠原生桥或托管代理
2. iOS 无商店分发体验差（TestFlight/自签），建议延后
3. Capacitor WebView 与 Chrome 仍有差异（字体、长按菜单、安全区），需要真机测试
4. APK 被二次打包分发 → 用签名校验 + 哈希公示缓解
5. 打包后应用体积（现代前端 + 图标 + 支持码图片）约 10~20MB，可接受

## 十一、下一步（可执行）

- [x] 平台适配层初版（storage / fetch）
- [ ] 手机端适配检查：安全区、键盘遮挡、长按菜单、暗色主题
- [ ] Capacitor Android 脚手架 + 原生 SSE 插件
- [ ] APK 签名与「检查更新」静态清单
- [ ] Tauri 桌面打包评估