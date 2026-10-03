export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response
    .json()
    .catch(() => ({
      error: "無法連線至本機服務，請確認 npm run dev 正在運行。",
    }));
  if (!response.ok) throw new Error(body.error || "操作未完成，請再試一次。");
  return body as T;
}

export const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body ?? {}),
});
