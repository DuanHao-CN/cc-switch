# 钥渡 KeyFerry 持续开发说明

本文档记录 KeyFerry 登录器改造的产品边界、NewAPI 对接流程、代码入口和后续维护注意事项。目标是让后续继续跟进上游 `cc-switch` 更新时，能快速判断哪些改动属于商业化封装，哪些改动应尽量保持上游兼容。

## 产品定位

钥渡 KeyFerry 是基于 `cc-switch` 的 Token 中转站登录器。应用只面向钥渡用户开放，用户登录后自动完成统一供应商配置，不再暴露供应商自定义能力。

核心约束：

- 产品名使用 `钥渡 KeyFerry`，不要使用 `sozdata` 作为产品名。
- NewAPI 网关固定为 `https://x.sozdata.com`。
- KeyFerry 登录是唯一创建供应商的方式。
- 用户可以在登录或重新配置时选择 KeyFerry 要接管 Claude、Codex、Gemini、OpenCode、OpenClaw 中的哪些应用，但至少要启用一个应用。
- 用户可以编辑、测试 KeyFerry 自动生成的供应商，用于调整模型、测速和用量配置。
- 登录完成后 KeyFerry 入口必须展示账号状态、注销和重新配置操作，不能继续直接显示登录表单。
- Claude、Codex、Gemini 必须保留 `default` 官方渠道，作为可切换的回退通道。
- OpenCode、OpenClaw 使用累加配置模式，没有统一的 `current provider` 概念；KeyFerry 接入时写入对应 live config，未接入时不写入 KeyFerry 配置。
- 禁止用户新增、删除、导入、恢复或创建 KeyFerry 之外的供应商。
- 禁止通过 deep link、SQL import、数据库恢复绕过供应商配置锁。
- OpenCode / OpenClaw 在 KeyFerry-only 模式下按用户选择显示，未被 KeyFerry 接管时隐藏，避免展示空配置面。
- 不要把测试账号、密码、Token Key 写入代码或文档。

## NewAPI 对接流程

参考文档：

- `https://docs.newapi.pro/zh/docs/api/management/auth`
- `https://docs.newapi.pro/zh/docs/api/management/user-auth/user-login-post`
- `https://docs.newapi.pro/zh/docs/api/management/user-auth/user-login-2fa-post`
- `https://docs.newapi.pro/zh/docs/api/management/token-management/token-search-get`
- `https://docs.newapi.pro/zh/docs/api/management/token-management/token-post`

登录配置链路：

1. 使用用户名密码调用 `/api/user/login`。
2. 如果返回需要两步验证，则继续调用 `/api/user/login/2fa`。
3. 从登录响应中提取用户 ID，兼容字段包括 `data.id`、`data.user_id`、`data.userId`、`data.user.id`。
4. 后续 Token 管理接口必须带请求头 `New-Api-User: {user_id}`，否则会出现 `NewAPI HTTP 401: 无权进行此操作，未提供 New-Api-User`。
5. 搜索同名 Token，默认名称为 `cc-switch`。
6. 如果存在同名 Token，优先复用 ID 最大的精确同名 Token。
7. 如果不存在同名 Token，则创建一个不限额度 Token。
8. 调用 Token Key 接口获取 key。
9. 使用该 key 自动创建或更新统一供应商 `keyferry-newapi`。
10. 同步统一供应商到 Claude、Codex、Gemini、OpenCode、OpenClaw；Claude/Codex/Gemini 会切换为当前供应商，OpenCode/OpenClaw 会写入 live config。

注意：不要在日志、toast、文档中打印实际 Token Key。

## 关键代码入口

后端 KeyFerry 命令：

- `src-tauri/src/commands/keyferry.rs`
- `keyferry_status`
- `keyferry_login_configure`

后端命令注册：

- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/lib.rs`

后端供应商锁：

- `src-tauri/src/commands/provider.rs`
- `src-tauri/src/commands/deeplink.rs`
- `src-tauri/src/commands/import_export.rs`
- `src-tauri/src/tray.rs`

前端 API：

- `src/lib/api/keyferry.ts`
- `src/lib/api/index.ts`

前端 UI：

- `src/components/keyferry/KeyFerryLoginPanel.tsx`
- `src/App.tsx`
- `src/components/providers/ProviderList.tsx`
- `src/components/providers/ProviderCard.tsx`
- `src/components/settings/SettingsPage.tsx`

测试桩：

- `tests/msw/handlers.ts`
- `tests/integration/App.test.tsx`

## KeyFerry-only 锁定点

当前锁定常量在后端和前端分别存在，后续如果产品要切换成可配置开关，应优先抽成单一配置源。

后端：

- `KEYFERRY_ONLY_MODE = true`
- `KEYFERRY_GATEWAY_URL = "https://x.sozdata.com"`
- `KEYFERRY_PROVIDER_ID = "keyferry-newapi"`
- `keyferry_child_provider_id(AppType)` 返回 Claude、Codex、Gemini、OpenCode、OpenClaw 的统一供应商派生 ID。

前端：

- `KEYFERRY_ONLY_MODE = true`
- KeyFerry-only 模式始终显示 Claude、Codex、Gemini，并在 `keyferry_status.configuredApps` 包含 OpenCode/OpenClaw 时显示对应应用。
- 未配置时显示 KeyFerry 登录页。
- 未配置或重新配置时，配置范围支持用户选择 Claude、Codex、Gemini、OpenCode、OpenClaw；Claude/Codex/Gemini 未选择时只保留官方 `default` 渠道，OpenCode/OpenClaw 未选择时不写入 KeyFerry live config。
- 已配置后 KeyFerry 入口显示账户中心，而不是登录表单。
- 已配置后保留 KeyFerry 供应商的编辑、测试、用量配置和 Claude 终端入口。
- 已配置后 provider 列表保留 KeyFerry 供应商和官方 `default` 渠道，允许用户在 KeyFerry 与官方渠道之间切换。
- 已配置后隐藏新增、复制、删除、排序、导入导出、备份恢复和统一供应商编辑入口。
- 设置页不要因为 KeyFerry-only 就整块隐藏高级功能；应拆分锁定粒度，只禁用 SQL import、数据库 restore 和 WebDAV 下载恢复，保留导出、手动备份、自动备份设置、WebDAV 配置与上传。

后端防绕过比前端隐藏更重要。KeyFerry-only 模式允许用户更新、测试和切换 KeyFerry 派生 provider 与官方 `default` provider；新增任何能新增、删除、重命名、导入、恢复或同步非 KeyFerry provider 的命令时，都要检查是否需要调用 KeyFerry 配置锁。

补充说明：

- WebDAV 下载恢复现在也受 KeyFerry 配置锁控制，避免通过远端快照把数据库或 provider 状态绕回去。
- 上游再动设置页时，先检查这些锁是否还是按“破坏性入口”和“安全性入口”分开，而不是回到一刀切。

## 数据库版本说明

本地开发时遇到过：

```text
数据库版本过新（10），当前应用仅支持 6
```

原因是本机 `~/.cc-switch/cc-switch.db` 已经由较新的上游版本迁移到 `PRAGMA user_version = 10`，而当前分支的 `SCHEMA_VERSION` 仍停留在 6。

处理原则：

- 不要删除用户数据库。
- 不要手动把 `user_version` 降级。
- 保留上游的 future-version 保护。
- 窄回补 schema 版本与幂等迁移，避免引入无关上游功能。

当前处理：

- `src-tauri/src/database/mod.rs` 的 `SCHEMA_VERSION` 更新为 10。
- `src-tauri/src/database/schema.rs` 补齐 v6 -> v10 迁移：
  - v7：Skills 更新检测字段 `content_hash`、`updated_at`
  - v8：`proxy_request_logs.data_source`、`session_log_sync`、模型定价修正
  - v9：刷新模型定价种子
  - v10：`enabled_hermes`
- WebDAV `DB_COMPAT_VERSION` 仍保持 6，和上游一致，不要误改。

## 验证清单

常用验证命令：

```bash
pnpm typecheck
pnpm test:unit
pnpm build:renderer
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml schema_migration
cargo test --manifest-path src-tauri/Cargo.toml keyferry
```

已知情况：

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 可能因上游既有文件格式差异失败，当前已知涉及 `src-tauri/src/services/provider/mod.rs` 和 `src-tauri/src/services/proxy.rs`。
- 全量 `cargo test --manifest-path src-tauri/Cargo.toml` 可能仍会暴露上游测试与 KeyFerry-only 全局锁之间的旧假设冲突，需要按测试语义逐步调整，不要为了测试直接放松产品锁。

## 后续开发边界

- 优先复用上游结构，不大面积改动服务层。
- KeyFerry 新增逻辑尽量放在独立模块和命令保护层。
- 上游升级时优先检查：
  - 新增 provider 修改命令
  - 新增 import/restore/deeplink 入口
  - 新增 app 类型
  - 数据库 `SCHEMA_VERSION`
  - WebDAV `DB_COMPAT_VERSION`
- 如果上游新增可配置供应商入口，KeyFerry-only 模式必须同步隐藏前端入口并在后端阻断。
