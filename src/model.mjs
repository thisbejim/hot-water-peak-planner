export const DEFAULT_PLAN = Object.freeze({
  version: 1,
  temperatures: { storedC: 60, coldC: 15, outletC: 40 },
  systems: [
    { id: "a", name: "Current system", tankL: 160, heatKw: 2.4 },
    { id: "b", name: "Larger option", tankL: 270, heatKw: 3.0 },
  ],
  compare: true,
  events: [
    { id: "shower-1", name: "Shower 1", time: "06:30", minutes: 8, flowLpm: 8.5 },
    { id: "shower-2", name: "Shower 2", time: "06:40", minutes: 8, flowLpm: 8.5 },
    { id: "shower-3", name: "Shower 3", time: "06:50", minutes: 8, flowLpm: 8.5 },
    { id: "shower-4", name: "Shower 4", time: "07:00", minutes: 8, flowLpm: 8.5 },
    { id: "shower-5", name: "Shower 5", time: "07:10", minutes: 8, flowLpm: 8.5 },
  ],
});

export function hotWaterFraction({ storedC, coldC, outletC }) {
  return (outletC - coldC) / (storedC - coldC);
}

export function recoveryLitresPerHour(heatKw, storedC, coldC) {
  if (heatKw < 0 || storedC <= coldC) return 0;
  return (heatKw * 3600) / (4.186 * (storedC - coldC));
}

