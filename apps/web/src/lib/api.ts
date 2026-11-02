import { API_URL } from "./config";

/** Error returned by the API: { error: { code, requestId, details? } }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Calls the API with the session cookie (credentials: "include").
 * The API checks the Origin header on state-changing requests (CSRF protection).
 */
export async function api<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network");
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? (res.status === 401 ? "unauthorized" : "generic"), err?.details);
  }
  return data as T;
}

/** Uploads a file with progress reporting (fetch has no upload progress events). */
export function uploadWithProgress(
  path: string,
  file: Blob,
  contentType: string,
  onProgress: (percent: number) => void,
  headers: Record<string, string> = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${API_URL}${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", contentType);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError(0, "network"));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const err = (data as { error?: { code?: string } } | null)?.error;
      reject(new ApiError(xhr.status, err?.code ?? "generic"));
    };
    xhr.send(file);
  });
}

/** Downloads a protected file into a temporary object URL (never a public link). */
export async function fetchBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_URL}${path}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, "generic");
  return res.blob();
}
