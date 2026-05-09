import { invoke } from "@tauri-apps/api/core";

export interface KeyFerryLoginConfigureResult {
  requires2fa: boolean;
  configured: boolean;
  providerId?: string | null;
  tokenId?: number | null;
  tokenName: string;
  tokenReused: boolean;
  baseUrl: string;
  username?: string | null;
  configuredApps: string[];
}

export interface KeyFerryStatus {
  configured: boolean;
  providerId: string;
  providerName: string;
  baseUrl: string;
  username?: string | null;
  tokenName?: string | null;
  configuredAt?: number | null;
  configuredApps: string[];
}

export async function keyferryStatus(): Promise<KeyFerryStatus> {
  return invoke<KeyFerryStatus>("keyferry_status");
}

export async function keyferryLoginConfigure(params: {
  username: string;
  password: string;
  twoFactorCode?: string;
  enabledApps?: string[];
}): Promise<KeyFerryLoginConfigureResult> {
  return invoke<KeyFerryLoginConfigureResult>("keyferry_login_configure", {
    username: params.username,
    password: params.password,
    twoFactorCode: params.twoFactorCode || undefined,
    enabledApps: params.enabledApps,
  });
}

export async function keyferryLogout(): Promise<boolean> {
  return invoke<boolean>("keyferry_logout");
}

export const keyferryApi = {
  status: keyferryStatus,
  loginConfigure: keyferryLoginConfigure,
  logout: keyferryLogout,
};
