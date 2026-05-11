import { FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { keyferryApi, providersApi } from "@/lib/api";
import type { KeyFerryLoginConfigureResult } from "@/lib/api/keyferry";
import { extractErrorMessage } from "@/utils/errorUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ProviderIcon } from "@/components/ProviderIcon";
import { cn } from "@/lib/utils";

const KEYFERRY_GATEWAY = "https://x.sozdata.com";
const KEYFERRY_APPS = [
  {
    id: "claude",
    label: "Claude Code",
    icon: "claude",
    path: "~/.claude/settings.json",
  },
  {
    id: "codex",
    label: "Codex CLI",
    icon: "openai",
    path: "~/.codex/config.toml",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    icon: "gemini",
    path: "~/.gemini/.env",
  },
  {
    id: "opencode",
    label: "OpenCode",
    icon: "opencode",
    path: "~/.config/opencode/opencode.json",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    icon: "openclaw",
    path: "~/.openclaw/openclaw.json",
  },
] as const;

type KeyFerryAppId = (typeof KEYFERRY_APPS)[number]["id"];
type KeyFerryAppSelection = Record<KeyFerryAppId, boolean>;

const defaultAppSelection = (): KeyFerryAppSelection => ({
  claude: true,
  codex: true,
  gemini: true,
  opencode: true,
  openclaw: true,
});

const appSelectionFromList = (apps?: string[] | null): KeyFerryAppSelection => {
  if (!apps?.length) {
    return defaultAppSelection();
  }

  return {
    claude: apps.includes("claude"),
    codex: apps.includes("codex"),
    gemini: apps.includes("gemini"),
    opencode: apps.includes("opencode"),
    openclaw: apps.includes("openclaw"),
  };
};

const enabledAppIds = (selection: KeyFerryAppSelection): KeyFerryAppId[] =>
  KEYFERRY_APPS.filter((app) => selection[app.id]).map((app) => app.id);

interface KeyFerryLoginPanelProps {
  onConfigured?: () => void | Promise<void>;
}

export function KeyFerryLoginPanel({ onConfigured }: KeyFerryLoginPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [requires2fa, setRequires2fa] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [selectedApps, setSelectedApps] =
    useState<KeyFerryAppSelection>(defaultAppSelection);
  const [result, setResult] = useState<KeyFerryLoginConfigureResult | null>(
    null,
  );

  const { data: status, isLoading: isStatusLoading } = useQuery({
    queryKey: ["keyferryStatus"],
    queryFn: () => keyferryApi.status(),
  });

  const configuredAt = useMemo(() => {
    if (!status?.configuredAt) return null;
    return new Date(status.configuredAt).toLocaleString();
  }, [status?.configuredAt]);

  const refreshKeyFerryState = async () => {
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
    await queryClient.invalidateQueries({ queryKey: ["keyferryStatus"] });
    await queryClient.invalidateQueries({
      queryKey: ["opencodeLiveProviderIds"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["openclawLiveProviderIds"],
    });
    await providersApi.updateTrayMenu();
  };

  const clearSecrets = () => {
    setPassword("");
    setTwoFactorCode("");
    setShowPassword(false);
  };

  const updateSelectedApp = (app: KeyFerryAppId, enabled: boolean) => {
    setSelectedApps((current) => ({
      ...current,
      [app]: enabled,
    }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const enabledApps = enabledAppIds(selectedApps);
    if (!username.trim() || !password) {
      toast.error(
        t("keyferry.loginMissingFields", {
          defaultValue: "请输入账号和密码",
        }),
      );
      return;
    }
    if (!enabledApps.length) {
      toast.error(
        t("keyferry.scopeRequired", {
          defaultValue: "请至少启用一个客户端",
        }),
      );
      return;
    }

    setSubmitting(true);
    try {
      const response = await keyferryApi.loginConfigure({
        username: username.trim(),
        password,
        twoFactorCode: requires2fa ? twoFactorCode.trim() : undefined,
        enabledApps,
      });

      if (response.requires2fa) {
        setRequires2fa(true);
        setResult(null);
        toast.info(
          t("keyferry.twoFactorRequired", {
            defaultValue: "请输入两步验证码后继续",
          }),
        );
        return;
      }

      setRequires2fa(false);
      clearSecrets();
      setResult(response);

      await refreshKeyFerryState();
      await onConfigured?.();
      setShowLoginForm(false);

      toast.success(
        response.tokenReused
          ? t("keyferry.configuredWithExistingToken", {
              defaultValue: "已复用 cc-switch Token 并完成配置",
            })
          : t("keyferry.configuredWithNewToken", {
              defaultValue: "已创建 cc-switch Token 并完成配置",
            }),
        { closeButton: true },
      );
    } catch (error) {
      const detail =
        extractErrorMessage(error) ||
        t("keyferry.loginFailed", {
          defaultValue: "登录或配置失败",
        });
      toast.error(detail, { closeButton: true });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await keyferryApi.logout();
      clearSecrets();
      setRequires2fa(false);
      setResult(null);
      setShowLoginForm(false);
      await refreshKeyFerryState();
      toast.success(
        t("keyferry.loggedOut", {
          defaultValue: "已注销 KeyFerry 账号",
        }),
        { closeButton: true },
      );
    } catch (error) {
      const detail =
        extractErrorMessage(error) ||
        t("keyferry.logoutFailed", {
          defaultValue: "注销失败",
        });
      toast.error(detail, { closeButton: true });
    } finally {
      setLoggingOut(false);
    }
  };

  const configured = status?.configured === true;
  const shouldShowAccount = configured && !showLoginForm && !requires2fa;
  const displayUsername =
    status?.username ||
    result?.username ||
    t("keyferry.connectedAccount", { defaultValue: "已连接账号" });
  const displayToken =
    status?.tokenName ||
    result?.tokenName ||
    t("keyferry.defaultTokenName", { defaultValue: "cc-switch" });
  const configuredApps = status?.configuredApps?.length
    ? status.configuredApps
    : result?.configuredApps || [
        "claude",
        "codex",
        "gemini",
        "opencode",
        "openclaw",
      ];
  const selectedAppIds = enabledAppIds(selectedApps);
  const hasSelectedApp = selectedAppIds.length > 0;

  if (isStatusLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background shadow-sm">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">
              {t("keyferry.title", { defaultValue: "钥渡 KeyFerry" })}
            </h2>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Cloud className="h-3.5 w-3.5" />
              <span>{KEYFERRY_GATEWAY}</span>
            </div>
          </div>
        </div>
        <Badge variant="outline" className="rounded-md px-2 py-1">
          NewAPI Gateway
        </Badge>
      </div>

      {shouldShowAccount ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-xl border border-border bg-background p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                  <UserRound className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-base font-semibold">
                    {t("keyferry.accountTitle", {
                      defaultValue: "KeyFerry 账号",
                    })}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {displayUsername}
                  </div>
                </div>
              </div>
              <Badge
                variant="secondary"
                className="rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              >
                {t("keyferry.configured", { defaultValue: "已配置完成" })}
              </Badge>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Token</div>
                <div className="mt-1 truncate text-sm font-medium">
                  {displayToken}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">
                  {t("keyferry.configuredAt", {
                    defaultValue: "最近配置",
                  })}
                </div>
                <div className="mt-1 truncate text-sm font-medium">
                  {configuredAt || "-"}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setUsername(status?.username || "");
                  setSelectedApps(appSelectionFromList(status?.configuredApps));
                  setShowLoginForm(true);
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("keyferry.reconfigure", { defaultValue: "重新配置" })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
              >
                {loggingOut ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="mr-2 h-4 w-4" />
                )}
                {t("keyferry.logout", { defaultValue: "注销" })}
              </Button>
            </div>
          </section>

          <aside className="rounded-xl border border-border bg-muted/15 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Settings2 className="h-4 w-4 text-primary" />
              {t("keyferry.configScope", { defaultValue: "客户端范围" })}
            </div>
            <div className="mt-4 space-y-2">
              {KEYFERRY_APPS.map((app) => {
                const enabled = configuredApps.includes(app.id);
                const disabledLabel =
                  app.id === "opencode" || app.id === "openclaw"
                    ? t("keyferry.notConnected", { defaultValue: "未接入" })
                    : t("keyferry.official", { defaultValue: "官方" });
                return (
                  <div
                    key={app.id}
                    className={cn(
                      "flex items-center justify-between rounded-lg border px-3 py-2",
                      enabled
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-border bg-background",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <ProviderIcon
                        icon={app.icon}
                        name={app.label}
                        size={18}
                      />
                      <span className="truncate text-sm">{app.label}</span>
                    </div>
                    <Badge
                      variant={enabled ? "secondary" : "outline"}
                      className="rounded-md"
                    >
                      {enabled
                        ? t("keyferry.enabled", { defaultValue: "启用" })
                        : disabledLabel}
                    </Badge>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
              {t("keyferry.officialFallback", {
                defaultValue:
                  "Claude、Codex、Gemini 未接管时保留 default 官方渠道；OpenCode、OpenClaw 未接入时不写入配置。",
              })}
            </div>
          </aside>
        </div>
      ) : (
        <div className="grid overflow-hidden rounded-xl border border-border bg-background shadow-sm lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="order-2 border-t border-border bg-muted/20 p-4 sm:p-5 lg:order-1 lg:border-r lg:border-t-0 lg:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <KeyRound className="h-6 w-6" />
              </div>
              <div>
                <div className="text-lg font-semibold">
                  {t("keyferry.loginTitle", {
                    defaultValue: "连接 KeyFerry",
                  })}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {KEYFERRY_GATEWAY}
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-lg border border-border bg-background p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Token</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    NewAPI
                  </div>
                </div>
                <Badge variant="secondary" className="rounded-md">
                  cc-switch
                </Badge>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-sm font-medium">
                  {t("keyferry.configScope", {
                    defaultValue: "客户端选择",
                  })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {selectedAppIds.length}/{KEYFERRY_APPS.length}
                </div>
              </div>
              <div className="space-y-2">
                {KEYFERRY_APPS.map((app) => {
                  const checked = selectedApps[app.id];
                  return (
                    <div
                      key={app.id}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors",
                        checked
                          ? "border-primary/35 bg-primary/5"
                          : "border-border bg-background",
                      )}
                    >
                      <Label
                        htmlFor={`keyferry-scope-${app.id}`}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                      >
                        <ProviderIcon
                          icon={app.icon}
                          name={app.label}
                          size={24}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {app.label}
                          </span>
                          <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                            {app.path}
                          </span>
                        </span>
                      </Label>
                      <Switch
                        id={`keyferry-scope-${app.id}`}
                        checked={checked}
                        onCheckedChange={(next) =>
                          updateSelectedApp(app.id, next)
                        }
                        disabled={submitting}
                        aria-label={t("keyferry.toggleAppScope", {
                          app: app.label,
                          defaultValue: `启用 ${app.label}`,
                        })}
                      />
                    </div>
                  );
                })}
              </div>
              {!hasSelectedApp && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5" />
                  <span>
                    {t("keyferry.scopeRequired", {
                      defaultValue: "请至少启用一个客户端",
                    })}
                  </span>
                </div>
              )}
            </div>
          </section>

          <section className="order-1 p-4 sm:p-5 lg:order-2 lg:p-6">
            <div className="mb-5">
              <div className="text-base font-semibold">
                {t("keyferry.loginTitle", { defaultValue: "NewAPI 账号" })}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {t("keyferry.loginSubtitle", {
                  defaultValue: "登录后写入所选客户端配置",
                })}
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="keyferry-username">
                  {t("keyferry.username", { defaultValue: "账号" })}
                </Label>
                <Input
                  id="keyferry-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  disabled={submitting}
                  className="h-11 rounded-lg"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="keyferry-password">
                  {t("keyferry.password", { defaultValue: "密码" })}
                </Label>
                <div className="relative">
                  <Input
                    id="keyferry-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    disabled={submitting}
                    className="h-11 rounded-lg pr-11"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-11 w-11"
                    onClick={() => setShowPassword((value) => !value)}
                    disabled={submitting}
                    aria-label={
                      showPassword
                        ? t("keyferry.hidePassword", {
                            defaultValue: "隐藏密码",
                          })
                        : t("keyferry.showPassword", {
                            defaultValue: "显示密码",
                          })
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {requires2fa && (
                <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <Label
                    htmlFor="keyferry-2fa"
                    className="flex items-center gap-2"
                  >
                    <ShieldCheck className="h-4 w-4 text-amber-600" />
                    {t("keyferry.twoFactorCode", {
                      defaultValue: "两步验证码",
                    })}
                  </Label>
                  <Input
                    id="keyferry-2fa"
                    value={twoFactorCode}
                    onChange={(event) => setTwoFactorCode(event.target.value)}
                    autoComplete="one-time-code"
                    disabled={submitting}
                    className="h-10 rounded-lg"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-1">
                {configured && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      clearSecrets();
                      setRequires2fa(false);
                      setSelectedApps(
                        appSelectionFromList(status?.configuredApps),
                      );
                      setShowLoginForm(false);
                    }}
                    disabled={submitting}
                  >
                    {t("common.cancel", { defaultValue: "取消" })}
                  </Button>
                )}
                <Button
                  type="submit"
                  className="h-11 flex-1 rounded-lg"
                  disabled={
                    submitting ||
                    !username.trim() ||
                    !password ||
                    !hasSelectedApp ||
                    (requires2fa && !twoFactorCode.trim())
                  }
                >
                  {submitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="mr-2 h-4 w-4" />
                  )}
                  {requires2fa
                    ? t("keyferry.verifyAndConfigure", {
                        defaultValue: "验证并配置",
                      })
                    : t("keyferry.loginAndConfigure", {
                        defaultValue: "登录并配置",
                      })}
                </Button>
              </div>
            </form>

            <div className="mt-5 rounded-lg border border-border bg-muted/20 p-3">
              {result?.configured ? (
                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("keyferry.configured", {
                    defaultValue: "已配置完成",
                  })}
                </div>
              ) : (
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <AlertCircle className="mt-0.5 h-4 w-4" />
                  <span>
                    {requires2fa
                      ? t("keyferry.waitingFor2fa", {
                          defaultValue: "等待两步验证",
                        })
                      : t("keyferry.notConfigured", {
                          defaultValue: "尚未登录配置",
                        })}
                  </span>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
