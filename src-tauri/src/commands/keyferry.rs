use std::collections::HashMap;

use reqwest::header::{HeaderName, HeaderValue, COOKIE, SET_COOKIE, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::app_config::AppType;
use crate::error::AppError;
use crate::provider::{
    ClaudeModelConfig, CodexModelConfig, GeminiModelConfig, Provider, ProviderMeta,
    UniversalProvider, UniversalProviderApps, UniversalProviderModels,
};
use crate::services::ProviderService;
use crate::store::AppState;

pub const KEYFERRY_ONLY_MODE: bool = true;
pub const KEYFERRY_GATEWAY_URL: &str = "https://x.sozdata.com";
pub const KEYFERRY_PROVIDER_ID: &str = "keyferry-newapi";
const KEYFERRY_PROVIDER_NAME: &str = "钥渡 KeyFerry";
const DEFAULT_TOKEN_NAME: &str = "cc-switch";
const USER_AGENT_VALUE: &str = "cc-switch/keyferry-login";
const NEW_API_USER_HEADER: HeaderName = HeaderName::from_static("new-api-user");
const KEYFERRY_CONFIG_LOCKED_MESSAGE: &str = "供应商配置只能通过钥渡 KeyFerry 登录完成";
const OFFICIAL_FALLBACK_PROVIDER_ID: &str = "default";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyFerryLoginConfigureResult {
    pub requires_2fa: bool,
    pub configured: bool,
    pub provider_id: Option<String>,
    pub token_id: Option<i64>,
    pub token_name: String,
    pub token_reused: bool,
    pub base_url: String,
    pub username: Option<String>,
    pub configured_apps: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyFerryStatus {
    pub configured: bool,
    pub provider_id: String,
    pub provider_name: String,
    pub base_url: String,
    pub username: Option<String>,
    pub token_name: Option<String>,
    pub configured_at: Option<i64>,
    pub configured_apps: Vec<String>,
}

#[derive(Clone, Serialize)]
struct KeyFerrySyncedEvent {
    action: String,
    id: String,
}

#[derive(Debug, Deserialize)]
struct NewApiToken {
    id: i64,
    name: String,
}

struct NewApiLogin {
    value: Value,
    user_id: String,
}

pub fn keyferry_only_mode() -> bool {
    KEYFERRY_ONLY_MODE
}

pub fn keyferry_config_locked_message() -> &'static str {
    KEYFERRY_CONFIG_LOCKED_MESSAGE
}

pub fn keyferry_child_provider_id(app_type: &AppType) -> Option<String> {
    match app_type {
        AppType::Claude => Some(format!("universal-claude-{KEYFERRY_PROVIDER_ID}")),
        AppType::Codex => Some(format!("universal-codex-{KEYFERRY_PROVIDER_ID}")),
        AppType::Gemini => Some(format!("universal-gemini-{KEYFERRY_PROVIDER_ID}")),
        AppType::OpenCode => Some(format!("universal-opencode-{KEYFERRY_PROVIDER_ID}")),
        AppType::OpenClaw => Some(format!("universal-openclaw-{KEYFERRY_PROVIDER_ID}")),
        AppType::Hermes => None,
    }
}

pub fn is_keyferry_child_provider_id(app_type: &AppType, id: &str) -> bool {
    keyferry_child_provider_id(app_type).as_deref() == Some(id)
}

pub fn is_keyferry_official_fallback_provider(provider: &Provider) -> bool {
    provider.id == OFFICIAL_FALLBACK_PROVIDER_ID
}

pub fn is_keyferry_visible_provider(app_type: &AppType, id: &str, provider: &Provider) -> bool {
    is_keyferry_child_provider_id(app_type, id) || is_keyferry_official_fallback_provider(provider)
}

pub fn is_keyferry_switchable_provider_id(app_type: &AppType, id: &str) -> bool {
    is_keyferry_child_provider_id(app_type, id)
        || (matches!(app_type, AppType::Claude | AppType::Codex | AppType::Gemini)
            && id == OFFICIAL_FALLBACK_PROVIDER_ID)
}

#[derive(Default)]
struct CookieJar {
    cookies: HashMap<String, String>,
}

impl CookieJar {
    fn absorb(&mut self, response: &reqwest::Response) {
        for value in response.headers().get_all(SET_COOKIE).iter() {
            let Ok(raw) = value.to_str() else {
                continue;
            };
            let Some(pair) = raw.split(';').next().map(str::trim) else {
                continue;
            };
            if pair.is_empty() {
                continue;
            }
            let Some((name, _)) = pair.split_once('=') else {
                continue;
            };
            self.cookies.insert(name.to_string(), pair.to_string());
        }
    }

    fn header_value(&self) -> Option<String> {
        if self.cookies.is_empty() {
            None
        } else {
            Some(
                self.cookies
                    .values()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("; "),
            )
        }
    }
}

fn newapi_url(path: &str) -> String {
    format!(
        "{}/{}",
        KEYFERRY_GATEWAY_URL.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn newapi_url_with_query(path: &str, query: &[(&str, &str)]) -> Result<String, AppError> {
    let mut url = url::Url::parse(&newapi_url(path))
        .map_err(|e| AppError::Message(format!("NewAPI URL 无效: {e}")))?;
    {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in query {
            pairs.append_pair(key, value);
        }
    }
    Ok(url.to_string())
}

fn response_message(value: &Value) -> String {
    value
        .get("message")
        .and_then(Value::as_str)
        .filter(|msg| !msg.trim().is_empty())
        .unwrap_or("NewAPI 请求失败")
        .to_string()
}

fn ensure_api_success(value: &Value) -> Result<(), AppError> {
    if value.get("success").and_then(Value::as_bool) == Some(false) {
        return Err(AppError::Message(response_message(value)));
    }
    Ok(())
}

fn data_value(value: &Value) -> Option<&Value> {
    value.get("data")
}

fn apply_newapi_user_header(
    mut request: reqwest::RequestBuilder,
    user_id: Option<&str>,
) -> Result<reqwest::RequestBuilder, AppError> {
    let Some(user_id) = user_id else {
        return Ok(request);
    };
    let user_id = user_id.trim();
    if user_id.is_empty() {
        return Ok(request);
    }
    let value = HeaderValue::from_str(user_id)
        .map_err(|e| AppError::Message(format!("NewAPI 用户 ID 无效: {e}")))?;
    request = request.header(NEW_API_USER_HEADER, value);
    Ok(request)
}

async fn send_json(
    client: &reqwest::Client,
    jar: &mut CookieJar,
    user_id: Option<&str>,
    method: reqwest::Method,
    url: String,
    body: Value,
) -> Result<Value, AppError> {
    let mut request = client
        .request(method, url)
        .header(USER_AGENT, USER_AGENT_VALUE)
        .json(&body);
    if let Some(cookies) = jar.header_value() {
        request = request.header(COOKIE, cookies);
    }
    request = apply_newapi_user_header(request, user_id)?;

    let response = request
        .send()
        .await
        .map_err(|e| AppError::Message(format!("NewAPI 请求失败: {e}")))?;
    jar.absorb(&response);

    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|e| AppError::Message(format!("NewAPI 响应解析失败: {e}")))?;
    if !status.is_success() {
        return Err(AppError::Message(format!(
            "NewAPI HTTP {}: {}",
            status.as_u16(),
            response_message(&value)
        )));
    }
    Ok(value)
}

async fn send_get(
    client: &reqwest::Client,
    jar: &mut CookieJar,
    user_id: Option<&str>,
    url: String,
) -> Result<Value, AppError> {
    let mut request = client.get(url).header(USER_AGENT, USER_AGENT_VALUE);
    if let Some(cookies) = jar.header_value() {
        request = request.header(COOKIE, cookies);
    }
    request = apply_newapi_user_header(request, user_id)?;

    let response = request
        .send()
        .await
        .map_err(|e| AppError::Message(format!("NewAPI 请求失败: {e}")))?;
    jar.absorb(&response);

    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|e| AppError::Message(format!("NewAPI 响应解析失败: {e}")))?;
    if !status.is_success() {
        return Err(AppError::Message(format!(
            "NewAPI HTTP {}: {}",
            status.as_u16(),
            response_message(&value)
        )));
    }
    Ok(value)
}

fn login_requires_2fa(value: &Value) -> bool {
    data_value(value)
        .and_then(|data| data.get("require_2fa"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn value_to_user_id(value: &Value) -> Option<String> {
    if let Some(id) = value.as_i64() {
        return Some(id.to_string());
    }
    value
        .as_str()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

fn login_user_id(value: &Value) -> Option<String> {
    let data = data_value(value)?;
    data.get("id")
        .and_then(value_to_user_id)
        .or_else(|| data.get("user_id").and_then(value_to_user_id))
        .or_else(|| data.get("userId").and_then(value_to_user_id))
        .or_else(|| {
            data.get("user")
                .and_then(|user| user.get("id"))
                .and_then(value_to_user_id)
        })
}

fn login_username(value: &Value, fallback: &str) -> String {
    data_value(value)
        .and_then(|data| data.get("username"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn extract_tokens(value: &Value) -> Vec<NewApiToken> {
    let items = data_value(value)
        .and_then(|data| data.get("items"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    items
        .into_iter()
        .filter_map(|item| serde_json::from_value::<NewApiToken>(item).ok())
        .collect()
}

fn select_token_by_name(mut tokens: Vec<NewApiToken>, token_name: &str) -> Option<NewApiToken> {
    tokens.retain(|token| token.name == token_name);
    tokens.sort_by(|a, b| b.id.cmp(&a.id));
    tokens.into_iter().next()
}

async fn login_newapi(
    client: &reqwest::Client,
    jar: &mut CookieJar,
    username: &str,
    password: &str,
    two_factor_code: Option<&str>,
) -> Result<Option<NewApiLogin>, AppError> {
    let login = send_json(
        client,
        jar,
        None,
        reqwest::Method::POST,
        newapi_url("/api/user/login"),
        json!({
            "username": username,
            "password": password,
        }),
    )
    .await?;
    ensure_api_success(&login)?;

    if !login_requires_2fa(&login) {
        let user_id = login_user_id(&login).ok_or_else(|| {
            AppError::Message("NewAPI 登录成功，但未返回用户 ID，无法管理 Token".to_string())
        })?;
        return Ok(Some(NewApiLogin {
            value: login,
            user_id,
        }));
    }

    let Some(code) = two_factor_code
        .map(str::trim)
        .filter(|code| !code.is_empty())
    else {
        return Ok(None);
    };

    let verified = send_json(
        client,
        jar,
        None,
        reqwest::Method::POST,
        newapi_url("/api/user/login/2fa"),
        json!({ "code": code }),
    )
    .await?;
    ensure_api_success(&verified)?;

    let user_id = login_user_id(&verified)
        .or_else(|| login_user_id(&login))
        .ok_or_else(|| {
            AppError::Message("NewAPI 登录成功，但未返回用户 ID，无法管理 Token".to_string())
        })?;

    Ok(Some(NewApiLogin {
        value: verified,
        user_id,
    }))
}

async fn find_token(
    client: &reqwest::Client,
    jar: &mut CookieJar,
    user_id: &str,
    token_name: &str,
) -> Result<Option<NewApiToken>, AppError> {
    let url = newapi_url_with_query(
        "/api/token/search",
        &[("keyword", token_name), ("p", "1"), ("page_size", "100")],
    )?;
    let searched = send_get(client, jar, Some(user_id), url).await?;
    ensure_api_success(&searched)?;
    if let Some(token) = select_token_by_name(extract_tokens(&searched), token_name) {
        return Ok(Some(token));
    }

    let url = newapi_url_with_query("/api/token/", &[("p", "1"), ("page_size", "100")])?;
    let listed = send_get(client, jar, Some(user_id), url).await?;
    ensure_api_success(&listed)?;
    Ok(select_token_by_name(extract_tokens(&listed), token_name))
}

async fn create_token(
    client: &reqwest::Client,
    jar: &mut CookieJar,
    user_id: &str,
    token_name: &str,
) -> Result<(), AppError> {
    let created = send_json(
        client,
        jar,
        Some(user_id),
        reqwest::Method::POST,
        newapi_url("/api/token/"),
        json!({
            "name": token_name,
            "expired_time": -1,
            "remain_quota": 0,
            "unlimited_quota": true,
            "model_limits_enabled": false,
            "model_limits": "",
        }),
    )
    .await?;
    ensure_api_success(&created)
}

async fn fetch_token_key(
    client: &reqwest::Client,
    jar: &mut CookieJar,
    user_id: &str,
    token_id: i64,
) -> Result<String, AppError> {
    let value = send_json(
        client,
        jar,
        Some(user_id),
        reqwest::Method::POST,
        newapi_url(&format!("/api/token/{token_id}/key")),
        json!({}),
    )
    .await?;
    ensure_api_success(&value)?;

    data_value(&value)
        .and_then(|data| data.get("key"))
        .and_then(Value::as_str)
        .filter(|key| !key.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::Message("NewAPI 未返回可用 Token Key".to_string()))
}

async fn reuse_or_create_token(
    client: &reqwest::Client,
    jar: &mut CookieJar,
    user_id: &str,
    token_name: &str,
) -> Result<(NewApiToken, String, bool), AppError> {
    if let Some(token) = find_token(client, jar, user_id, token_name).await? {
        let key = fetch_token_key(client, jar, user_id, token.id).await?;
        return Ok((token, key, true));
    }

    create_token(client, jar, user_id, token_name).await?;
    let token = find_token(client, jar, user_id, token_name)
        .await?
        .ok_or_else(|| {
            AppError::Message(format!(
                "NewAPI Token \"{token_name}\" 已创建，但未能在列表中找到"
            ))
        })?;
    let key = fetch_token_key(client, jar, user_id, token.id).await?;
    Ok((token, key, false))
}

fn default_universal_models() -> UniversalProviderModels {
    UniversalProviderModels {
        claude: Some(ClaudeModelConfig {
            model: Some("claude-sonnet-4-20250514".to_string()),
            haiku_model: Some("claude-haiku-4-20250514".to_string()),
            sonnet_model: Some("claude-sonnet-4-20250514".to_string()),
            opus_model: Some("claude-sonnet-4-20250514".to_string()),
        }),
        codex: Some(CodexModelConfig {
            model: Some("gpt-5.4".to_string()),
            reasoning_effort: Some("high".to_string()),
        }),
        gemini: Some(GeminiModelConfig {
            model: Some("gemini-2.5-pro".to_string()),
        }),
    }
}

fn default_universal_apps() -> UniversalProviderApps {
    UniversalProviderApps {
        claude: true,
        codex: true,
        gemini: true,
        opencode: true,
        openclaw: true,
    }
}

fn keyferry_apps_from_selection(
    enabled_apps: Option<Vec<String>>,
) -> Result<UniversalProviderApps, AppError> {
    let Some(enabled_apps) = enabled_apps else {
        return Ok(default_universal_apps());
    };

    let mut apps = UniversalProviderApps {
        claude: false,
        codex: false,
        gemini: false,
        opencode: false,
        openclaw: false,
    };

    for app in enabled_apps {
        match app.trim().to_ascii_lowercase().as_str() {
            "claude" => apps.claude = true,
            "codex" => apps.codex = true,
            "gemini" => apps.gemini = true,
            "opencode" => apps.opencode = true,
            "openclaw" => apps.openclaw = true,
            "" => {}
            other => {
                return Err(AppError::Message(format!(
                    "KeyFerry 不支持配置应用: {other}"
                )));
            }
        }
    }

    if !apps.claude && !apps.codex && !apps.gemini && !apps.opencode && !apps.openclaw {
        return Err(AppError::Message("请至少启用一个应用".to_string()));
    }

    Ok(apps)
}

fn official_fallback_provider(app_type: &AppType) -> Option<Provider> {
    let (name, settings_config, website_url, icon, icon_color, meta) = match app_type {
        AppType::Claude => (
            "Claude Official",
            json!({ "env": {} }),
            "https://www.anthropic.com/claude-code",
            "anthropic",
            "#D4915D",
            None,
        ),
        AppType::Codex => (
            "OpenAI Official",
            json!({ "auth": {}, "config": "" }),
            "https://chatgpt.com/codex",
            "openai",
            "#00A67E",
            None,
        ),
        AppType::Gemini => (
            "Google Gemini Official",
            json!({ "env": {} }),
            "https://ai.google.dev/",
            "gemini",
            "#4285F4",
            Some(ProviderMeta {
                partner_promotion_key: Some("google-official".to_string()),
                ..ProviderMeta::default()
            }),
        ),
        AppType::OpenCode | AppType::OpenClaw | AppType::Hermes => return None,
    };

    Some(Provider {
        id: OFFICIAL_FALLBACK_PROVIDER_ID.to_string(),
        name: name.to_string(),
        settings_config,
        website_url: Some(website_url.to_string()),
        category: Some("official".to_string()),
        created_at: Some(chrono::Utc::now().timestamp_millis()),
        sort_index: Some(0),
        notes: None,
        meta,
        icon: Some(icon.to_string()),
        icon_color: Some(icon_color.to_string()),
        in_failover_queue: false,
    })
}

fn ensure_official_fallback_provider(state: &AppState, app_type: AppType) -> Result<(), AppError> {
    if state
        .db
        .get_provider_by_id(OFFICIAL_FALLBACK_PROVIDER_ID, app_type.as_str())?
        .is_some()
    {
        return Ok(());
    }

    let Some(provider) = official_fallback_provider(&app_type) else {
        return Ok(());
    };
    state.db.save_provider(app_type.as_str(), &provider)
}

fn ensure_official_fallback_providers(state: &AppState) -> Result<(), AppError> {
    for app_type in [AppType::Claude, AppType::Codex, AppType::Gemini] {
        ensure_official_fallback_provider(state, app_type)?;
    }
    Ok(())
}

fn switch_to_official_fallback_providers(state: &AppState) -> Result<(), AppError> {
    for app_type in [AppType::Claude, AppType::Codex, AppType::Gemini] {
        ProviderService::switch(state, app_type, OFFICIAL_FALLBACK_PROVIDER_ID)?;
    }
    Ok(())
}

fn switch_synced_keyferry_providers(
    state: &AppState,
    provider: &UniversalProvider,
) -> Result<(), AppError> {
    let child_providers = enabled_child_providers(provider);
    for app_type in [AppType::Claude, AppType::Codex, AppType::Gemini] {
        let Some((_, child_id)) = child_providers
            .iter()
            .find(|(enabled_app_type, _)| enabled_app_type == &app_type)
        else {
            ProviderService::switch(state, app_type, OFFICIAL_FALLBACK_PROVIDER_ID)?;
            continue;
        };

        ProviderService::switch(state, app_type, child_id)?;
    }

    Ok(())
}

fn merge_keyferry_provider(
    existing: Option<UniversalProvider>,
    api_key: String,
    apps: UniversalProviderApps,
    username: Option<String>,
    user_id: String,
    token_id: i64,
    token_name: String,
) -> UniversalProvider {
    let mut provider = existing.unwrap_or_else(|| UniversalProvider {
        id: KEYFERRY_PROVIDER_ID.to_string(),
        name: KEYFERRY_PROVIDER_NAME.to_string(),
        provider_type: "newapi".to_string(),
        apps: default_universal_apps(),
        base_url: KEYFERRY_GATEWAY_URL.to_string(),
        api_key: api_key.clone(),
        models: default_universal_models(),
        website_url: Some(KEYFERRY_GATEWAY_URL.to_string()),
        notes: Some("由钥渡 KeyFerry 登录器自动配置".to_string()),
        icon: Some("newapi".to_string()),
        icon_color: Some("#00A67E".to_string()),
        meta: Some(ProviderMeta {
            provider_type: Some("newapi".to_string()),
            ..ProviderMeta::default()
        }),
        created_at: Some(chrono::Utc::now().timestamp_millis()),
        sort_index: None,
    });

    provider.id = KEYFERRY_PROVIDER_ID.to_string();
    provider.name = KEYFERRY_PROVIDER_NAME.to_string();
    provider.provider_type = "newapi".to_string();
    provider.apps = apps;
    provider.base_url = KEYFERRY_GATEWAY_URL.to_string();
    provider.api_key = api_key;
    provider.website_url = Some(KEYFERRY_GATEWAY_URL.to_string());
    provider.icon = Some("newapi".to_string());
    provider.icon_color = Some("#00A67E".to_string());
    provider
        .meta
        .get_or_insert_with(ProviderMeta::default)
        .provider_type = Some("newapi".to_string());
    if let Some(meta) = provider.meta.as_mut() {
        meta.keyferry_username = username;
        meta.keyferry_user_id = Some(user_id);
        meta.keyferry_token_id = Some(token_id);
        meta.keyferry_token_name = Some(token_name);
        meta.keyferry_configured_at = Some(chrono::Utc::now().timestamp_millis());
    }

    provider
}

fn enabled_child_providers(provider: &UniversalProvider) -> Vec<(AppType, String)> {
    let mut apps = Vec::new();
    if provider.apps.claude {
        apps.push((AppType::Claude, format!("universal-claude-{}", provider.id)));
    }
    if provider.apps.codex {
        apps.push((AppType::Codex, format!("universal-codex-{}", provider.id)));
    }
    if provider.apps.gemini {
        apps.push((AppType::Gemini, format!("universal-gemini-{}", provider.id)));
    }
    if provider.apps.opencode {
        apps.push((
            AppType::OpenCode,
            format!("universal-opencode-{}", provider.id),
        ));
    }
    if provider.apps.openclaw {
        apps.push((
            AppType::OpenClaw,
            format!("universal-openclaw-{}", provider.id),
        ));
    }
    apps
}

#[tauri::command]
pub fn keyferry_status(state: State<'_, AppState>) -> Result<KeyFerryStatus, String> {
    ensure_official_fallback_providers(state.inner()).map_err(|e| e.to_string())?;

    let Some(provider) = state
        .db
        .get_universal_provider(KEYFERRY_PROVIDER_ID)
        .map_err(|e| e.to_string())?
    else {
        return Ok(KeyFerryStatus {
            configured: false,
            provider_id: KEYFERRY_PROVIDER_ID.to_string(),
            provider_name: KEYFERRY_PROVIDER_NAME.to_string(),
            base_url: KEYFERRY_GATEWAY_URL.to_string(),
            username: None,
            token_name: None,
            configured_at: None,
            configured_apps: Vec::new(),
        });
    };

    let child_providers = enabled_child_providers(&provider);
    let configured_apps = child_providers
        .iter()
        .map(|(app_type, _)| app_type.as_str().to_string())
        .collect::<Vec<_>>();
    let has_token = !provider.api_key.trim().is_empty();
    let uses_keyferry_gateway =
        provider.base_url.trim_end_matches('/') == KEYFERRY_GATEWAY_URL.trim_end_matches('/');
    let child_providers_exist = !child_providers.is_empty()
        && child_providers.iter().all(|(app_type, child_id)| {
            state
                .db
                .get_provider_by_id(child_id, app_type.as_str())
                .ok()
                .flatten()
                .is_some()
        });
    let meta = provider.meta.as_ref();

    Ok(KeyFerryStatus {
        configured: has_token && uses_keyferry_gateway && child_providers_exist,
        provider_id: KEYFERRY_PROVIDER_ID.to_string(),
        provider_name: KEYFERRY_PROVIDER_NAME.to_string(),
        base_url: KEYFERRY_GATEWAY_URL.to_string(),
        username: meta.and_then(|meta| meta.keyferry_username.clone()),
        token_name: meta.and_then(|meta| meta.keyferry_token_name.clone()),
        configured_at: meta.and_then(|meta| meta.keyferry_configured_at),
        configured_apps,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn keyferry_login_configure(
    app: AppHandle,
    state: State<'_, AppState>,
    username: String,
    password: String,
    two_factor_code: Option<String>,
    enabled_apps: Option<Vec<String>>,
) -> Result<KeyFerryLoginConfigureResult, String> {
    let username = username.trim().to_string();
    if username.is_empty() || password.is_empty() {
        return Err("请输入账号和密码".to_string());
    }
    let selected_apps = keyferry_apps_from_selection(enabled_apps).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;
    let mut jar = CookieJar::default();

    let login = login_newapi(
        &client,
        &mut jar,
        &username,
        &password,
        two_factor_code.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;

    let Some(login) = login else {
        return Ok(KeyFerryLoginConfigureResult {
            requires_2fa: true,
            configured: false,
            provider_id: None,
            token_id: None,
            token_name: DEFAULT_TOKEN_NAME.to_string(),
            token_reused: false,
            base_url: KEYFERRY_GATEWAY_URL.to_string(),
            username: Some(username),
            configured_apps: Vec::new(),
        });
    };

    let (token, api_key, token_reused) =
        reuse_or_create_token(&client, &mut jar, &login.user_id, DEFAULT_TOKEN_NAME)
            .await
            .map_err(|e| e.to_string())?;
    let login_username = login_username(&login.value, &username);

    let existing = state
        .db
        .get_universal_provider(KEYFERRY_PROVIDER_ID)
        .map_err(|e| e.to_string())?;
    let provider = merge_keyferry_provider(
        existing,
        api_key,
        selected_apps,
        Some(login_username.clone()),
        login.user_id.clone(),
        token.id,
        token.name.clone(),
    );
    let configured_apps = enabled_child_providers(&provider)
        .iter()
        .map(|(app_type, _)| app_type.as_str().to_string())
        .collect::<Vec<_>>();

    state
        .db
        .save_universal_provider(&provider)
        .map_err(|e| e.to_string())?;
    ensure_official_fallback_providers(state.inner()).map_err(|e| e.to_string())?;
    ProviderService::sync_universal_to_apps(state.inner(), KEYFERRY_PROVIDER_ID)
        .map_err(|e| e.to_string())?;
    switch_synced_keyferry_providers(state.inner(), &provider).map_err(|e| e.to_string())?;

    let _ = app.emit(
        "universal-provider-synced",
        KeyFerrySyncedEvent {
            action: "keyferry-login".to_string(),
            id: KEYFERRY_PROVIDER_ID.to_string(),
        },
    );

    Ok(KeyFerryLoginConfigureResult {
        requires_2fa: false,
        configured: true,
        provider_id: Some(KEYFERRY_PROVIDER_ID.to_string()),
        token_id: Some(token.id),
        token_name: token.name,
        token_reused,
        base_url: KEYFERRY_GATEWAY_URL.to_string(),
        username: Some(login_username),
        configured_apps,
    })
}

#[tauri::command]
pub fn keyferry_logout(app: AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    ProviderService::delete_universal(state.inner(), KEYFERRY_PROVIDER_ID)
        .map_err(|e| e.to_string())?;
    ensure_official_fallback_providers(state.inner()).map_err(|e| e.to_string())?;
    switch_to_official_fallback_providers(state.inner()).map_err(|e| e.to_string())?;

    let _ = app.emit(
        "universal-provider-synced",
        KeyFerrySyncedEvent {
            action: "keyferry-logout".to_string(),
            id: KEYFERRY_PROVIDER_ID.to_string(),
        },
    );

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_token_prefers_exact_latest_id() {
        let tokens = vec![
            NewApiToken {
                id: 1,
                name: "cc-switch".to_string(),
            },
            NewApiToken {
                id: 3,
                name: "other".to_string(),
            },
            NewApiToken {
                id: 2,
                name: "cc-switch".to_string(),
            },
        ];

        let selected = select_token_by_name(tokens, "cc-switch").expect("token");
        assert_eq!(selected.id, 2);
    }

    #[test]
    fn detects_2fa_login_response() {
        let value = json!({
            "success": true,
            "data": { "require_2fa": true }
        });

        assert!(login_requires_2fa(&value));
    }

    #[test]
    fn extracts_login_user_id() {
        let value = json!({
            "success": true,
            "data": { "id": 1, "username": "duanhao" }
        });

        assert_eq!(login_user_id(&value).as_deref(), Some("1"));
    }

    #[test]
    fn selected_apps_require_at_least_one_supported_app() {
        let apps = keyferry_apps_from_selection(Some(vec![
            "claude".to_string(),
            "gemini".to_string(),
            "openclaw".to_string(),
        ]))
        .expect("selected apps");
        assert!(apps.claude);
        assert!(!apps.codex);
        assert!(apps.gemini);
        assert!(!apps.opencode);
        assert!(apps.openclaw);

        assert!(keyferry_apps_from_selection(Some(vec![])).is_err());
        assert!(keyferry_apps_from_selection(Some(vec!["opencode".to_string()])).is_ok());
        assert!(keyferry_apps_from_selection(Some(vec!["unknown".to_string()])).is_err());
    }
}
