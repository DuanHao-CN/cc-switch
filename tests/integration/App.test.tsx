import { Suspense, type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { providersApi } from "@/lib/api/providers";
import {
  resetProviderState,
  setCurrentProviderId,
  setLiveProviderIds,
  setProviders,
} from "../msw/state";
import { emitTauriEvent } from "../msw/tauriMocks";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/components/providers/ProviderList", () => ({
  ProviderList: ({
    providers,
    currentProviderId,
    onSwitch,
    onEdit,
    onDuplicate,
    onConfigureUsage,
    onOpenWebsite,
    onCreate,
    configurationLocked,
  }: any) => (
    <div>
      <div data-testid="provider-list">{JSON.stringify(providers)}</div>
      <div data-testid="current-provider">{currentProviderId}</div>
      {configurationLocked && <div data-testid="configuration-locked" />}
      <button onClick={() => onSwitch(providers[currentProviderId])}>
        switch
      </button>
      <button onClick={() => onEdit(providers[currentProviderId])}>edit</button>
      {onConfigureUsage && (
        <button onClick={() => onConfigureUsage(providers[currentProviderId])}>
          usage
        </button>
      )}
      {!configurationLocked && (
        <>
          <button onClick={() => onDuplicate(providers[currentProviderId])}>
            duplicate
          </button>
          <button onClick={() => onCreate?.()}>create</button>
        </>
      )}
      <button onClick={() => onOpenWebsite("https://example.com")}>
        open-website
      </button>
    </div>
  ),
}));

vi.mock("@/components/providers/AddProviderDialog", () => ({
  AddProviderDialog: ({ open, onOpenChange, onSubmit, appId }: any) =>
    open ? (
      <div data-testid="add-provider-dialog">
        <button
          onClick={() =>
            onSubmit({
              name: `New ${appId} Provider`,
              settingsConfig: {},
              category: "custom",
              sortIndex: 99,
            })
          }
        >
          confirm-add
        </button>
        <button onClick={() => onOpenChange(false)}>close-add</button>
      </div>
    ) : null,
}));

vi.mock("@/components/providers/EditProviderDialog", () => ({
  EditProviderDialog: ({ open, provider, onSubmit, onOpenChange }: any) =>
    open ? (
      <div data-testid="edit-provider-dialog">
        <button
          onClick={() =>
            onSubmit({
              provider: {
                ...provider,
                name: `${provider.name}-edited`,
              },
              originalId: provider.id,
            })
          }
        >
          confirm-edit
        </button>
        <button onClick={() => onOpenChange(false)}>close-edit</button>
      </div>
    ) : null,
}));

vi.mock("@/components/UsageScriptModal", () => ({
  default: ({ isOpen, provider, onSave, onClose }: any) =>
    isOpen ? (
      <div data-testid="usage-modal">
        <span data-testid="usage-provider">{provider?.id}</span>
        <button onClick={() => onSave("script-code")}>save-script</button>
        <button onClick={() => onClose()}>close-usage</button>
      </div>
    ) : null,
}));

vi.mock("@/components/ConfirmDialog", () => ({
  ConfirmDialog: ({ isOpen, onConfirm, onCancel }: any) =>
    isOpen ? (
      <div data-testid="confirm-dialog">
        <button onClick={() => onConfirm()}>confirm-delete</button>
        <button onClick={() => onCancel()}>cancel-delete</button>
      </div>
    ) : null,
}));

vi.mock("@/components/AppSwitcher", () => ({
  AppSwitcher: ({ activeApp, onSwitch, visibleApps }: any) => (
    <div data-testid="app-switcher">
      <span>{activeApp}</span>
      {visibleApps?.claude !== false && (
        <button onClick={() => onSwitch("claude")}>switch-claude</button>
      )}
      {visibleApps?.codex !== false && (
        <button onClick={() => onSwitch("codex")}>switch-codex</button>
      )}
      {visibleApps?.openclaw !== false && (
        <button onClick={() => onSwitch("openclaw")}>switch-openclaw</button>
      )}
    </div>
  ),
}));

vi.mock("@/components/UpdateBadge", () => ({
  UpdateBadge: ({ onClick }: any) => (
    <button onClick={onClick}>update-badge</button>
  ),
}));

vi.mock("@/components/mcp/McpPanel", () => ({
  default: ({ open, onOpenChange }: any) =>
    open ? (
      <div data-testid="mcp-panel">
        <button onClick={() => onOpenChange(false)}>close-mcp</button>
      </div>
    ) : (
      <button onClick={() => onOpenChange(true)}>open-mcp</button>
    ),
}));

const renderApp = (AppComponent: ComponentType) => {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="loading">loading</div>}>
        <AppComponent />
      </Suspense>
    </QueryClientProvider>,
  );
};