export function validatePlan(plan) {
  const errors = [];
  const temperatures = plan?.temperatures ?? {};
  const storedC = Number(temperatures.storedC);
  const coldC = Number(temperatures.coldC);
  const outletC = Number(temperatures.outletC);
  if (![storedC, coldC, outletC].every(Number.isFinite)) {
    errors.push("Enter valid numbers for all three water temperatures.");
  } else {
    if (storedC <= coldC) errors.push("Stored-water temperature must be warmer than the incoming cold water.");
    if (outletC <= coldC) errors.push("Tap temperature must be warmer than the incoming cold water.");
    if (outletC >= storedC) errors.push("Tap temperature must be cooler than the stored water.");
    if (outletC > 50) errors.push("Use a tap temperature of 50°C or below for this personal-hygiene scenario.");
  }

  const systems = Array.isArray(plan?.systems) ? plan.systems : [];
  if (!systems.length) errors.push("Add at least one storage system to compare.");
  systems.forEach((system, index) => {
    const tankL = Number(system.tankL);
    const heatKw = Number(system.heatKw);
    if (!system.name?.trim()) errors.push(`Give System ${index + 1} a name.`);
    if (!Number.isFinite(tankL) || tankL <= 0 || tankL > 2000) errors.push(`${system.name || `System ${index + 1}`} tank volume must be between 1 and 2,000 litres.`);
    if (!Number.isFinite(heatKw) || heatKw < 0 || heatKw > 50) errors.push(`${system.name || `System ${index + 1}`} heating output must be between 0 and 50 kW.`);
  });

  const events = Array.isArray(plan?.events) ? plan.events : [];
  if (!events.length) errors.push("Add at least one hot-water use to model.");
  if (events.length > 20) errors.push("Use up to 20 hot-water events in one day.");
  events.forEach((event, index) => {
    const minutes = Number(event.minutes);
    const flowLpm = Number(event.flowLpm);
    const match = /^(\d{2}):(\d{2})$/.exec(event.time || "");
    const timeValid = match && Number(match[1]) < 24 && Number(match[2]) < 60;
    if (!event.name?.trim()) errors.push(`Name hot-water event ${index + 1}.`);
    if (!timeValid) errors.push(`${event.name || `Event ${index + 1}`} needs a valid start time.`);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 360) errors.push(`${event.name || `Event ${index + 1}`} duration must be between 0 and 360 minutes.`);
    if (!Number.isFinite(flowLpm) || flowLpm <= 0 || flowLpm > 100) errors.push(`${event.name || `Event ${index + 1}`} flow must be between 0 and 100 litres per minute.`);
    if (timeValid && Number.isFinite(minutes) && Number(match[1]) * 60 + Number(match[2]) + minutes > 1440) errors.push(`${event.name || `Event ${index + 1}`} must finish before midnight.`);
  });
  return errors;
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function simulateSystem(plan, system) {
  const errors = validatePlan({ ...plan, systems: [system] });
  if (errors.length) throw new Error(errors.join(" "));

  const { storedC, coldC, outletC } = plan.temperatures;
  const tankL = Number(system.tankL);
  const hotFraction = hotWaterFraction(plan.temperatures);
  const recoveryLph = recoveryLitresPerHour(Number(system.heatKw), storedC, coldC);
  const events = plan.events
    .map((event) => ({ ...event, start: timeToMinutes(event.time), end: timeToMinutes(event.time) + Number(event.minutes) }))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const boundaries = new Set([0, ...events.flatMap((event) => [event.start, event.end])]);
  for (let minute = 1; minute < 1440; minute += 1) boundaries.add(minute);
  const times = [...boundaries].sort((a, b) => a - b);
  const stats = new Map(events.map((event) => [event.id, {
    event, litres: 0, shortageL: 0, reserveStartL: null, reserveEndL: null,
  }]));
  let reserveL = tankL;
  let maximumDrawdownL = 0;
  let totalDemandL = 0;
  let totalShortfallL = 0;
  let firstShortageAt = null;

  for (let index = 0; index < times.length - 1; index += 1) {
    const start = times[index];
    const end = times[index + 1];
    const durationMinutes = end - start;
    if (durationMinutes <= 0) continue;

    const active = events.filter((event) => event.start < end && event.end > start);
    for (const event of active) {
      const item = stats.get(event.id);
      if (item.reserveStartL === null) item.reserveStartL = reserveL;
      item.litres += Number(event.flowLpm) * durationMinutes;
    }

    const recoveredL = recoveryLph * durationMinutes / 60;
    reserveL = Math.min(tankL, reserveL + recoveredL);
    const demandByEvent = active.map((event) => ({
      event,
      tankLitres: Number(event.flowLpm) * durationMinutes * hotFraction,
      tapLitres: Number(event.flowLpm) * durationMinutes,
    }));
    const totalTankDemandL = demandByEvent.reduce((sum, item) => sum + item.tankLitres, 0);
    const suppliedTankLitres = Math.min(reserveL, totalTankDemandL);
    const supplyRatio = totalTankDemandL === 0 ? 1 : suppliedTankLitres / totalTankDemandL;

    for (const demand of demandByEvent) {
      const suppliedTapL = demand.tapLitres * supplyRatio;
      const shortageL = demand.tapLitres - suppliedTapL;
      const item = stats.get(demand.event.id);
      item.shortageL += shortageL;
      totalDemandL += demand.tapLitres;
      totalShortfallL += shortageL;
      if (shortageL > 0 && firstShortageAt === null) firstShortageAt = start;
    }

    reserveL = Math.max(0, reserveL - totalTankDemandL);
    maximumDrawdownL = Math.max(maximumDrawdownL, tankL - reserveL);
    for (const event of active) {
      if (event.end <= end) stats.get(event.id).reserveEndL = reserveL;
    }
  }

  for (const item of stats.values()) {
    if (item.reserveStartL === null) item.reserveStartL = tankL;
    if (item.reserveEndL === null) item.reserveEndL = reserveL;
  }

  return {
    systemId: system.id,
    tankL,
    heatKw: Number(system.heatKw),
    hotFraction,
    recoveryLph,
    availableTapL: tankL / hotFraction,
    totalDemandL,
    totalShortfallL,
    reserveEndL: reserveL,
    maximumDrawdownL,
    firstShortageAt,
    events: [...stats.values()].map(({ event, litres, shortageL, reserveStartL, reserveEndL }) => ({
      id: event.id,
      name: event.name,
      time: event.time,
      litres,
      shortageL,
      reserveStartL,
      reserveEndL,
    })),
  };
}

export function formatClock(minutes) {
  if (minutes === null || minutes === undefined) return "";
  const hours = Math.floor(minutes / 60) % 24;
  const mins = Math.floor(minutes % 60);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}
