import { DEFAULT_PLAN, formatClock, simulateSystem, validatePlan } from "./model.mjs";

const STORAGE_KEY = "hot-water-peak-planner-v1";
const app = {
  plan: structuredClone(DEFAULT_PLAN),
  nextId: 6,
  statusTimer: null,
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const number = (value, digits = 0) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: digits }).format(value);
const round = (value, digits = 0) => Number(value.toFixed(digits));

function readSharedPlan() {
  const packed = new URLSearchParams(location.search).get("scenario");
  if (!packed) return null;
  try {
    const binary = atob(packed.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const candidate = JSON.parse(new TextDecoder().decode(bytes));
    if (candidate?.version !== 1 || validatePlan(candidate).length) return null;
    return candidate;
  } catch {
    return null;
  }
}

function restorePlan() {
  const shared = readSharedPlan();
  if (shared) return shared;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (stored?.version === 1 && validatePlan(stored).length === 0) return stored;
  } catch {
    // Private browsing settings may disable local storage; the planner still works for this tab.
  }
  return structuredClone(DEFAULT_PLAN);
}

function persistPlan() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.plan));
  } catch {
    // Persistence is optional; nothing is sent to a server.
  }
}

function showStatus(message) {
  const status = $("#action-status");
  status.textContent = message;
  clearTimeout(app.statusTimer);
  app.statusTimer = setTimeout(() => { status.textContent = ""; }, 4500);
}

function systemMarkup(system, index) {
  const title = index === 0 ? "System A" : "System B";
  return `<fieldset class="system-card" data-system="${escapeHtml(system.id)}">
    <legend class="system-legend"><span class="system-pill">${title}</span></legend>
    ${index === 1 ? '<button class="remove-system" type="button" data-remove-system aria-label="Remove System B">×</button>' : ""}
    <label class="field system-name"><span>Label this setup</span><input type="text" maxlength="32" data-system-field="name" value="${escapeHtml(system.name)}"></label>
    <div class="field-grid compact-fields">
      <label class="field"><span>Tank size</span><span class="input-wrap"><input type="number" min="1" max="2000" step="1" inputmode="decimal" data-system-field="tankL" value="${escapeHtml(system.tankL)}"><span>L</span></span></label>
      <label class="field"><span>Water-heating output</span><span class="input-wrap"><input type="number" min="0" max="50" step="0.1" inputmode="decimal" data-system-field="heatKw" value="${escapeHtml(system.heatKw)}"><span>kW</span></span></label>
    </div>
    <p class="system-help">Use thermal output to the water, if listed. Enter 0 when unknown.</p>
  </fieldset>`;
}

function renderSystems() {
  const systems = app.plan.compare ? app.plan.systems : app.plan.systems.slice(0, 1);
  $("#systems").innerHTML = systems.map(systemMarkup).join("");
  $("#compare-toggle").setAttribute("aria-pressed", String(app.plan.compare));
  $("#compare-toggle").textContent = app.plan.compare ? "✓ Comparing two systems" : "＋ Compare a second system";
}

function eventMarkup(event) {
  return `<div class="event-row" data-event="${escapeHtml(event.id)}">
    <label class="sr-only" for="event-name-${escapeHtml(event.id)}">Hot-water use name</label><input id="event-name-${escapeHtml(event.id)}" type="text" maxlength="32" data-event-field="name" value="${escapeHtml(event.name)}" aria-label="Hot-water use name">
    <label class="sr-only" for="event-time-${escapeHtml(event.id)}">Start time</label><input id="event-time-${escapeHtml(event.id)}" type="time" data-event-field="time" value="${escapeHtml(event.time)}" aria-label="Start time for ${escapeHtml(event.name)}">
    <label class="sr-only" for="event-duration-${escapeHtml(event.id)}">Duration in minutes</label><span class="input-wrap"><input id="event-duration-${escapeHtml(event.id)}" type="number" min="0.1" max="360" step="0.5" inputmode="decimal" data-event-field="minutes" value="${escapeHtml(event.minutes)}" aria-label="Duration in minutes for ${escapeHtml(event.name)}"><span>min</span></span>
    <label class="sr-only" for="event-flow-${escapeHtml(event.id)}">Flow rate in litres per minute</label><span class="input-wrap"><input id="event-flow-${escapeHtml(event.id)}" type="number" min="0.1" max="100" step="0.1" inputmode="decimal" data-event-field="flowLpm" value="${escapeHtml(event.flowLpm)}" aria-label="Flow rate in litres per minute for ${escapeHtml(event.name)}"><span>L/min</span></span>
    <button class="remove-event" type="button" data-remove-event aria-label="Remove ${escapeHtml(event.name)}">×</button>
  </div>`;
}

function renderEvents() {
  $("#events-list").innerHTML = app.plan.events.map(eventMarkup).join("");
  $("#routine-count").textContent = `${app.plan.events.length} ${app.plan.events.length === 1 ? "event" : "events"}`;
  $("#add-event").disabled = app.plan.events.length >= 20;
}

