// What the browser tab may show: a page this Mac serves to itself. "3000", "localhost:3000/shop" and
// full URLs are all accepted; anything on another host is refused, since the tab is for the
// project's own dev server and the app's CSP only lets local pages in.

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

export function localUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const withHost = /^\d+(\/|$)/.test(text) ? `localhost:${text}` : text;
  const withScheme = /^https?:\/\//i.test(withHost) ? withHost : `http://${withHost}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname) && url.port ? url.toString() : null;
  } catch {
    return null;
  }
}

export const portUrl = (port: number) => `http://localhost:${port}/`;
