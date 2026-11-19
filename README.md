# 小肥鱼 · 同人写作助手

> 仓库：<https://github.com/1chuliu/xiaofeiyu> · 官网页：<https://1chuliu.github.io/xiaofeiyu/>

给写同人文的人用的本地客户端：**填自己的 API Key**，模型能力走 DeepSeek 开放平台，
不跟官方网页端抢算力、不受每日额度与高峰排队影响；界面是官方开源的 chat-demo 本地构建版。

> 为什么做它：最近官方端算力紧张、经常排队/限额，而写同人的人又要长时间、多轮次地反复续写和改稿。
> 用自己的 Key 按量付费，写多久都不被打断。

两套客户端，一个本地服务器：

| 客户端 | 地址 | 来源 | 特点 |
| --- | --- | --- | --- |
| **主界面** | <http://127.0.0.1:8787/> | DeepSeek 官方开源的 [chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）本地构建 | 联网搜索、深度思考、阅读链接、文件/图片上传、语音、自动标题、消息分支、ZIP 导入导出、Markdown + KaTeX + Mermaid、中英双语；**另加写作预设、会话置顶、侧栏搜索** |
| **轻量版** | <http://127.0.0.1:8787/lite/> | 本项目自研，零运行时依赖 | 单页实现：流式对话、思考过程、Markdown、本地历史、自定义系统提示词、示例对话；可直接部署到任意静态托管 |

