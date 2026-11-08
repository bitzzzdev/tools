const button = document.getElementById("export");
const status = document.getElementById("status");
const formatSelect = document.getElementById("format");

function safeName(value) {
  return (value || "ai-chat").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 90) || "ai-chat";
}
function download(content, filename, type) {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function markdownToHtml(md) {
  // The generated print document uses escaped plain text, so conversation content cannot inject markup.
  return md.split("\n").map(line => {
    if (/^### /.test(line)) return `<h3>${esc(line.slice(4))}</h3>`;
    if (/^## /.test(line)) return `<h2>${esc(line.slice(3))}</h2>`;
    if (/^# /.test(line)) return `<h1>${esc(line.slice(2))}</h1>`;
    if (/^---+$/.test(line)) return "<hr>";
    if (/^[-*] /.test(line)) return `<p class="list">• ${esc(line.slice(2))}</p>`;
    if (/^> /.test(line)) return `<blockquote>${esc(line.slice(2))}</blockquote>`;
    if (!line.trim()) return "<div class='space'></div>";
    return `<p>${esc(line)}</p>`;
  }).join("");
}
function toMarkdown(chat) {
  const out = [`# ${chat.title}`, "", `Source: ${chat.url}`, `Exported: ${chat.exportedAt}`, ""];
  for (const m of chat.messages) {
    out.push(`## ${m.role}`, "", m.text, "", "---", "");
  }
  return out.join("\n");
}
function toText(chat) {
  return `${chat.title}\n${"=".repeat(Math.min(chat.title.length, 70))}\nSource: ${chat.url}\nExported: ${chat.exportedAt}\n\n` +
    chat.messages.map(m => `${m.role.toUpperCase()}\n${m.text}`).join("\n\n" + "-".repeat(50) + "\n\n");
}
button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Scanning and loading all conversation messages from DOM…";
  let printWindow = null;
  const format = formatSelect.value;
  if (format === "pdf") printWindow = window.open("", "_blank");
  try {
    const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
    if (!tab?.id) throw new Error("Could not identify the active tab.");
    await chrome.scripting.executeScript({target:{tabId:tab.id}, files:["content.js"]});
    const response = await chrome.tabs.sendMessage(tab.id, {type:"AI_CHAT_EXPORT", autoLoad:true});
    if (!response?.ok) throw new Error(response?.error || "No conversation was detected.");
    const chat = response.chat;
    const stem = safeName(chat.title);
    if (format === "json") download(JSON.stringify(chat, null, 2), `${stem}.json`, "application/json");
    else if (format === "txt") download(toText(chat), `${stem}.txt`, "text/plain;charset=utf-8");
    else if (format === "md") download(toMarkdown(chat), `${stem}.md`, "text/markdown;charset=utf-8");
    else {
      if (!printWindow) throw new Error("The print window was blocked. Allow pop-ups and try again.");
      const md = toMarkdown(chat);
      printWindow.document.open();
      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(chat.title)}</title><style>
        body{font:14px/1.65 system-ui,sans-serif;max-width:850px;margin:40px auto;padding:0 28px;color:#171717}
        h1{font-size:25px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px;text-transform:capitalize}
        p{white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0}.space{height:8px}blockquote{border-left:3px solid #aaa;padding-left:12px;color:#555}
        .meta{color:#666;font-size:12px;margin-bottom:28px}.list{padding-left:14px}
        @media print{body{margin:0;max-width:none;padding:0 12mm}h2{break-after:avoid}p,blockquote{orphans:3;widows:3}}
      </style></head><body><h1>${esc(chat.title)}</h1><div class="meta">${esc(chat.url)}<br>Exported ${esc(chat.exportedAt)}</div>${markdownToHtml(md.replace(/^# .*\\n\\n/, ""))}<script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></body></html>`);
      printWindow.document.close();
    }
    status.textContent = `Exported ${chat.messages.length} messages from ${chat.site}.`;
  } catch (error) {
    if (printWindow && !printWindow.closed) printWindow.close();
    status.textContent = error.message || "Export failed.";
  } finally {
    button.disabled = false;
  }
});