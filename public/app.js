const $ = (id) => document.getElementById(id);

const STATUSES = ["New", "Contacted", "Interested", "Won", "Lost"];
const SOURCES = ["Website", "Referral", "LinkedIn", "Instagram", "Cold Call", "Email", "Other"];
const STATUS_COLORS = {
  New: "#c4b5fd",
  Contacted: "#93c5fd",
  Interested: "#fcd34d",
  Won: "#5eead4",
  Lost: "#fda4af"
};

const state = {
  view: "dashboard",
  leads: [],
  recent: [],
  followups: [],
  stats: null,
  loading: false,
  sort: "created_at",
  order: "desc",
  editingId: null,
  csrfToken: "",
  user: null
};

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 4200);
}

function setLoading(on) {
  state.loading = on;
  $("loadingBar").classList.toggle("show", on);
}

async function refreshCsrf() {
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.token) {
    throw new Error(payload?.error || "Could not load a security token.");
  }
  state.csrfToken = payload.token;
  return state.csrfToken;
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const retried = Boolean(options._retried);
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!state.csrfToken) await refreshCsrf();
    headers["x-csrf-token"] = state.csrfToken;
  }

  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error(payload?.error || "Please sign in.");
  }

  if (response.status === 403 && payload?.code === "csrf" && !retried) {
    await refreshCsrf();
    return api(path, { ...options, _retried: true });
  }

  if (!response.ok) {
    const message =
      payload?.error ||
      (payload?.errors ? payload.errors.join(" ") : null) ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

async function loadSession() {
  const payload = await api("/api/auth/me");
  state.user = payload.user;
  const chip = $("userChip");
  if (chip && state.user) {
    chip.textContent = state.user.name || state.user.email;
  }
  await refreshCsrf();
}

function findLead(id) {
  return (
    state.leads.find((item) => item.id === id) ||
    state.recent.find((item) => item.id === id) ||
    state.followups.find((item) => item.id === id)
  );
}

function currentFilters() {
  return {
    search: $("search").value.trim(),
    status: $("filterStatus").value,
    source: $("filterSource").value,
    followup: $("filterFollowup").value,
    sort: state.sort,
    order: state.order
  };
}

function queryString(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== "All" && value !== "all") params.set(key, value);
  });
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.order) params.set("order", filters.order);
  return params.toString();
}

async function loadAll() {
  setLoading(true);
  try {
    const filters = currentFilters();
    const qs = queryString(filters);
    const [statsRes, leadsRes, recentRes, followRes] = await Promise.all([
      api("/api/stats"),
      api(`/api/leads?${qs}`),
      api("/api/leads?sort=created_at&order=desc"),
      api("/api/leads?sort=followup_date&order=asc")
    ]);
    state.stats = statsRes.stats;
    state.leads = leadsRes.leads;
    state.recent = recentRes.leads;
    state.followups = followRes.leads;
    render();
  } catch (error) {
    toast(error.message, true);
    renderEmptyError(error.message);
  } finally {
    setLoading(false);
  }
}

function renderEmptyError(message) {
  $("rows").innerHTML = `<tr><td colspan="7" class="empty">${escapeHTML(message)}</td></tr>`;
  $("followupList").innerHTML = `<div class="empty">${escapeHTML(message)}</div>`;
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === `page-${view}`);
  });
  const titles = {
    dashboard: ["Dashboard", "Track your pipeline, follow-ups, and closed revenue."],
    leads: ["Leads", "Search, filter, and manage every prospect in PostgreSQL."],
    followups: ["Follow-ups", "See overdue, today, and upcoming reminders."]
  };
  $("pageTitle").textContent = titles[view][0];
  $("pageSubtitle").textContent = titles[view][1];
  $("sidebar").classList.remove("open");
}

function followupLabel(lead) {
  if (!lead.followup_date) return `<span class="followup">Not set</span>`;
  const label = formatDate(lead.followup_date);
  const stateName = lead.followup_state || "";
  const extra =
    stateName === "overdue" ? " · Overdue" : stateName === "today" ? " · Today" : "";
  return `<span class="followup ${escapeHTML(stateName)}">${escapeHTML(label + extra)}</span>`;
}

