export const basePath =
  window.location.pathname.match(
    /^\/lesson-app\/[^/]+(?:\/_teacher\/[^/]+)?/,
  )?.[0] ?? import.meta.env.BASE_URL.replace(/\/$/, "");
export function appUrl(value: string) {
  return value.startsWith("/") && !value.startsWith("//")
    ? basePath + value
    : value;
}
