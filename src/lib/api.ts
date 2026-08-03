import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AcpEvent, JsonValue } from "../types/acp";

export async function defaultCwd(): Promise<string> {
  return invoke("default_cwd");
}

export async function newSession(cwd: string, yolo = false): Promise<{ sessionId: string }> {
  const result = (await invoke("new_session", { cwd, yolo })) as JsonValue;
  const sessionId = (result as Record<string, JsonValue>)?.sessionId;
  if (typeof sessionId !== "string") {
    throw new Error(`session/new did not return a sessionId: ${JSON.stringify(result)}`);
  }
  return { sessionId };
}

export async function sendPrompt(sessionId: string, text: string): Promise<JsonValue> {
  return invoke("send_prompt", { sessionId, text });
}

export async function cancelPrompt(sessionId: string): Promise<void> {
  await invoke("cancel_prompt", { sessionId });
}

export async function respondPermission(id: JsonValue, optionId: string): Promise<void> {
  await invoke("respond_permission", { id, optionId });
}

export async function denyPermission(id: JsonValue): Promise<void> {
  await invoke("deny_permission", { id });
}

export function onAcpEvent(handler: (event: AcpEvent) => void): Promise<UnlistenFn> {
  return listen<AcpEvent>("acp-event", (e) => handler(e.payload));
}

export function onAcpReady(handler: (payload: JsonValue) => void): Promise<UnlistenFn> {
  return listen<JsonValue>("acp-ready", (e) => handler(e.payload));
}

export function onAcpInitError(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>("acp-init-error", (e) => handler(e.payload));
}

export async function checkAuth(): Promise<boolean> {
  return invoke("check_auth");
}

export async function startDeviceLogin(): Promise<void> {
  await invoke("start_device_login");
}

export interface LoginUrlPayload {
  url: string;
  code?: string;
}

export function onAuthLoginUrl(handler: (payload: LoginUrlPayload) => void): Promise<UnlistenFn> {
  return listen<LoginUrlPayload>("auth-login-url", (e) => handler(e.payload));
}

export interface LoginResultPayload {
  success: boolean;
  message?: string;
}

export function onAuthLoginResult(handler: (payload: LoginResultPayload) => void): Promise<UnlistenFn> {
  return listen<LoginResultPayload>("auth-login-result", (e) => handler(e.payload));
}