function resultCard(result, system, index, warning) {
  const shortage = result.totalShortfallL > 0.05;
  const classes = shortage ? "result-card result-short" : "result-card result-ok";
  const status = shortage ? "The schedule draws more than this model supplies" : "This schedule fits the modelled supply";
  const eventRows = result.events.map((event) => {
    const eventShort = event.shortageL > 0.05;
    const reservePct = Math.max(0, Math.min(100, (event.reserveEndL / result.tankL) * 100));
    return `<li class="event-result ${eventShort ? "event-result-short" : ""}">
      <div class="event-result-top"><span><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(event.time)} · ${number(event.litres, 0)} L requested</small></span><span class="event-reserve">${eventShort ? `${number(event.shortageL, 0)} L short` : `${number(event.reserveEndL, 0)} L in tank`}</span></div>
      <div class="reserve-track" aria-hidden="true"><span style="width:${reservePct}%"></span></div>
    </li>`;
  }).join("");
  const firstShortage = result.firstShortageAt === null ? "" : `<p class="shortage-note">First shortage appears around ${formatClock(result.firstShortageAt)} in this model.</p>`;
  return `<article class="${classes}" aria-labelledby="system-result-${index}">
    <div class="result-card-heading"><div><span class="system-pill">System ${index === 0 ? "A" : "B"}</span><h3 id="system-result-${index}">${escapeHtml(system.name)}</h3></div><span class="result-status" aria-label="${status}">${shortage ? "Needs attention" : "Within model"}</span></div>
    <p class="result-verdict">${status}</p>
    <div class="result-metrics">
      <div><span>Tap-water capacity*</span><strong>${number(result.availableTapL, 0)} <small>L</small></strong></div>
      <div><span>Routine demand</span><strong>${number(result.totalDemandL, 0)} <small>L</small></strong></div>
      <div><span>Unmet in model</span><strong>${number(result.totalShortfallL, 1)} <small>L</small></strong></div>
    </div>
    ${warning ? `<p class="temperature-warning">${warning}</p>` : ""}
    ${firstShortage}
    <h4 class="timeline-heading">Tank reserve after each use <span>${number(result.recoveryLph, 0)} L/h recovery estimate</span></h4>
    <ul class="event-results">${eventRows}</ul>
    <p class="result-footnote">*Estimated from a full tank and your selected tap temperature. ${number(result.heatKw, 1)} kW water-heating output entered.</p>
  </article>`;
}

function renderResults() {
  const errors = validatePlan(app.plan);
  const summary = $("#error-summary");
  if (errors.length) {
    summary.hidden = false;
    summary.innerHTML = `<strong>Check these inputs</strong><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>`;
    $("#results").innerHTML = `<div class="empty-result"><strong>Results paused</strong><span>Correct the highlighted settings to calculate this routine.</span></div>`;
    $("#quick-capacity").innerHTML = "— <small>L</small>";
    $("#quick-detail").textContent = "Fix the inputs below to calculate capacity.";
    return;
  }

  summary.hidden = true;
  summary.textContent = "";
  const { storedC, coldC, outletC } = app.plan.temperatures;
  const fraction = (outletC - coldC) / (storedC - coldC);
  const primary = app.plan.systems[0];
  const capacity = Number(primary.tankL) / fraction;
  $("#quick-capacity").innerHTML = `${number(capacity, 0)} <small>L</small>`;
  $("#quick-detail").textContent = `from ${number(primary.tankL)} L stored at ${number(storedC)}°C, mixed to ${number(outletC)}°C`;

  const warning = storedC < 60 ? "Australian guidance recommends a 60°C storage setting. Ask a licensed plumber to set and check your system." : "";
  const systems = app.plan.compare ? app.plan.systems : app.plan.systems.slice(0, 1);
  $("#results").innerHTML = systems.map((system, index) => resultCard(simulateSystem(app.plan, system), system, index, warning)).join("");
}

function render() {
  renderSystems();
  renderEvents();
  renderResults();
  persistPlan();
}

function updateSystem(event) {
  const card = event.target.closest("[data-system]");
  const field = event.target.dataset.systemField;
  if (!card || !field) return;
  const system = app.plan.systems.find((item) => item.id === card.dataset.system);
  if (!system) return;
  system[field] = field === "name" ? event.target.value : event.target.value === "" ? "" : Number(event.target.value);
  renderResults();
  persistPlan();
}

function updateEvent(event) {
  const row = event.target.closest("[data-event]");
  const field = event.target.dataset.eventField;
  if (!row || !field) return;
  const item = app.plan.events.find((entry) => entry.id === row.dataset.event);
  if (!item) return;
  item[field] = ["minutes", "flowLpm"].includes(field) ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value;
  renderResults();
  persistPlan();
}

