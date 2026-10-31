import { API_URL } from "./config";
import { ApiError } from "./api";

/**
 * POSTs JSON and consumes a text/event-stream response ("data: {json}\n\n" frames).
 * Errors before the stream starts come back as normal JSON and are thrown as ApiError.
 */
export async function postSse<T>(path: string, body: unknown, onEvent: (event: T) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ApiError(0, "network");
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ApiError(res.status, data?.error?.code ?? "generic");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (frame.startsWith("data: ")) onEvent(JSON.parse(frame.slice(6)) as T);
    }
  }
}
