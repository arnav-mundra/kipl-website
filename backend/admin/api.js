export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, url, body, isForm) {
  const headers = { "X-Requested-With": "kipl-admin" };
  let payload;
  if (isForm) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }

  let res;
  try {
    res = await fetch("/api/admin" + url, { method, headers, body: payload, credentials: "same-origin" });
  } catch (_) {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/login") && !url.startsWith("/me")) {
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data && data.details);
  }
  if (data && data.site) window.dispatchEvent(new CustomEvent("site:publish", { detail: data.site }));
  return data;
}

export const api = {
  get: (url) => request("GET", url),
  post: (url, body) => request("POST", url, body === undefined ? {} : body),
  put: (url, body) => request("PUT", url, body),
  patch: (url, body) => request("PATCH", url, body),
  del: (url) => request("DELETE", url),
  upload: (url, formData) => request("POST", url, formData, true),
};
