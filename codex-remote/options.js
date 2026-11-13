const urlInput = document.getElementById("serverUrl");
const tokenInput = document.getElementById("token");
const result = document.getElementById("result");
chrome.storage.local.get(["serverUrl", "token"]).then((settings) => {
  urlInput.value = settings.serverUrl || ""; tokenInput.value = settings.token || "";
});
document.getElementById("save").addEventListener("click", async () => {
  const serverUrl = urlInput.value.trim().replace(/\/+$/, ""), token = tokenInput.value.trim();
  try {
    const url = new URL(serverUrl);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Use an HTTPS URL.");
    if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("HTTP is allowed only for localhost.");
    const granted = await chrome.permissions.request({origins:[url.origin + "/*"]});
    if (!granted) throw new Error("Chrome did not grant access to this server origin.");
    await chrome.storage.local.set({serverUrl, token});
    result.textContent = "Connection settings saved.";
  } catch (error) { result.textContent = error.message; }
});