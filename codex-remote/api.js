const CodexRemote = (() => {
  async function request(path, options = {}) {
    const settings = await chrome.storage.local.get(["serverUrl", "token"]);
    if (!settings.serverUrl || !settings.token) throw new Error("Configure the VPS URL and access token in extension settings.");
    const response = await fetch(settings.serverUrl.replace(/\/+$/, "") + path, {
      ...options,
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + settings.token, ...(options.headers || {})}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || ("Request failed (" + response.status + ")"));
    return data;
  }
  return {
    health: () => request("/api/health"),
    projects: () => request("/api/projects"),
    tasks: () => request("/api/tasks"),
    createTask: (projectId, prompt) => request("/api/tasks", {method:"POST",body:JSON.stringify({projectId,prompt})}),
    task: (id) => request("/api/tasks/" + encodeURIComponent(id)),
    diff: (id) => request("/api/tasks/" + encodeURIComponent(id) + "/diff"),
    push: (id) => request("/api/tasks/" + encodeURIComponent(id) + "/push", {method:"POST",body:"{}"})
  };
})();