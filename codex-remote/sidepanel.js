const $ = (id) => document.getElementById(id);
let selectedTask = null;
let pollHandle;
function notify(message) {
  $("notice").textContent = message;
  $("notice").classList.add("show");
  setTimeout(() => $("notice").classList.remove("show"), 4500);
}
function setConnection(ok, detail) {
  $("statusDot").className = "dot " + (ok ? "online" : "offline");
  $("connectionTitle").textContent = ok ? "VPS connected" : "VPS unavailable";
  $("connectionDetail").textContent = detail;
}
async function refreshAll() {
  try {
    const health = await CodexRemote.health();
    setConnection(true, health.codexVersion || "API responding");
    const [projectData, taskData] = await Promise.all([CodexRemote.projects(), CodexRemote.tasks()]);
    const previous = $("project").value;
    $("project").replaceChildren(...projectData.projects.map((project) => {
      const option = document.createElement("option");
      option.value = project.id; option.textContent = project.name; return option;
    }));
    if (projectData.projects.some((project) => project.id === previous)) $("project").value = previous;
    $("run").disabled = projectData.projects.length === 0;
    renderTasks(taskData.tasks);
    if (selectedTask) await openTask(selectedTask, false);
  } catch (error) {
    setConnection(false, error.message);
    $("run").disabled = true;
  }
}
function renderTasks(tasks) {
  $("taskCount").textContent = String(tasks.length);
  const root = $("tasks"); root.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "No tasks yet."; root.append(empty); return;
  }
  for (const task of tasks) {
    const button = document.createElement("button"); button.className = "task-card";
    const row = document.createElement("div"); row.className = "task-row";
    const name = document.createElement("span"); name.className = "task-name"; name.textContent = task.projectName || task.projectId;
    const state = document.createElement("span"); state.className = "state " + task.status; state.textContent = task.status;
    row.append(name, state);
    const sub = document.createElement("div"); sub.className = "task-sub"; sub.textContent = task.prompt.slice(0, 100);
    button.append(row, sub); button.addEventListener("click", () => openTask(task.id)); root.append(button);
  }
}
async function openTask(id, loadDiff = true) {
  selectedTask = id;
  const task = await CodexRemote.task(id);
  $("detail").classList.remove("hidden");
  $("detailTitle").textContent = task.projectName || task.projectId;
  $("detailMeta").textContent = task.status + " · " + new Date(task.createdAt).toLocaleString() + " · branch " + (task.branch || "preparing");
  $("taskLog").textContent = task.output || "Waiting for Codex output...";
  $("taskLog").scrollTop = $("taskLog").scrollHeight;
  $("push").disabled = task.status !== "completed" || task.pushed === true;
  $("push").textContent = task.pushed ? "Pushed to dev" : "Approve and push to dev";
  if (loadDiff) await loadTaskDiff();
}
async function loadTaskDiff() {
  if (!selectedTask) return;
  const result = await CodexRemote.diff(selectedTask);
  $("taskDiff").textContent = result.diff || "No tracked changes yet.";
}
$("run").addEventListener("click", async () => {
  const projectId = $("project").value, prompt = $("prompt").value.trim();
  if (!projectId || !prompt) return notify("Choose a repository and enter task instructions.");
  $("run").disabled = true; $("run").textContent = "Starting...";
  try {
    const result = await CodexRemote.createTask(projectId, prompt);
    $("prompt").value = ""; selectedTask = result.task.id;
    await refreshAll(); await openTask(selectedTask);
    notify("Codex task started on the VPS.");
  } catch (error) { notify(error.message); }
  finally { $("run").disabled = false; $("run").textContent = "Start Codex task"; }
});
$("push").addEventListener("click", async () => {
  if (!selectedTask || !confirm("Push this task's reviewed changes to the dev branch? This never force-pushes.")) return;
  $("push").disabled = true;
  try {
    const result = await CodexRemote.push(selectedTask);
    notify(result.message || "Changes pushed to dev.");
    await refreshAll(); await openTask(selectedTask);
  } catch (error) { notify(error.message); $("push").disabled = false; }
});
$("loadDiff").addEventListener("click", () => loadTaskDiff().catch((error) => notify(error.message)));
$("closeDetail").addEventListener("click", () => { selectedTask = null; $("detail").classList.add("hidden"); });
$("refresh").addEventListener("click", refreshAll);
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
refreshAll();
pollHandle = setInterval(refreshAll, 5000);
window.addEventListener("unload", () => clearInterval(pollHandle));