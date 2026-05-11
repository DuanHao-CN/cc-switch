# KeyFerry 登录配置体验 PRD

## 1. 背景

cc-switch 的核心价值是帮助用户在 Claude Code、Codex CLI、Gemini CLI、OpenCode、OpenClaw 等客户端之间管理、切换、测试和维护 AI provider 配置。对普通用户来说，现有 provider 配置能力足够强，但首次配置 NewAPI 网关、复制 token、填写各客户端不同配置文件、处理模型和 base URL 细节，门槛偏高。

KeyFerry 要解决的问题不是重新发明 cc-switch，而是把最容易出错的 provider 初始化流程收敛成一次登录：用户使用 KeyFerry 账号登录后，应用自动获取 NewAPI token，并把所选客户端配置好。登录完成后，用户仍然应该获得完整、稳定、可理解的 cc-switch 使用体验。

## 2. 产品目标

### 核心目标

用户通过 KeyFerry 登录后，无需理解 NewAPI token、base URL、不同客户端配置格式，也能在 1 分钟内获得可用的 cc-switch 配置。

### 体验目标

- 登录前：用户看到清晰的 KeyFerry 登录入口，知道登录会为哪些客户端写入配置。
- 登录中：系统自动处理 NewAPI 登录、两步验证、token 复用或创建、客户端配置写入。
- 登录后：用户看到账号状态、已接管客户端、配置时间、注销和重新配置入口。
- 日常使用：用户可以像正常使用 cc-switch 一样切换 provider、测试连接、查看用量、编辑 KeyFerry 管理的 provider 细节。
- 出问题时：错误信息能指导用户下一步操作，而不是暴露底层实现细节。

### 业务目标

- 降低 KeyFerry 用户首次配置失败率。
- 降低因 token、base URL、配置路径错误导致的支持成本。
- 保持上游 cc-switch 的成熟能力，避免商业化 fork 变成“阉割版 cc-switch”。
- 保持后续上游更新可 replay，KeyFerry 自定义逻辑应集中、清晰、可回滚。

## 3. 用户画像

### 主要用户

已经拥有 KeyFerry 账号，希望快速把多个 AI 编程客户端接入统一网关的开发者。

他们关心：

- 登录后马上能用。
- 不想手动复制 token。
- 不想理解每个客户端的配置格式差异。
- 仍然希望保留 cc-switch 的 provider 切换、测试、编辑、用量和会话管理能力。

### 次要用户

需要维护 KeyFerry 商业版的开发者或支持人员。

他们关心：

- 能快速判断 KeyFerry 和上游 cc-switch 的差异。
- 能定位登录、配置写入、provider lock、数据库兼容问题。
- 能安全地跟进上游更新。

## 4. 产品原则

1. KeyFerry 只接管“复杂配置入口”，不破坏 cc-switch 的成熟体验。
2. 用户不需要理解 token 细节，但可以理解当前账号和接管范围。
3. 后端防绕过比前端隐藏更重要。
4. 前端隐藏只隐藏会造成错误心智或破坏 KeyFerry 边界的入口。
5. 不移除与 provider 创建无关的 cc-switch 能力。
6. 保留官方 fallback，避免 KeyFerry 故障时用户完全不可用。
7. KeyFerry 定制应集中在登录、provider 写入、provider mutation guard 这些边界点。
8. 任何会影响上游 replay 的改动都必须有明确产品理由。

## 5. 范围

### V1 必须包含

- KeyFerry 登录页。
- NewAPI 账号密码登录。
- 两步验证支持。
- 固定网关 `https://x.sozdata.com`。
- 自动搜索并复用名为 `cc-switch` 的 token。
- 不存在同名 token 时自动创建。
- 获取 token key 后自动创建或更新 KeyFerry 统一 provider。
- 登录时选择接管客户端，范围包括 Claude、Codex、Gemini、OpenCode、OpenClaw。
- 至少选择一个客户端。
- 登录完成后展示账号状态，而不是继续展示登录表单。
- 重新配置入口。
- 注销入口。
- Claude、Codex、Gemini 保留 `default` 官方 fallback provider。
- KeyFerry 管理的 provider 可编辑、可测试、可配置用量。
- 后端阻断绕过 KeyFerry 的 provider 创建和导入路径。

### V1 应保留的 cc-switch 能力

- Provider 切换。
- Provider 测试。
- KeyFerry provider 编辑。
- 用量脚本配置。
- 会话管理。
- MCP 管理。
- Prompts 管理。
- Skills 管理。
- Proxy 和故障转移相关能力，只要不直接创建非 KeyFerry provider。
- 设置页中的非 provider 破坏性能力，例如显示设置、路径设置、测试工具、备份列表、云同步配置。

### V1 非目标