function loadPreset(name) {
  const presets = {
    family: [
      ["Shower 1", "06:30", 8, 8.5], ["Shower 2", "06:40", 8, 8.5], ["Shower 3", "06:50", 8, 8.5], ["Shower 4", "07:00", 8, 8.5], ["Shower 5", "07:10", 8, 8.5],
    ],
    rush: [
      ["Ensuite shower", "07:00", 10, 9], ["Main bathroom shower", "07:00", 10, 9],
    ],
    spread: [
      ["Morning shower", "07:00", 9, 8.5], ["Dishwashing", "13:00", 6, 5], ["Evening shower", "20:00", 9, 8.5],
    ],
  };
  app.plan.events = presets[name].map(([eventName, time, minutes, flowLpm], index) => ({
    id: `event-${Date.now()}-${index}`,
    name: eventName,
    time,
    minutes,
    flowLpm,
  }));
  renderEvents();
  renderResults();
  persistPlan();
}

function encodeScenario() {
  const bytes = new TextEncoder().encode(JSON.stringify(app.plan));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildSummary() {
  const plan = app.plan;
  const systems = plan.compare ? plan.systems : plan.systems.slice(0, 1);
  const { storedC, coldC, outletC } = plan.temperatures;
  const lines = [
    `Hot Water Peak Planner · ${plan.events.length} daily hot-water ${plan.events.length === 1 ? "event" : "events"}`,
    `Temperatures: stored ${storedC}°C · cold ${coldC}°C · tap ${outletC}°C`,
  ];
  for (const system of systems) {
    const result = simulateSystem(plan, system);
    lines.push(`${system.name}: ${system.tankL} L tank · ${system.heatKw} kW heat output · ${number(result.availableTapL, 0)} L estimated tap capacity · ${number(result.totalDemandL, 0)} L routine demand · ${number(result.totalShortfallL, 1)} L unmet in model`);
  }
  lines.push("Model estimate only; a licensed plumber should size and install a system.");
  return lines.join("\n");
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showStatus(successMessage);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.append(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();
    showStatus(copied ? successMessage : "Copy failed. You can select and copy the result text manually.");
  }
}

$("#systems").addEventListener("input", updateSystem);
$("#systems").addEventListener("change", updateSystem);
$("#systems").addEventListener("click", (event) => {
  if (!event.target.closest("[data-remove-system]")) return;
  app.plan.compare = false;
  render();
});
$("#events-list").addEventListener("input", updateEvent);
$("#events-list").addEventListener("change", updateEvent);
$("#events-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-event]");
  if (!button) return;
  app.plan.events = app.plan.events.filter((item) => item.id !== button.closest("[data-event]").dataset.event);
  renderEvents();
  renderResults();
  persistPlan();
});

for (const id of ["stored-temp", "cold-temp", "outlet-temp"]) {
  $(`#${id}`).addEventListener("input", (event) => {
    const field = { "stored-temp": "storedC", "cold-temp": "coldC", "outlet-temp": "outletC" }[id];
    app.plan.temperatures[field] = event.target.value === "" ? "" : Number(event.target.value);
    renderResults();
    persistPlan();
  });
}

$("#compare-toggle").addEventListener("click", () => {
  app.plan.compare = !app.plan.compare;
  if (app.plan.compare && app.plan.systems.length < 2) {
    app.plan.systems.push({ id: "b", name: "Larger option", tankL: 270, heatKw: 3.0 });
  }
  render();
});
$("#add-event").addEventListener("click", () => {
  const id = `event-${Date.now()}-${app.nextId++}`;
  app.plan.events.push({ id, name: "New hot-water use", time: "08:00", minutes: 5, flowLpm: 6 });
  renderEvents();
  renderResults();
  persistPlan();
  $(`#event-name-${CSS.escape(id)}`).focus();
});
$("#routine-preset").addEventListener("change", (event) => loadPreset(event.target.value));
$("#reset-button").addEventListener("click", () => {
  app.plan = structuredClone(DEFAULT_PLAN);
  $("#routine-preset").value = "family";
  render();
  showStatus("Example restored.");
});
$("#copy-summary").addEventListener("click", () => copyText(buildSummary(), "Scenario summary copied."));
$("#copy-link").addEventListener("click", () => {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("scenario", encodeScenario());
  copyText(url.toString(), "Share link copied. It contains this scenario’s settings.");
});
$("#print-button").addEventListener("click", () => window.print());
$("#math-toggle").addEventListener("click", (event) => {
  const details = $("#math-details");
  const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
  event.currentTarget.setAttribute("aria-expanded", String(!expanded));
  event.currentTarget.textContent = expanded ? "Show the calculation" : "Hide the calculation";
  details.hidden = expanded;
});

app.plan = restorePlan();
$("#stored-temp").value = app.plan.temperatures.storedC;
$("#cold-temp").value = app.plan.temperatures.coldC;
$("#outlet-temp").value = app.plan.temperatures.outletC;
render();

if (new URLSearchParams(location.search).has("scenario")) {
  showStatus(readSharedPlan() ? "Shared scenario loaded. Inputs stay on this device." : "That share link was invalid; the saved local scenario was loaded instead.");
  history.replaceState(null, "", location.pathname);
}