function leadRow(lead) {
  return `
    <tr>
      <td>
        <div class="person">${escapeHTML(lead.name)}</div>
        <div class="sub">${escapeHTML(lead.email || lead.phone || "No contact details")}</div>
      </td>
      <td>
        ${escapeHTML(lead.business)}
        <div class="sub">${escapeHTML(lead.source || "Unspecified source")}</div>
      </td>
      <td><span class="pill ${escapeHTML(lead.status)}">${escapeHTML(lead.status)}</span></td>
      <td>${money(lead.amount)}</td>
      <td>${followupLabel(lead)}</td>
      <td>${escapeHTML(formatDate(lead.created_at))}</td>
      <td>
        <div class="actions">
          <button class="small" data-view-lead="${escapeHTML(lead.id)}">View</button>
          <button class="small" data-edit="${escapeHTML(lead.id)}">Edit</button>
          <button class="small danger" data-delete="${escapeHTML(lead.id)}">Delete</button>
        </div>
      </td>
    </tr>
  `;
}

function renderStats() {
  const s = state.stats || {
    total_leads: 0,
    new_leads: 0,
    contacted_leads: 0,
    interested_leads: 0,
    won_deals: 0,
    lost_deals: 0,
    won_revenue: 0,
    pipeline_value: 0,
    overdue_followups: 0,
    today_followups: 0
  };

  $("statTotal").textContent = s.total_leads;
  $("statNew").textContent = s.new_leads;
  $("statContacted").textContent = s.contacted_leads;
  $("statInterested").textContent = s.interested_leads;
  $("statWon").textContent = s.won_deals;
  $("statLost").textContent = s.lost_deals;
  $("statRevenue").textContent = money(s.won_revenue);
  $("statPipeline").textContent = money(s.pipeline_value);
  $("statOverdue").textContent = s.overdue_followups;
  $("statToday").textContent = s.today_followups;
  $("count").textContent = `${state.leads.length} matching lead${state.leads.length === 1 ? "" : "s"}`;
}

function drawBarChart(canvas, items, colorFor) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width = canvas.clientWidth * 2;
  const height = canvas.height = canvas.clientHeight * 2;
  ctx.clearRect(0, 0, width, height);
  if (!items.length) {
    ctx.fillStyle = "#91a0b8";
    ctx.font = "28px Segoe UI";
    ctx.fillText("No data yet", 40, height / 2);
    return;
  }
  const max = Math.max(...items.map((item) => item.value), 1);
  const gap = 24;
  const barWidth = (width - gap * (items.length + 1)) / items.length;
  items.forEach((item, index) => {
    const barHeight = (item.value / max) * (height - 90);
    const x = gap + index * (barWidth + gap);
    const y = height - 50 - barHeight;
    ctx.fillStyle = colorFor(item, index);
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, barWidth, barHeight, 12);
    } else {
      ctx.rect(x, y, barWidth, barHeight);
    }
    ctx.fill();
    ctx.fillStyle = "#edf2fb";
    ctx.font = "24px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(String(item.value), x + barWidth / 2, y - 10);
    ctx.fillStyle = "#91a0b8";
    ctx.font = "22px Segoe UI";
    ctx.fillText(item.label, x + barWidth / 2, height - 16);
  });
}

function drawDonutChart(canvas, items) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width = canvas.clientWidth * 2;
  const height = canvas.height = canvas.clientHeight * 2;
  ctx.clearRect(0, 0, width, height);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const cx = width / 2;
  const cy = height / 2 - 10;
  const radius = Math.min(width, height) / 2.6;
  if (!total) {
    ctx.strokeStyle = "#263248";
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#91a0b8";
    ctx.font = "28px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("No leads yet", cx, cy);
    return;
  }
  let start = -Math.PI / 2;
  items.forEach((item) => {
    const slice = (item.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 36;
    ctx.arc(cx, cy, radius, start, start + slice);
    ctx.stroke();
    start += slice;
  });
  ctx.fillStyle = "#edf2fb";
  ctx.font = "bold 36px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText(String(total), cx, cy);
  ctx.fillStyle = "#91a0b8";
  ctx.font = "22px Segoe UI";
  ctx.fillText("leads", cx, cy + 28);
}