describe("App integration with MSW", () => {
  beforeEach(() => {
    localStorage.clear();
    resetProviderState();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("loads KeyFerry-managed providers, allows editing tools, and locks manual creation", async () => {
    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "universal-claude-keyferry-newapi",
      ),
    );
    expect(screen.getByTestId("provider-list").textContent).toContain(
      "default",
    );

    fireEvent.click(screen.getByText("switch-codex"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "universal-codex-keyferry-newapi",
      ),
    );

    fireEvent.click(screen.getByText("switch"));
    fireEvent.click(screen.getByText("open-website"));
    fireEvent.click(screen.getByText("usage"));
    expect(screen.getByTestId("usage-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("save-script"));
    fireEvent.click(screen.getByText("close-usage"));

    fireEvent.click(screen.getByText("edit"));
    expect(screen.getByTestId("edit-provider-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByText("confirm-edit"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toMatch(
        /-edited/,
      ),
    );

    expect(screen.getByTestId("configuration-locked")).toBeInTheDocument();
    expect(screen.getByText("usage")).toBeInTheDocument();
    expect(screen.queryByText("create")).not.toBeInTheDocument();
    expect(screen.getByText("edit")).toBeInTheDocument();
    expect(screen.queryByText("duplicate")).not.toBeInTheDocument();
    expect(screen.getByText("switch-openclaw")).toBeInTheDocument();

    emitTauriEvent("provider-switched", {
      appType: "codex",
      providerId: "codex-2",
    });

    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("shows toast when auto sync fails in background", async () => {
    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "universal-claude-keyferry-newapi",
      ),
    );

    emitTauriEvent("webdav-sync-status-updated", {
      source: "auto",
      status: "error",
      error: "network timeout",
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });
  });

  it("shows OpenClaw when KeyFerry manages it and hides manual OpenClaw providers", async () => {
    setProviders("openclaw", {
      "universal-openclaw-keyferry-newapi": {
        id: "universal-openclaw-keyferry-newapi",
        name: "钥渡 KeyFerry",
        settingsConfig: {
          baseUrl: "https://x.sozdata.com/v1",
          apiKey: "mock-keyferry-token",
          api: "openai-completions",
          models: [{ id: "gpt-5.4", name: "gpt-5.4" }],
        },
        category: "aggregator",
        sortIndex: 1,
        createdAt: Date.now(),
      },
      deepseek: {
        id: "deepseek",
        name: "DeepSeek",
        settingsConfig: {
          baseUrl: "https://api.deepseek.com",
          apiKey: "test-key",
          api: "openai-completions",
          models: [],
        },
        category: "custom",
        sortIndex: 0,
        createdAt: Date.now(),
      },
    });
    setCurrentProviderId("openclaw", "deepseek");
    setLiveProviderIds("openclaw", ["deepseek-copy"]);

    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "universal-claude-keyferry-newapi",
      ),
    );

    expect(screen.getByText("switch-openclaw")).toBeInTheDocument();
    fireEvent.click(screen.getByText("switch-openclaw"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "universal-openclaw-keyferry-newapi",
      ),
    );
    expect(screen.getByTestId("provider-list").textContent).not.toContain(
      "deepseek",
    );
  });

  it("does not expose duplicate flow when manual configuration is locked", async () => {
    setProviders("openclaw", {
      "universal-openclaw-keyferry-newapi": {
        id: "universal-openclaw-keyferry-newapi",
        name: "钥渡 KeyFerry",
        settingsConfig: {
          baseUrl: "https://x.sozdata.com/v1",
          apiKey: "mock-keyferry-token",
          api: "openai-completions",
          models: [{ id: "gpt-5.4", name: "gpt-5.4" }],
        },
        category: "aggregator",
        sortIndex: 1,
        createdAt: Date.now(),
      },
      deepseek: {
        id: "deepseek",
        name: "DeepSeek",
        settingsConfig: {
          baseUrl: "https://api.deepseek.com",
          apiKey: "test-key",
          api: "openai-completions",
          models: [],
        },
        category: "custom",
        sortIndex: 0,
        createdAt: Date.now(),
      },
    });
    setCurrentProviderId("openclaw", "deepseek");

    const liveIdsSpy = vi
      .spyOn(providersApi, "getOpenClawLiveProviderIds")
      .mockRejectedValueOnce(new Error("broken config"));

    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "universal-claude-keyferry-newapi",
      ),
    );

    expect(screen.queryByText("duplicate")).not.toBeInTheDocument();
    expect(liveIdsSpy).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining("读取配置中的供应商标识失败"),
    );

    liveIdsSpy.mockRestore();
  });
});
