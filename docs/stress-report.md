# 暴力测试报告（真实网关）

- 时间：2026-11-19（Asia/Shanghai）
- 网关：`https://discovery-api.intern-ai.org.cn`（Intern InkStone / 书生·瑞砚）
- 平台限额：**RPM 50 次/分钟（生成模型）**、200 次/分钟（决策模型）；**TPM 2.00M Token/分钟**
- 协议地址：OpenAI → `https://discovery-api.intern-ai.org.cn/v1`；Anthropic → `https://discovery-api.intern-ai.org.cn`（实际端点 `/v1/messages`）
- 模型：`deepseek-v4.1-flash-1017`、`qwen3.8-27b`
- 结果：**20/20 通过**（24 路并发 · p50 626ms · p95 766ms）
- 脚本：`scripts/bruteforce.mjs`；Anthropic 专项：`scripts/test-anthropic-gateway.mjs`

## 明细（最近一次）

| # | 测试项 | 耗时 | 结果摘要 |
| --- | --- | --- | --- |
| 1 | 流式输出（deepseek） | 688ms | 29 chunks · TTFT 444ms |
| 2 | 非流式输出（qwen） | 693ms | 54 字 |
| 3 | 思考开 vs 关 | 1024ms | 关 2 tok / 开 36 tok，含思维链 |
| 4 | 错误处理（不存在模型） | 56ms | 正确返回 HTTP 404 |
| 5 | 普通对话身份不崩 | 780ms | 自称 DeepSeek 助手 |
| 6 | 写作身份输出角色台词 | 461ms | 括号动作 + 第一人称 |
| 7 | 续写模式 | 1291ms | 144 字，衔接上下文 |
| 8 | 润色模式 | 335ms | 保留原意、语句更顺 |
| 9 | 世界书命中引用设定 | 481ms | 「十年前，救一个落水的孩子」 |
| 10 | 无关键词不硬塞设定 | 397ms | 回复「随便。」 |
| 11 | 群聊单人指令 | 720ms | 只由「林晚」发言 |
| 12 | 群聊双人同轮 | 650ms | 沈舟、林晚各一句 |
| 13 | 记忆摘要保留事实 | 1907ms | 47 字，含旧疤/伞柄刻字 |
| 14 | 记忆召回（本地向量） | 1ms | 命中「旧伞」行，score 0.24 |
| 15 | max_tokens 截断 | 423ms | 24 tok / 41 字 |
| 16 | temperature 0 / 1.5 | 702ms | 均不报错 |
| 17 | 长输出吞吐 | 2954ms | 440 字，约 **149 字/秒** |
| 18 | 自动标题（两段） | 1509ms | 「雨夜重逢克制暗恋」「雨天初遇编辑与建筑师」 |
| 19 | 多模型并发对比 | 499ms | 两个模型均返回 |
| 20 | 24 路并发 | 773ms | 24/24 · p50 626ms · p95 766ms |

## 本轮发现并修复

1. **429 的来源是 RPM，不是 TPM**：截图显示 RPM 50/分钟，之前「32 路 + 紧接第二波 32 路」共 64 次/分钟直接超限。
   - 测试脚本改为「19 个串行 + 24 路并发 = 43 次/分钟」，稳定在配额内；
   - 客户端此前已加 **429/502/503/504 自动退避重试**（2s、6s）。
2. **Anthropic 协议自定义地址此前没生效**：客户端硬编码 `api.deepseek.com/anthropic/v1`，而网关的 Anthropic 端点是 `{base}/v1/messages`。
   - 已改为：有自定义地址时走 `{base}/v1`；官方地址仍走 `/anthropic/v1`；
   - `verifyApiKey` 在 Anthropic 自定义地址下改用 `{base}/v1/models`（实测 200）。
3. **第三方网关没有 Files API**（`/v1/files` 实测 404）。
   - 现在**图片改为内联 base64**：客户端压缩到最长边 1280 的 JPEG，
     Anthropic 协议发 `base64` 图片源、OpenAI 协议发 `image_url`；
   - 实测两张协议均被网关接受（1×1 红图分别回答「浅红色 / 粉红色」）；
   - 文档、PDF 等非图片附件仍不支持，会提示「当前接口地址不支持附件上传」。
4. **第三方请求体清洗**：自定义 Anthropic 地址下自动去掉官方专有的 `safety_check`、把 `latest_reminder` 并入 `system`、清空服务端工具，避免网关以未知字段拒绝。

## 复现

```powershell
$env:BASE_URL='https://discovery-api.intern-ai.org.cn/v1'
$env:API_KEY='sk-...'   # 自己的 key，不要提交
$env:DELAY_MS='700'     # 每项之间节流，避免 RPM 限流
node scripts/bruteforce.mjs

# Anthropic 协议专项
$env:BASE_URL='https://discovery-api.intern-ai.org.cn'   # 注意：不带 /v1
node scripts/test-anthropic-gateway.mjs
```

## 已知限制

- 第三方网关 RPM/TPM 低于官方 API：多模型并发 + 长文生成要错开时间。
- 第三方地址支持**图片**内联（≤12MB 原图，自动压缩），文档 / PDF 等附件不支持。
- 「双人同轮」是提示词软约束，个别模型仍可能只回一位。
- 自动标题失败会静默跳过，不阻塞对话。