- 不把整个应用改造成只有一个登录页的壳。
- 不隐藏所有高级功能。
- 不重写 cc-switch 的 provider 系统。
- 不改变 NewAPI 网关以外的品牌命名。产品名是 KeyFerry，`x.sozdata.com` 只是固定网关。
- 不提交真实账号、密码、cookie、token key。
- 不在登录 PR 中混入无关数据库迁移、Hermes、Skills、模型定价等改动，除非它们是运行当前用户数据库的必要兼容补丁，并且单独说明。

## 6. 用户旅程

### 首次启动，未配置

1. 用户打开应用。
2. 应用检测 KeyFerry 尚未配置。
3. 首屏显示 KeyFerry 登录模块。
4. 用户输入账号和密码。
5. 用户选择要接管的客户端，默认建议全选。
6. 如果账号需要两步验证，登录模块要求输入验证码。
7. 系统获取或创建 token，并写入所选客户端配置。
8. 系统进入 provider 列表页。
9. 用户看到 KeyFerry provider 和必要 fallback provider。

### 已配置后的日常使用

1. 用户打开应用。
2. 应用直接进入 cc-switch 主体验。
3. 顶部提供 KeyFerry 入口。
4. 用户可进入 KeyFerry 面板查看账号、token 名称、配置时间和接管范围。
5. 用户可在 Claude、Codex、Gemini 的 KeyFerry provider 与官方 fallback 之间切换。
6. 用户可编辑 KeyFerry provider 的模型、测速、用量等配置。

### 重新配置

1. 用户进入 KeyFerry 面板。
2. 点击重新配置。
3. 用户可修改账号、密码、两步验证码和接管客户端范围。
4. 系统更新 KeyFerry provider 和所选客户端配置。
5. 未选择的 Claude、Codex、Gemini 切回官方 fallback。
6. 未选择的 OpenCode、OpenClaw 移除 KeyFerry live config。

### 注销

1. 用户进入 KeyFerry 面板。
2. 点击注销。
3. 系统删除 KeyFerry 管理的统一 provider 和派生 provider。
4. Claude、Codex、Gemini 切回官方 fallback。
5. 应用回到 KeyFerry 登录状态。

## 7. 功能需求

### 7.1 KeyFerry 登录模块

- 登录模块应显示产品名“钥渡 KeyFerry”。
- 登录模块应显示固定 NewAPI gateway。
- 登录模块应提供账号、密码、显示密码按钮。
- 登录模块应支持两步验证码。
- 登录模块应提供客户端选择开关。
- 客户端选择至少包含 Claude、Codex、Gemini、OpenCode、OpenClaw。
- 登录按钮在账号、密码、接管范围不完整时不可提交。
- 窄屏时账号登录表单必须出现在首屏，客户端选择可以下移。

### 7.2 登录和 token 管理

- 系统调用 NewAPI 登录接口。
- 如果需要 2FA，系统进入等待验证码状态，不应丢失账号和已选客户端范围。
- 系统应从登录响应中提取用户 ID。
- token 管理请求必须携带 NewAPI 用户 ID 头。
- 系统优先复用精确同名 token `cc-switch`。
- 如果存在多个同名 token，优先使用 ID 最新的 token。
- 如果不存在同名 token，系统创建不限额度 token。
- 系统不得在日志、toast、文档中输出 token key。

### 7.3 自动配置

- 系统创建或更新固定 ID 的 KeyFerry 统一 provider。
- provider 名称使用“钥渡 KeyFerry”。
- provider base URL 使用 `https://x.sozdata.com`。
- provider meta 记录账号、用户 ID、token ID、token 名、配置时间。
- Claude、Codex、Gemini 生成普通 provider 配置。
- OpenCode、OpenClaw 生成累加模式 provider，并写入 live config。
- 未选中的客户端不写入 KeyFerry 配置。
- Claude、Codex、Gemini 未被 KeyFerry 接管时，保留并切换到官方 fallback。

### 7.4 Provider 边界

- 用户不能通过普通新增 provider 创建非 KeyFerry provider。
- 用户不能复制 provider 来绕过 KeyFerry 登录。
- 用户不能删除 KeyFerry provider，注销必须走 KeyFerry 面板。
- 用户不能通过 deep link 导入 provider。
- 用户不能通过 SQL import 或数据库 restore 覆盖 provider 边界。
- 用户可以编辑 KeyFerry 管理的 provider，但不能改 provider ID，也不能把它改成非 KeyFerry provider。
- 用户可以切换到 Claude、Codex、Gemini 的官方 fallback。

### 7.5 应保留的设置和工具

- 设置页不应因为 KeyFerry-only 模式整体隐藏高级功能。
- SQL import 和数据库 restore 可以被禁用或隐藏。
- SQL export、手动备份、自动备份设置是否保留，应按数据安全原则单独判断，不能简单和 import 绑定。
- WebDAV 云同步配置不应被无差别隐藏，除非它会覆盖 provider 边界。
- MCP、Prompt、Skills、Session、Workspace 等非 provider 创建能力应保持可用。