两套都内置 **[DeepSeek 开放平台](https://platform.deepseek.com/) 入口**（主界面：欢迎页 + 设置；轻量版：侧栏、设置卡片、未配置提示、欢迎页）。

> 「小肥鱼」是本项目自己的名字与品牌；DeepSeek 是其权利人商标，本项目只用来说明「模型能力由 DeepSeek 开放平台 API 提供」。

---

## 快速开始（3 步）

### 1. 拿 API Key

打开 **<https://platform.deepseek.com/api_keys>** → 登录 / 注册 → **创建 API Key** → 复制 `sk-...`
同页可看余额；API 按 token 计费，新账号一般有免费额度。

### 2. 安装并构建（只需一次）

需要 Node.js 18+：

```bash
npm run setup        # = 安装 official/ 依赖 + 构建 official/dist
```

> 只想跑轻量版可以跳过：直接 `node server.mjs`，访问 `/lite/`。

### 3. 启动

```bash
node server.mjs                    # http://127.0.0.1:8787
node server.mjs --port 9000        # 换端口
node server.mjs --host 0.0.0.0     # 手机连同一 Wi-Fi 用
```

打开页面 → 设置 → 填 API Key → 开始写。

---

## 写作功能（本项目的差异化）

主界面「设置 → 写作设置」里：

| 功能 | 说明 |
| --- | --- |
| **写作预设** | 一键切换「同人续写 / 角色口吻 / 文风润色 / 大纲规划 / 自定义」，作为 system 提示词生效，不用自己写 prompt |
| 人设与世界观 | 写清角色名、性格、关系、禁写项，每次请求自动注入 system，减少 OOC |
| **角色卡（酒馆式）** | 设置 → 角色与记忆：**多套角色卡**（新建 / 切换 / 删除），每套含角色名 / 人设 / 说话方式 / 开场白 / **备选开场白** / 场景 / **自定义示例对话** / 长期记忆 / 附加指令；支持 **SillyTavern 角色卡 V1/V2 JSON 与内嵌 PNG 卡导入**、导出 V2 JSON，`{{char}}`/`{{user}}` 宏自动替换；新会话带开场白，可**换一条**再开聊；另有「我的人设」注入。参考清单见 [docs/tavern.md](docs/tavern.md) |
| **提示词块开关与排序** | 设置 → 提示词块：system 由 14 个块组成，可逐块开关、上下移动、恢复默认；**可存成命名模板**（写同人 / 酒馆 / 闲聊各一套）一键切换，还能**绑定到模型**（切模型自动套用）（身份 / 作品设定 / 用户 / 角色扮演 / 示例对话 / 场景 / 世界知识 / 长期记忆 / 自动记忆 / 群聊 / 预设 / 自定义 / 附加指令 / 模型指纹） |
| **自动记忆摘要** | 设置 → 角色与记忆：每 N 轮（2/4/6/8）自动把对话里的事实整理进「自动记忆」，与手写长期记忆分开、可手动修正；**记忆召回**默认开——**向量**（本地字符 n-gram 余弦）或**词面**模式，只注入相关的 2~8 行，无命中回退最后 3 行 |
| **上下文预算** | 设置 → 模型参数：8k / 16k / 32k / 64k / 128k（默认 32k）。超出时自动丢弃最旧的对话轮次，system、记忆和最近提问始终保留；单条超长消息会被截断，长会话不会超窗口或悄悄烧 token |
| **世界书（关键词触发）** | 设置 → 角色与记忆：每条写「触发词 + 设定」，只有最近对话出现触发词才注入（最多 6 条 / 2000 字）；支持**正则关键词**、**递归激活**、**轮次门槛**、**包含/排除词**、**块内靠前/靠后**；角色卡 V2 的 `character_book` 导入时自动并入 |
| **多角色群聊** | 再加 1~2 个角色同时在场，回复以「角色名：内容」由其中一位发言；**回合策略**自动 / 轮流 / 随机（计数器持久化）；`@角色名` 点名强制某人回应（不消耗轮询），「连续发言」允许同一角色继续接话，「多角色同轮」让两位角色各说一句，「单句长度」限制每句字数 |
| **关于 / 打赏 / 反馈** | 设置 → 关于：版本、协议与致谢；**支持作者**：赞赏码图片由**本机上传**（只存 localStorage，不进仓库）、可填爱发电链接；**反馈渠道**从 `local-config.json` 读取（已 gitignore） |
| **断线自动重连** | 参考 ZCode：**重连次数可配**（默认 5，ZCode 默认 10）、**空闲超时可配**（默认 120s，ZCode 默认 600s），指数退避 2s 起、封顶 30s；流中断 / 网关 5xx·429 / 空闲超时都会重连。Anthropic 协议用 assistant 预填**续写**已生成部分，OpenAI 协议从头重试；用户手动停止、400 参数错误不重连，重连时有 toast 提示 |
| **自定义聊天背景** | 通用设置 → 聊天背景：上传图片自动压缩存本地，只作用于对话区；深色主题自动压暗，可随时移除 |
| **多模型对比** | 模型参数里填多个模型（逗号分隔），同一问题**并发**请求，各自写一版；消息下方切换版本，尾部显示模型名（并发后非选中版本在后台完成，切换即可查看） |
| 自定义提示词 | 编辑即切换为「自定义」，可加个人文风要求；清空则不附加写作指令 |
| 会话置顶 | 会话项 `⋯` 菜单 → 置顶 / 取消置顶，置顶会话单独成组排最前 |
| 会话搜索 | 侧栏🔍图标展开搜索框，按标题过滤 |
| 导出 TXT / Markdown | 会话项 `⋯` → 导出；只导正文与我的输入，不导出思考过程与搜索卡片，文件名取会话标题 |
| 会话菜单 | `⋯` → 置顶 / 重命名 / 导出 TXT / 导出 Markdown / 删除 |

已定好的下一步（还没做）：

1. **章节管理与大纲面板**：按章组织正文，长篇连载用
2. **多版本对比 + 一键续写**：同段生成多版挑一个
3. 导出 Word / EPUB（TXT 与 Markdown 已可用）
4. **记忆自动摘要**（每 N 轮自动整理关键事实写入长期记忆，现在需手写）

### 角色卡的使用边界

我们只做功能，不预置任何 IP 角色卡、不做角色卡市场、不上传/分享：

- 角色卡与长期记忆只存本机 `localStorage`，不经过任何服务器
- 请使用**原创角色**；不要用真实人物或未成年人做角色（界面里有这句提醒）
- 角色扮演时系统提示词固定包含「不主动引入真实人物、未成年人或不适宜内容」；主界面 `safety_check` 常开，模型层也会拒答
- 软件本身不提供内容，使用者的产出由使用者负责；请不要把本工具用于传播违法内容或对外提供服务

### 模型参数（设置 → 模型参数）

| 参数 | 输入 | 说明 |
| --- | --- | --- |
| 思考强度 `reasoning_effort` | low / high / max | 仅开深度思考时生效，越高越晚给结论 |
| 输出上限 `max_tokens` | 数字，可留空 | 单步输出上限；留空用服务端默认 |
| 温度 `temperature` | 0–2，可留空 | 越低越稳定，越高越发散 |
| Top-P `top_p` | 0–1，可留空 | 核采样范围，一般和温度选一个调 |

**诚实说明**：官方接口在「思考模式 / 联网工具 / 安全审核 / title」任一开启时，采样参数由服务端接管，
请求里的温度与 Top-P 会被忽略。主界面为了对齐官方行为这几项常开，所以温度和 Top-P 多半不生效——
真正稳定生效的是**思考强度**与**输出上限**。轻量版（`/lite/`）不带安全审核与联网工具，
在非思考模式下温度 / Top-P 会真实生效。

---

## 当前 API 现状（对齐 2026 接口）

- 模型：`deepseek-flash`（DeepSeek-V4.1-Flash-1017）、`deepseek-v4-pro`（DeepSeek-V4-Pro-0813），上下文 1M
- 思考模式：`{"thinking": {"type": "enabled"/"disabled"}}` + `reasoning_effort`，默认开启
- 标题：`{"title": {"enabled": true}}`，回答结束时顺带生成，不计费
- 用户元信息：`{"role": "latest_reminder", "content": "2026-11-18,星期三,昆明,Web,中文"}`
- 联网：服务端工具 `deepseek_web_search` / `deepseek_read_url`
- 主界面走 Anthropic 兼容 `/anthropic/v1/messages`；轻量版走 OpenAI 兼容 `/chat/completions`

> 「DeepSeek 的默认提示词有哪些」整理在 **[docs/prompts.md](docs/prompts.md)**（含官方 demo 里那句
> `该助手为DeepSeek，由深度求索公司创造。` 的出处，以及历史泄露版本的可信度评估）。

---

## 接入第三方兼容端点

轻量版支持任意 OpenAI 兼容地址（自带「模型 ID（自定义）」输入）。第三方通常**不返回 CORS 头**，
浏览器直连会被拦，所以要经本地代理转发：

```bash
# Windows PowerShell：把第三方域名加进代理白名单后启动
$env:PROXY_ALLOWED_HOSTS="intern-ai.org.cn"; node server.mjs
# 或：node server.mjs --allow-host intern-ai.org.cn
```

然后在两套客户端里任选：

**轻量版 `/lite/`**（设置 → 对话）

| 项 | 填什么 |
| --- | --- |
| API Key | 第三方发的 key |
| API 地址 | 例如 `https://discovery-api.intern-ai.org.cn/v1`（**保留 /v1**） |
| 通过本地服务转发 | 勾选 |
| 模型 ID（自定义） | 例如 `deepseek-v4.1-flash-1017` |

**主界面 `/`**（设置 → 模型参数，内置 provider 适配）

| 项 | 填什么 |
| --- | --- |
| 接口地址 | 第三方完整地址：OpenAI 协议填含 `/v1` 的地址；Anthropic 协议填**不带 `/v1`** 的宿主（内部走 `{base}/v1/messages`）；留空则用官方地址 |
| 协议 | **OpenAI 兼容** 或 **Anthropic 兼容**（第三方服务两种都可能提供；官方地址请用 Anthropic） |
| 通过本地代理 | 勾选（第三方无 CORS 头时必须） |
| 模型 ID / 多模型对比 | 如 `deepseek-v4.1-flash-1017`，第二个框填 `qwen3.8-27b` 即可多模型对比 |

> 说明：OpenAI 协议下不支持官方专有的「联网工具 / 读取链接 / safety_check」参数（会自动忽略）；
> Anthropic 协议接第三方时会自动去掉 `safety_check`、把 `latest_reminder` 并进 system、清空服务端工具。
> 第三方网关普遍**没有 Files API**：**图片**会自动压缩成 base64 内联发送（Anthropic `base64` 源 / OpenAI `image_url`），
> 文档、PDF 等其他附件仍会提示不支持。自动标题在 OpenAI 协议下用额外一次小请求生成；想用官方专有能力请切回 Anthropic 协议 + 官方地址。

---

## 我们对官方客户端的改动（官方 demo 为 MIT，保留原 LICENSE）

`official/` 是官方 chat-demo 源码，补丁集中在这些地方：

1. **开放平台入口**：欢迎页一行链接 + 设置「数据管理」一栏，跳 `platform.deepseek.com`
2. **PWA**：`assets/manifest.webmanifest`、`assets/sw.js`、`assets/icons/*`，`rspack.config.ts` 里复制到 `dist`
3. **品牌与页面标题**：`小肥鱼 - 同人写作助手`，侧栏词标 `小肥鱼`，欢迎页圆胖鱼标记（暖橙 + 星光）与「你好呀，今天想写谁的故事？」；
   PWA 图标为暖橙圆角 + 奶油胖鱼，可用 `python scripts/make-icon.py` 重新生成
4. **写作能力**：`services/writing/presets.ts`（预设文案）、`settings.ts`（预设 / 自定义提示词 / 人设与世界观存储）、
   `store.ts`（`system` = 身份说明 + 作品设定 + 预设 + 自定义，逐次注入）、设置弹窗新增「写作设置」分组
5. **角色卡与群聊**：多套角色卡（人设 / 口吻 / 开场白 / 自定义示例对话 / 长期记忆）、新会话自动插入开场白、
   群聊在场名单（最多 2 个），见 `services/settings.ts` 与 `store.ts` 的 `resolveSystemPrompt`
6. **模型参数与多模型**：`reasoning_effort` / `max_tokens` / `temperature` / `top_p` / 自定义模型 ID；
   多模型并发请求同一问题，各自成为可切换的版本，消息尾部显示模型名
7. **Provider 适配**：`services/api/openai.ts` 把 OpenAI `/chat/completions` 的 SSE 翻译成内部事件流，
   支持运行时接口地址、协议切换与本地代理；OpenAI 协议下用额外小请求生成自动标题
8. **会话置顶 / 搜索 / 底栏**：`types.ts` 加 `pinnedAt`、`db.ts` 加 `setSessionPinned`、`sessionGroups.ts` 置顶分组、
   `SessionItem.tsx` 菜单项；侧栏另加搜索框与账号样式底栏
9. **导出 / 合并导入**：`services/chat/exportText.ts` 导出 TXT / Markdown；
   `db.commitStagingMerge` + `store.mergeHistory` 支持合并导入（同 id 去重）

构建脚本用根目录的 `scripts/build-official.mjs`（跨平台，绕开官方 `rm -rf dist`）。

---

## 目录结构

```
deepseek/                     ← 目录名保持 deepseek 仅为本地路径，产品名是「小肥鱼」
├── server.mjs                '/' 主界面，'/lite/' 轻量版，'/api/*' 转发代理
├── official/                 官方 chat-demo 源码 + 构建产物 dist/
├── public/                   轻量版（纯静态）
├── docs/prompts.md           默认提示词调研
├── docs/mobile.md            移动化 / 打包方案（Capacitor、APK 分发、适配层）
├── scripts/                  构建、图标、冒烟、样式/引用检查
└── tests/                    Node 24 项 + jsdom 14 项 + mock 流式接口
```

---

## 手机 / 平板

1. 电脑 `node server.mjs --host 0.0.0.0`
2. `ipconfig` 查内网 IP，如 `192.168.1.23`
3. 手机连同一 Wi-Fi 访问 `http://192.168.1.23:8787`
4. 浏览器菜单「添加到主屏幕」

> PWA 安装需要 HTTPS 或 localhost；局域网 http 下能正常写，只是离线缓存不生效。

---

## 隐私与数据

- **API Key**：只存浏览器 `localStorage`；本地代理只透传，不落盘、不打印
- **会话**：主界面存 IndexedDB；轻量版存 localStorage；都不上传第三方
- 主界面可导入 DeepSeek 导出的历史 ZIP：可选择**合并导入**（保留现有对话，只追加备份里新增的会话，重复导入不会重复）或**覆盖导入**（替换全部本地对话）；导入前建议先导出备份
- `--host 0.0.0.0` 时同网络都能打开页面，但各填各的 Key

---

## 测试

```bash
npm install              # 只装测试用 jsdom
npm test                 # Node 24 项 + jsdom 14 项
node scripts/smoke.mjs   # 对运行中的服务做冒烟检查
npm run check            # CSS class / DOM 引用一致性
```

真实网关暴力测试（需要你自己的 API Key，不写入仓库）：

```powershell
$env:BASE_URL='https://你的网关/v1'
$env:API_KEY='sk-...'
node scripts/bruteforce.mjs   # 流式/身份/预设/世界书/群聊/记忆/参数/并发，共 20 项
```

最近一次结果：**20/20 通过**，详见 [docs/stress-report.md](docs/stress-report.md)。

## 本机私有配置（不进仓库）

联系方式与赞赏码属于作者个人数据，**不写进代码或仓库**：

```powershell
copy local-config.example.json local-config.json   # 填 QQ / 微信 / 邮箱 / 爱发电链接
```

`local-config.json` 已被 `.gitignore` 忽略；赞赏码在「设置 → 关于」上传，只存浏览器本地。
公开仓库/官网页里不会出现你的联系方式与收款码。

## 手机 / 打包

不上架商店也能装到手机：先看 **[docs/mobile.md](docs/mobile.md)**（Capacitor 套壳、原生 SSE 桥、APK 分发与签名、合规风险）。
平台适配层已落在 `official/src/platform/`（`storage` / `fetch`），Web 实现不变，后续按平台替换即可。

---

## 常见问题

**Q：401 / Key 无效？** 到 <https://platform.deepseek.com/api_keys> 重新创建，注意别带空格。

**Q：402 余额不足？** API 按 token 计费（网页端免费 ≠ API 免费），平台「用量信息」查看余额。

**Q：429？** API 有速率/并发限制，稍等再试。

**Q：主界面请求失败 / 跨域？** 默认直连官方 API；若网络拦截，改用 `/lite/` 并勾选「通过本地服务转发」。

**Q：写同人涉及版权角色，会有内容审核吗？** 主界面默认开启 `safety_check`（服务端风控）；触线会拒答，属正常。请自行确保创作与发布合规。

---

## 免责声明

- 「小肥鱼」是非官方个人项目，与杭州深度求索人工智能基础技术研究有限公司无隶属关系
- `official/` 代码版权归 DeepSeek（MIT，保留其 LICENSE）；DeepSeek 名称与模型归其所有
- 仅供个人创作自用，不要对外提供"官方服务"或冒充官方产品

## License

**Apache License 2.0**（详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)）。

`official/` 目录是 DeepSeek 官方 chat-demo 源码，仍然沿用其 **MIT** 许可（`official/LICENSE`）；
其余代码为小肥鱼原创，按 Apache-2.0 授权。分发时请保留 `LICENSE`、`NOTICE` 与 `official/LICENSE`。