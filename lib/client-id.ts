const STORAGE_KEY = "boh-dj-client-id";

export function getClientId(): string {
  if (typeof window === "undefined") return "";

  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `boh-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  window.localStorage.setItem(STORAGE_KEY, id);
  return id;
}
