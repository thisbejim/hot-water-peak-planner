# Hot Water Peak Planner

**Use it here: https://thisbejim.github.io/hot-water-peak-planner/**

Plan a household's hot-water routine against the size and recovery rate of a storage tank. Compare two setups using the same timed schedule, with the assumptions and heat-balance math visible.

## Why it exists

Households often compare tank sizes using a people-per-tank rule. That can hide when several long showers happen close together. This planner models the timing, duration and flow of each use, then shows the estimated tank reserve and any unmet demand for each system.

It is a scenario planner, not a product recommendation. It does not replace a licensed plumber's sizing assessment.

## Features

- Model up to 20 hot-water events, including overlapping use.
- Compare two storage tank sizes and water-heating output ratings.
- Adjust stored, incoming-cold and tap temperatures.
- See estimated tap-water capacity, routine demand, recovery and reserve after each event.
- Load example schedules, copy a summary, share scenario settings in a URL, or print the plan.
- Save settings in browser local storage.

## Privacy

All calculations happen in the browser. The project has no backend, account, analytics, advertising or third-party runtime dependencies. The browser stores the current scenario locally. A share link includes the scenario inputs in the URL; share it only with people you choose.

## Calculation limits

The planner estimates tank heat as a well-mixed volume. Real systems can behave differently because of tank stratification, first-hour delivery ratings, heat-pump operating conditions, pipe losses and plumbing layout. Recovery output should be taken from a product's water-heating specification, not its electrical input rating. Use `0 kW` if unknown. The 50°C model limit is for ordinary personal-hygiene scenarios; Australian requirements may vary by fixture and building. A licensed plumber should size and install the system.

## Development

Requirements: Node.js 20 or newer and Python 3 for a local static server. There are no package dependencies or build step.

```sh
npm test
npm run serve
```

Then open <http://localhost:4173/>. The production site is deployed from the `main` branch with the GitHub Pages workflow in `.github/workflows/pages.yml`.

## Sources

- [Victorian Energy Upgrades: Hot water system buyer's guide](https://www.energy.vic.gov.au/victorian-energy-upgrades/products/hot-water-system-discounts/hot-water-buyers-guide)
- [Australian Government: Hot water guidance](https://www.energy.gov.au/households/household-guides/life-stages-advice/renters)
- [National Construction Code: Heated water services](https://ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-three/b-water-services/part-b2-heated-water-services)

## License

MIT. See [`LICENSE`](LICENSE).