function renderCharts() {
  const stats = state.stats;
  if (!stats) return;
  const statusItems = STATUSES.map((status) => ({
    label: status,
    value: stats.by_status?.[status] || 0,
    color: STATUS_COLORS[status]
  }));
  drawDonutChart($("statusChart"), statusItems);
  $("statusLegend").innerHTML = statusItems
    .map((item) => `<span><span class="dot" style="background:${item.color}"></span>${item.label}</span>`)
    .join("");

  const sourceItems = (stats.by_source || []).map((row) => ({
    label: String(row.source).slice(0, 10),
    value: row.count
  }));
  drawBarChart($("sourceChart"), sourceItems, (_item, index) => {
    const colors = ["#5eead4", "#93c5fd", "#c4b5fd", "#fcd34d", "#fda4af", "#67e8f9", "#86efac"];
    return colors[index % colors.length];
  });
}

function renderTable() {
  if (!state.leads.length) {
    $("rows").innerHTML = `<tr><td colspan="7" class="empty">No leads match these filters. Click “Add Lead” to create one.</td></tr>`;
    return;
  }
  $("rows").innerHTML = state.leads.map(leadRow).join("");
}

function renderFollowups() {
  const open = state.followups.filter((lead) => !["Won", "Lost"].includes(lead.status));
  const groups = [
    { title: "Overdue", items: open.filter((lead) => lead.followup_state === "overdue") },
    { title: "Today", items: open.filter((lead) => lead.followup_state === "today") },
    { title: "Upcoming", items: open.filter((lead) => lead.followup_state === "upcoming") }
  ];
  const html = groups.map((group) => `
    <div class="card" style="margin-bottom:14px">
      <h2>${group.title} (${group.items.length})</h2>
      ${group.items.length ? `
        <div class="table-wrap" style="margin-top:12px">
          <table>
            <thead><tr><th>Contact</th><th>Business</th><th>Status</th><th>Follow-up</th><th></th></tr></thead>
            <tbody>
              ${group.items.map((lead) => `
                <tr>
                  <td>${escapeHTML(lead.name)}</td>
                  <td>${escapeHTML(lead.business)}</td>
                  <td><span class="pill ${escapeHTML(lead.status)}">${escapeHTML(lead.status)}</span></td>
                  <td>${followupLabel(lead)}</td>
                  <td><button class="small" data-edit="${escapeHTML(lead.id)}">Update</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>` : `<p class="empty">Nothing in this group.</p>`}
    </div>
  `).join("");
  $("followupList").innerHTML = html;
}

function renderDashboardPreview() {
  const recent = state.recent.slice(0, 6);
  $("recentRows").innerHTML = recent.length
    ? recent.map(leadRow).join("")
    : `<tr><td colspan="7" class="empty">Add your first lead to populate the dashboard.</td></tr>`;
}

function render() {
  renderStats();
  renderCharts();
  renderTable();
  renderFollowups();
  renderDashboardPreview();
}

function fillForm(lead) {
  $("leadForm").reset();
  $("formError").textContent = "";
  $("leadId").value = lead?.id || "";
  $("dialogTitle").textContent = lead ? "Edit lead" : "Add a lead";
  $("name").value = lead?.name || "";
  $("business").value = lead?.business || "";
  $("phone").value = lead?.phone || "";
  $("email").value = lead?.email || "";
  $("source").value = lead?.source || "";
  $("status").value = lead?.status || "New";
  $("amount").value = lead?.amount ?? 0;
  $("followup").value = lead?.followup_date || "";
  $("notes").value = lead?.notes || "";
}

function openForm(lead) {
  state.editingId = lead?.id || null;
  fillForm(lead);
  $("leadDialog").showModal();
}

function showLead(lead) {
  $("viewTitle").textContent = lead.name;
  $("viewBody").innerHTML = `
    <dl class="detail">
      <div><dt>Business</dt><dd>${escapeHTML(lead.business)}</dd></div>
      <div><dt>Phone</dt><dd>${escapeHTML(lead.phone || "—")}</dd></div>
      <div><dt>Email</dt><dd>${escapeHTML(lead.email || "—")}</dd></div>
      <div><dt>Source</dt><dd>${escapeHTML(lead.source || "—")}</dd></div>
      <div><dt>Status</dt><dd><span class="pill ${escapeHTML(lead.status)}">${escapeHTML(lead.status)}</span></dd></div>
      <div><dt>Estimated amount</dt><dd>${money(lead.amount)}</dd></div>
      <div><dt>Follow-up</dt><dd>${followupLabel(lead)}</dd></div>
      <div><dt>Created</dt><dd>${escapeHTML(formatDate(lead.created_at))}</dd></div>
      <div><dt>Notes</dt><dd>${escapeHTML(lead.notes || "No notes")}</dd></div>
    </dl>
  `;
  $("viewEdit").dataset.edit = lead.id;
  $("viewDialog").showModal();
}

function payloadFromForm() {
  return {
    name: $("name").value.trim(),
    business: $("business").value.trim(),
    phone: $("phone").value.trim(),
    email: $("email").value.trim(),
    source: $("source").value || null,
    status: $("status").value,
    amount: Number($("amount").value) || 0,
    notes: $("notes").value.trim(),
    followup_date: $("followup").value || null
  };
}

$("addBtn").addEventListener("click", () => openForm());
$("logoutBtn").addEventListener("click", async () => {
  $("logoutBtn").disabled = true;
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // Continue to login even if the session is already gone.
  }
  window.location.href = "/login";
});
$("cancelBtn").addEventListener("click", () => $("leadDialog").close());
$("closeView").addEventListener("click", () => $("viewDialog").close());
$("menuToggle").addEventListener("click", () => $("sidebar").classList.toggle("open"));

document.querySelectorAll(".nav").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

["search", "filterStatus", "filterSource", "filterFollowup"].forEach((id) => {
  $(id).addEventListener(id === "search" ? "input" : "change", () => {
    clearTimeout(loadAll.timer);
    loadAll.timer = setTimeout(loadAll, id === "search" ? 250 : 0);
  });
});

$("leadTableHead").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sort]");
  if (!button) return;
  const sort = button.dataset.sort;
  if (state.sort === sort) {
    state.order = state.order === "asc" ? "desc" : "asc";
  } else {
    state.sort = sort;
    state.order = sort === "name" || sort === "business" ? "asc" : "desc";
  }
  loadAll();
});

document.body.addEventListener("click", async (event) => {
  const viewBtn = event.target.closest("[data-view-lead]");
  const editBtn = event.target.closest("[data-edit]");
  const deleteBtn = event.target.closest("[data-delete]");

  if (viewBtn) {
    const lead = findLead(viewBtn.dataset.viewLead);
    if (lead) showLead(lead);
  }

  if (editBtn) {
    $("viewDialog").close();
    const lead = findLead(editBtn.dataset.edit);
    if (lead) openForm(lead);
  }

  if (deleteBtn) {
    const lead = findLead(deleteBtn.dataset.delete);
    if (!lead) return;
    $("deleteText").textContent = `Delete “${lead.name}” from ${lead.business}? This cannot be undone.`;
    $("confirmDelete").dataset.id = lead.id;
    $("deleteDialog").showModal();
  }
});

$("cancelDelete").addEventListener("click", () => $("deleteDialog").close());
$("confirmDelete").addEventListener("click", async () => {
  const id = $("confirmDelete").dataset.id;
  $("confirmDelete").disabled = true;
  try {
    await api(`/api/leads/${id}`, { method: "DELETE" });
    $("deleteDialog").close();
    toast("Lead deleted.");
    await loadAll();
  } catch (error) {
    toast(error.message, true);
  } finally {
    $("confirmDelete").disabled = false;
  }
});

$("leadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("formError").textContent = "";
  const payload = payloadFromForm();
  if (!payload.name || !payload.business) {
    $("formError").textContent = "Name and business are required.";
    return;
  }
  const id = $("leadId").value;
  const submit = $("saveBtn");
  submit.disabled = true;
  submit.textContent = "Saving…";
  try {
    if (id) {
      await api(`/api/leads/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Lead updated.");
    } else {
      await api("/api/leads", { method: "POST", body: JSON.stringify(payload) });
      toast("Lead added.");
    }
    $("leadDialog").close();
    await loadAll();
  } catch (error) {
    $("formError").textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = "Save Lead";
  }
});

window.addEventListener("resize", () => {
  if (state.stats) renderCharts();
});

setView("dashboard");
loadSession()
  .then(loadAll)
  .catch((error) => {
    toast(error.message, true);
  });