## 8. 信息架构

### 顶部导航

- 保留应用切换。
- 保留当前视图标题。
- 提供 KeyFerry 入口按钮。
- KeyFerry-only 模式下可以隐藏普通新增 provider 按钮。

### KeyFerry 面板

未配置状态：

- 标题区。
- 登录表单。
- 客户端选择。
- 当前配置状态提示。

已配置状态：

- 账号信息。
- token 名称。
- 最近配置时间。
- 接管客户端列表。
- 重新配置按钮。
- 注销按钮。
- fallback 说明。

## 9. 错误与空状态

- 账号或密码为空：提示用户补齐。
- 未选择任何客户端：提示至少启用一个客户端。
- 登录失败：展示 NewAPI 返回的可理解错误。
- 需要 2FA：切换到验证码输入状态。
- token 创建失败：提示 token 管理失败，不展示 token key。
- 配置写入失败：提示具体失败客户端和建议操作。
- 数据库版本过新：明确提示当前应用版本不支持，不自动修改数据库。

## 10. 成功指标

- 首次登录到 provider 可用的中位时间小于 60 秒。
- 登录后用户无需手动复制 token。
- 登录后至少一个所选客户端 provider 可测试成功。
- KeyFerry 登录相关支持问题占比下降。
- 因隐藏原 cc-switch 功能导致的用户反馈为零或显著低于 provider 配置问题。
- 后续上游升级中，KeyFerry 相关冲突集中在少数明确文件。

## 11. 验收标准

### 核心流程

- 未配置时启动应用，首屏出现 KeyFerry 登录模块。
- 输入正确账号密码后能配置成功。
- 需要 2FA 的账号能完成两步验证。
- 登录后进入 provider 列表。
- KeyFerry 面板展示账号状态，而不是登录表单。
- 重新配置可改变接管客户端范围。
- 注销后回到未配置状态。

### Provider 行为

- Claude、Codex、Gemini 登录后显示 KeyFerry provider 和 `default` fallback。
- OpenCode、OpenClaw 只有在登录时选中后才显示。
- 未选中的 OpenCode、OpenClaw 不写入 KeyFerry live config。
- 普通新增、复制、删除、provider import、DB restore 不能绕过 KeyFerry。
- KeyFerry provider 可编辑、可测试、可配置用量。

### 体验保护

- 窄屏下登录表单不会被客户端选择挤到第二屏。
- 设置页中与 provider 创建无关的功能不被无差别隐藏。
- 现有 session、MCP、Prompt、Skills 等入口不因 KeyFerry 登录消失。
- 不出现真实 token key。

## 12. 实现边界建议

### 建议分层

1. `keyferry-login-core`
   - 新增 KeyFerry 登录命令、API wrapper、登录面板、账号状态展示。

2. `keyferry-provider-sync`
   - KeyFerry 统一 provider 创建和同步。
   - OpenCode、OpenClaw 派生 provider 和 live config 写入。
   - 官方 fallback provider 保障。

3. `keyferry-provider-lock`
   - 后端阻断新增、删除、复制、provider import、DB restore。
   - 前端隐藏或禁用相关入口。
   - 不影响非 provider 创建能力。

4. `db-compat`
   - 只在必要时单独处理 schema version 和迁移。
   - 不与登录功能混合提交。

### 推荐保留的代码边界

- KeyFerry 常量集中：`KEYFERRY_ONLY_MODE`、`KEYFERRY_GATEWAY_URL`、`KEYFERRY_PROVIDER_ID`。
- KeyFerry 登录逻辑集中在独立命令模块。
- Provider mutation guard 放在命令层优先。
- 深服务层只增加确实需要的 provider 转换能力，不散落产品判断。
- 前端 UI 用 props 控制入口，不直接删除上游组件能力。

## 13. 风险

### 产品风险

- 过度隐藏会让用户觉得 KeyFerry 版本不如 cc-switch。
- 完全禁止 fallback 会让网关故障时用户无法工作。
- 将设置、备份、云同步等功能误判为 provider 配置风险，会降低信任感。

### 技术风险

- KeyFerry-only 常量在前后端重复，未来可能出现状态不一致。
- 数据库迁移混入登录 PR 会扩大回归面。
- 修改上游深层服务会增加后续 replay 成本。
- OpenCode、OpenClaw 累加模式与普通 current provider 心智不同，需要明确 UI 文案。

## 14. 未来版本

### V1.1

- KeyFerry 登录状态健康检查。
- 每个客户端配置结果的详细状态。
- 重新配置时展示当前 live config 是否已同步。
- 更细粒度的错误恢复指引。

### V2

- 支持组织级策略，例如默认接管范围、允许 fallback 范围。
- 支持账号切换。
- 支持只读诊断报告，方便客服排查配置问题。
- KeyFerry-only 模式从硬编码常量迁移到受控产品配置。
