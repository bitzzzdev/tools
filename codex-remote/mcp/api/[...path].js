const ALLOWED_PATHS = new Set(["mcp", "health"]);
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "mcp-protocol-version",
  "mcp-session-id",
  "last-event-id",
  "origin"
];
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "mcp-protocol-version",
  "mcp-session-id",
  "www-authenticate",
  "retry-after"
];

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  const incoming = new URL(req.url || "/", "http://vercel.internal");
  const endpoint = incoming.pathname.split("/").filter(Boolean).at(-1);

  if (!ALLOWED_PATHS.has(endpoint)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const upstreamBase = process.env.MCP_UPSTREAM_URL;
  if (!upstreamBase) {
    res.status(503).json({ error: "MCP upstream is not configured" });
    return;
  }

  let upstreamUrl;
  try {
    const base = new URL(upstreamBase);
    if (base.protocol !== "https:" || base.username || base.password ||
        base.pathname !== "/" || base.search || base.hash) {
      throw new Error("MCP_UPSTREAM_URL must be an HTTPS origin without credentials, path, or query.");
    }
    upstreamUrl = new URL("/" + endpoint + incoming.search, base);
  } catch {
    res.status(500).json({ error: "Invalid MCP_UPSTREAM_URL configuration" });
    return;
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }

  try {
    const hasBody = !["GET", "HEAD"].includes(req.method || "GET");
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      ...(hasBody ? { duplex: "half" } : {})
    });

    const responseHeaders = {};
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }

    res.writeHead(upstream.status, responseHeaders);
    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
          await new Promise((resolve) => res.once("drain", resolve));
        }
      }
      res.end();
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    console.error("MCP upstream request failed:", error);
    if (!res.headersSent) {
      res.status(502).json({ error: "MCP upstream unavailable" });
    } else {
      res.destroy();
    }
  }
}
