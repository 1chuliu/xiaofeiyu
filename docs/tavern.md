# 酒馆（SillyTavern 系）参考与落地清单

我们按 GitHub 上 SillyTavern 生态的公开规范做了取舍，只抄「体验关键」的部分。

## 参考来源

| 来源 | 用来干什么 |
| --- | --- |
| [SillyTavern](https://github.com/SillyTavern/SillyTavern) | 角色卡 / 世界书 / 群聊 / 提示词管理器的整体交互 |
| [Character Card V2 规范](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md) | 字段定义（V1 + V2）与 `{{char}}` / `{{user}}` 宏 |
| [World Info 文档](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) | 关键词触发、递归激活、插入顺序 |
| [Prompt Manager 文档](https://docs.sillytavern.app/usage/prompts/prompt-manager/) | 提示词拼装顺序、可开关的块 |
| [Data Fields 说明](https://github.com/bradennapier/character-cards-v2) | `alternate_greetings` 等字段的用法 |

## 已经落地

- **角色卡 V1 / V2 JSON 导入导出**：`services/writing/cardV2.ts`
  - `description + personality` → 人设；`scenario` → 场景；`first_mes` → 开场白；
    `alternate_greetings` → 备选开场白；`mes_example` → 示例对话；
    `system_prompt + post_history_instructions` → 附加指令（`{{original}}` 置空）
  - 导出为 `chara_card_v2` 2.0，可再导回 SillyTavern
- **多套角色卡**：新建 / 切换 / 删除，每套独立记忆
- **备选开场白 + 换一条**：新会话从「主开场白 + 备选」开始，输入区上方有「换一条开场白」按钮循环切换（发送消息后锁定）
- **PNG 内嵌角色卡**：读取 PNG 的 `tEXt` 块（关键字 `chara` / `ccv3`，base64 JSON），导入对话框同时接受 `.json` 与 `.png`
- **自动记忆摘要**：每 N 轮（2/4/6/8 可选）用一次小请求把最近对话里的事实整理进角色卡的「自动记忆」；
  与手写长期记忆分开存储，注入时排在后面、冲突以手写为准；失败静默，不影响对话（`services/chat/memory.ts`）
- **提示词块开关与排序**：system 拆成 14 个块（身份 / 作品设定 / 用户 / 角色扮演 / 示例对话 / 场景 / 世界知识 / 长期记忆 / 自动记忆 / 群聊 / 预设 / 自定义 / 附加指令 / 模型指纹），
  在「设置 → 提示词块」里逐块开关、上下移动、一键恢复默认；对照 ST 的 Prompt Manager（`services/chat/promptBlocks.ts`）
- **群聊回合策略**：自动（模型决定）/ 轮流（按在场顺序，计数器持久化）/ 随机；轮流与随机会在提示词里指定「本轮只由 X 发言」
- **记忆召回**：自动记忆按行拆分，两种模式可切换：
  - **向量（默认）**：字符 unigram + bigram + 英文词组成稀疏向量，按余弦相似度取最相关 2~8 行（阈值 0.08，纯本地，不依赖 embedding 接口）
  - **词面**：英文词 +2、中文二字窗 +1 的命中打分
  - 一条都没命中时回退最后 3 行；可整体关闭（`services/chat/memoryRecall.ts`）
- **提示词块模板**：把当前块的顺序与开关存成命名模板，按场景一键切换；模板深拷贝、旧模板缺少的新块应用时自动补齐；
  可**绑定到模型**——切到该模型时自动套用对应模板
- **群聊高级**：`@角色名`（支持全角 `＠`）点名强制本轮由该角色回应，不消耗轮询计数；「连续发言」允许同一角色继续接话、不强制换人；
  「多角色同轮」一轮里让两位角色各说一句（轮流取相邻两位 / 随机取不重复两位）；「单句长度」限制每位角色每句字数（0 = 不限）
- **用户人设**：我的名字（替换 `{{user}}` / `<USER>`）与「我的人设」块，一并注入
- **场景块**、**附加指令块**（放在提示词最后，对应 ST 的 post-history 位置）
- **群聊**：最多 2 个在场角色，回复格式 `角色名：内容`
- 宏替换对白：人设、口吻、示例、开场白、场景、附加指令都会过一遍 `{{char}}/{{user}}`

- **世界书（World Info）**：`services/writing/worldbook.ts`
  - 条目 = 触发词 + 内容；只有最近一轮用户消息命中触发词才注入
  - **正则关键词**：条目可切「正则」，大小写不敏感；正则写错自动退回子串匹配
  - **递归激活**：条目可切「递归」，其内容可作为下一层匹配文本（最多 2 层，可用 `maxDepth` 关闭）
  - **轮次门槛**：`minRound` 设定对话到第几轮才允许触发
  - **包含/排除过滤**：`onlyIf` 需命中其中任一词、`notIf` 命中任一则跳过
  - **块内位置**：`head` 排在世界知识块靠前、`tail` 靠后，各位置内按 `order`
  - 按 `order` 排序，最多 6 条 / 2000 字；禁用条目跳过
  - 角色卡 V2 的 `character_book.entries` 导入时自动并入（保留 `insertion_order`）
  - 未实现：按深度延迟、分组包含/排除、精确插入到 prompt 的某一段落

## 拼装顺序（对应 SillyTavern 的 prompt 顺序，简化版）

```text
身份说明 → 作品设定 → 用户设定 → 角色扮演(人设/口吻/示例) → 场景 → 长期记忆 → 群聊名单 → 写作预设 → 自定义 → 附加指令
```

## 还没做（下一步候选）

1. **真 embedding 召回**：现在是本地稀疏向量，接第三方 embedding 接口效果更好
2. **世界书深度延迟**：现在按轮次门槛，ST 还有「前 N 轮不激活、之后才开放」的变体
3. **模板绑定按 extra 模型**：目前只跟随主模型 id，多模型对比时不切换
4. **群聊字数统计**：长度规则只在提示词约束，没有硬性截断
5. **多开场白滑动动画 / 语音朗读开场白**（细节体验）

## 提醒

角色卡内容由使用者提供；我们只做功能，不内置任何 IP 角色卡，也不提供卡市场。请使用原创角色。