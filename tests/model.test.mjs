import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PLAN, formatClock, hotWaterFraction, recoveryLitresPerHour, simulateSystem, validatePlan } from "../src/model.mjs";

function planWith(events, system = { id: "x", name: "Test tank", tankL: 200, heatKw: 0 }) {
  return { ...structuredClone(DEFAULT_PLAN), compare: false, systems: [system], events };
}

test("mixed outlet fraction follows the stored, cold and outlet temperatures", () => {
  assert.equal(hotWaterFraction({ storedC: 60, coldC: 15, outletC: 40 }), 25 / 45);
});

test("thermal recovery converts delivered heat to equivalent stored litres", () => {
  assert.ok(Math.abs(recoveryLitresPerHour(3, 60, 15) - 57.3) < 0.1);
  assert.equal(recoveryLitresPerHour(0, 60, 15), 0);
});

test("a full 200 L tank supplies 360 L at a 40 C outlet in the ideal mix model", () => {
  const plan = planWith([{ id: "one", name: "One shower", time: "07:00", minutes: 10, flowLpm: 9 }]);
  const result = simulateSystem(plan, plan.systems[0]);
  assert.equal(result.availableTapL, 360);
  assert.equal(result.totalDemandL, 90);
  assert.equal(result.totalShortfallL, 0);
  assert.ok(Math.abs(result.reserveEndL - 150) < 1e-9);
});

test("recovery between events is counted and tank reserve is capped at capacity", () => {
  const events = [
    { id: "a", name: "First", time: "07:00", minutes: 5, flowLpm: 9 },
    { id: "b", name: "Second", time: "08:00", minutes: 5, flowLpm: 9 },
  ];
  const system = { id: "x", name: "Test tank", tankL: 40, heatKw: 3 };
  const result = simulateSystem(planWith(events, system), system);
  assert.equal(result.totalShortfallL, 0);
  assert.equal(result.reserveEndL, 40);
  assert.equal(result.events[1].reserveStartL, 40);
});

test("simultaneous draws share available hot water proportionally", () => {
  const events = [
    { id: "a", name: "Shower A", time: "07:00", minutes: 10, flowLpm: 9 },
    { id: "b", name: "Shower B", time: "07:00", minutes: 10, flowLpm: 9 },
  ];
  const system = { id: "x", name: "Small tank", tankL: 40, heatKw: 0 };
  const result = simulateSystem(planWith(events, system), system);
  assert.equal(result.totalDemandL, 180);
  assert.ok(Math.abs(result.totalShortfallL - 108) < 1e-9);
  assert.ok(Math.abs(result.events[0].shortageL - 54) < 1e-9);
  assert.ok(Math.abs(result.events[1].shortageL - 54) < 1e-9);
});

test("invalid and unsafe scenario temperatures are rejected", () => {
  const plan = planWith([{ id: "a", name: "Shower", time: "07:00", minutes: 8, flowLpm: 9 }]);
  plan.temperatures.outletC = 55;
  assert.match(validatePlan(plan).join(" "), /50°C or below/);
  assert.throws(() => simulateSystem(plan, plan.systems[0]), /50°C or below/);
});

test("bad times, negative recovery and missing demand inputs are rejected", () => {
  const plan = planWith([{ id: "a", name: "Shower", time: "25:00", minutes: 8, flowLpm: 9 }]);
  plan.systems[0].heatKw = -1;
  assert.equal(validatePlan(plan).length, 2);
});

test("clock formatting handles midnight, ordinary time and missing values", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(7 * 60 + 5), "07:05");
  assert.equal(formatClock(null), "");
});
