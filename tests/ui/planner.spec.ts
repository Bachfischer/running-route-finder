import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const result = JSON.parse(
  readFileSync(
    new URL("../fixtures/munich-result.json", import.meta.url),
    "utf8",
  ),
);
async function choose(page: Page) {
  await page
    .getByRole("button", { name: "Try 10 km from Odeonsplatz" })
    .click();
}
async function mockRoutes(page: Page) {
  await page.route("**/api/loops", (route) => route.fulfill({ json: result }));
}
async function find(page: Page) {
  await page
    .getByRole("button", { name: "Find a running route", exact: true })
    .click();
  await expect(page.getByLabel("Route recommendation")).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  // No tile/provider dependency in repeatable UI tests; Leaflet itself is bundled.
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.goto("/");
});
test("initial state has no fabricated route and requires a start", async ({
  page,
}) => {
  await expect(
    page.getByRole("button", { name: "Find a running route", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download GPX" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Every good run starts somewhere." }),
  ).toBeVisible();
});
test("Munich example sets start, 10 km and north", async ({ page }) => {
  await choose(page);
  await expect(page.getByLabel("Starting point")).toHaveValue(
    "Odeonsplatz, Munich",
  );
  await expect(page.getByLabel("Target distance")).toHaveValue("10");
  await page.getByText("Direction: N", { exact: true }).click();
  await expect(page.getByLabel("Preferred direction")).toHaveValue("N");
  await expect(
    page.getByRole("button", { name: "Find a running route", exact: true }),
  ).toBeEnabled();
});
for (const value of ["", "1", "26"])
  test(`invalid distance ${value || "empty"} is explained`, async ({
    page,
  }) => {
    await choose(page);
    await page.getByLabel("Target distance").fill(value);
    await expect(
      page.getByRole("button", { name: "Find a running route", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Enter a distance between 2 and 25 km."),
    ).toBeVisible();
  });
test("distance controls clamp to supported range", async ({ page }) => {
  await page.getByLabel("Target distance").fill("25");
  await page.getByRole("button", { name: "Increase distance" }).click();
  await expect(page.getByLabel("Target distance")).toHaveValue("25");
  await page.getByLabel("Target distance").fill("2");
  await page.getByRole("button", { name: "Decrease distance" }).click();
  await expect(page.getByLabel("Target distance")).toHaveValue("2");
});
test("coordinate lookup works through the real Node.js API using keyboard", async ({
  page,
}) => {
  await page.getByLabel("Starting point").fill("48.142,11.577");
  await page.getByLabel("Starting point").press("Enter");
  await expect(page.getByText(/Start selected/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find a running route", exact: true }),
  ).toBeEnabled();
});
test("10 km result, green coverage, signals and explanation are displayed", async ({
  page,
}) => {
  await mockRoutes(page);
  await choose(page);
  await find(page);
  await expect(
    page.getByText(
      `${Math.round(result.routes[0].parks * 100)}% in mapped green spaces`,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      `${result.routes[0].trafficLights} mapped traffic-light encounters`,
    ),
  ).toBeVisible();
  await page.getByText("Why this loop?", { exact: true }).click();
  await expect(page.getByText(/We favor mapped parks/)).toBeVisible();
});
test("request carries selected inputs and prevents edits while loading", async ({
  page,
}) => {
  let release: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/loops", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      lat: 48.142,
      lon: 11.577,
      distance: 10,
      direction: "N",
    });
    await hold;
    await route.fulfill({ json: result });
  });
  await choose(page);
  await page
    .getByRole("button", { name: "Find a running route", exact: true })
    .click();
  await expect(page.getByLabel("Starting point")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Finding your loop…" }),
  ).toBeDisabled();
  release();
  await expect(page.getByLabel("Route recommendation")).toBeVisible();
  await expect(page.getByLabel("Starting point")).toBeEnabled();
});
test("provider failure is accessible and a retry can succeed", async ({
  page,
}) => {
  await page.route("**/api/loops", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "The map service is busy. Please retry later." },
    }),
  );
  await choose(page);
  await page
    .getByRole("button", { name: "Find a running route", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "map service is busy",
  );
  await mockRoutes(page);
  await find(page);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});
test("network failure releases controls", async ({ page }) => {
  await page.route("**/api/loops", (route) => route.abort());
  await choose(page);
  await page
    .getByRole("button", { name: "Find a running route", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Starting point")).toBeEnabled();
});

test("a route search can be cancelled without accepting a late response", async ({
  page,
}) => {
  let release!: () => void;
  await page.route("**/api/loops", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: result }).catch(() => {});
  });
  await choose(page);
  await page
    .getByRole("button", { name: "Find a running route", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel search" }),
  ).toBeVisible();
  await expect.poll(() => typeof release).toBe("function");
  await page.getByRole("button", { name: "Cancel search" }).click();
  await expect(page.getByLabel("Starting point")).toBeEnabled();
  release();
  await expect(page.getByLabel("Route recommendation")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "cancelled",
  );
});

test("gateway HTML errors release controls with a readable message", async ({
  page,
}) => {
  await page.route("**/api/loops", (route) =>
    route.fulfill({
      status: 504,
      contentType: "text/html",
      body: "<h1>Gateway timeout</h1>",
    }),
  );
  await choose(page);
  await page
    .getByRole("button", { name: "Find a running route", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "incomplete response",
  );
  await expect(page.getByLabel("Starting point")).toBeEnabled();
});

test("malformed successful route responses do not crash the planner", async ({
  page,
}) => {
  await page.route("**/api/loops", (route) =>
    route.fulfill({ json: { routes: [] } }),
  );
  await choose(page);
  await page
    .getByRole("button", { name: "Find a running route", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "invalid data",
  );
  await expect(page.getByLabel("Starting point")).toBeEnabled();
});
test("editing a start clears the previous recommendation", async ({ page }) => {
  await mockRoutes(page);
  await choose(page);
  await find(page);
  await page.getByLabel("Starting point").fill("Berlin");
  await expect(page.getByLabel("Route recommendation")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Find a running route", exact: true }),
  ).toBeEnabled();
});
test("changing distance or direction clears stale results", async ({
  page,
}) => {
  await mockRoutes(page);
  await choose(page);
  await find(page);
  await page.getByRole("button", { name: "5 km", exact: true }).click();
  await expect(page.getByLabel("Route recommendation")).toHaveCount(0);
  await find(page);
  await page.getByText("Direction: N", { exact: true }).click();
  await page.getByLabel("Preferred direction").selectOption("S");
  await expect(page.getByLabel("Route recommendation")).toHaveCount(0);
});
test("alternatives update selection and GPX exports the selected coordinates", async ({
  page,
}) => {
  await mockRoutes(page);
  await choose(page);
  await find(page);
  await page.getByText(/Compare .* alternatives/).click();
  await page.getByRole("button", { name: /Loop 2 ·/ }).click();
  await expect(page.getByText("ALTERNATIVE LOOP")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download GPX" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(
    `loop-${(result.routes[1].distance / 1000).toFixed(1)}km.gpx`,
  );
  const path = await file.path();
  const xml = readFileSync(path!, "utf8");
  expect((xml.match(/<trkpt /g) || []).length).toBe(
    result.routes[1].coordinates.length,
  );
  expect(xml).toContain(
    `lat="${result.routes[1].coordinates[0][1]}" lon="${result.routes[1].coordinates[0][0]}"`,
  );
});
test("map click sets a start", async ({ page }) => {
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await page.locator(".map").click({ position: { x: 100, y: 180 } });
  await expect(
    page.getByText("Start selected ·", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find a running route", exact: true }),
  ).toBeEnabled();
});
test("results do not cover the map and page has no horizontal overflow", async ({
  page,
}) => {
  await mockRoutes(page);
  await choose(page);
  await find(page);
  const map = await page.locator(".map-stage").boundingBox(),
    card = await page.getByLabel("Route recommendation").boundingBox();
  expect(card!.y).toBeGreaterThanOrEqual(map!.y + map!.height - 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("embedded planner hides surrounding website navigation", async ({
  page,
}) => {
  await page.goto("/?embed=1");
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Plan your run" }),
  ).toBeVisible();
});
for (const name of ["Running route finder", "Launch route finder"]) {
  test(`Projects integration launches the planner: ${name}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/projects/");
    await expect(
      page.getByRole("heading", { name: "Projects", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Plan your run" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const name of ["Running route finder", "Launch route finder"]) {
  test(`Projects launch works without JavaScript: ${name}`, async ({
    browser,
    baseURL,
    viewport,
    isMobile,
    hasTouch,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL,
      viewport,
      isMobile,
      hasTouch,
    });
    const page = await context.newPage();
    try {
      await page.goto("/projects/");
      await page.getByRole("link", { name, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Plan your run" }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test("default setup keeps optional direction out of the primary form", async ({
  page,
}) => {
  await expect(page.getByLabel("Target distance")).toHaveValue("10");
  await expect(page.getByLabel("Preferred direction")).toBeHidden();
  await page.getByText("Direction: best available", { exact: true }).click();
  await expect(page.getByLabel("Preferred direction")).toBeVisible();
});
test("one matching address needs only the find button", async ({ page }) => {
  await mockRoutes(page);
  await page.route("**/api/search?**", (route) =>
    route.fulfill({
      json: {
        places: [{ lat: 48.142, lon: 11.577, name: "Odeonsplatz, Munich" }],
      },
    }),
  );
  await page.getByLabel("Starting point").fill("Odeonsplatz Munich");
  await find(page);
  await expect(page.getByLabel("Starting point")).toHaveValue(
    "Odeonsplatz, Munich",
  );
  await expect(page.locator(".places")).toHaveCount(0);
});
test("ambiguous addresses require a deliberate location choice", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/loops", (route) => {
    calls++;
    return route.fulfill({ json: result });
  });
  await page.route("**/api/search?**", (route) =>
    route.fulfill({
      json: {
        places: [
          { lat: 48.142, lon: 11.577, name: "Munich center" },
          { lat: 48.2, lon: 11.6, name: "Munich north" },
        ],
      },
    }),
  );
  await page.getByLabel("Starting point").fill("Munich");
  await page
    .getByRole("button", { name: "Find a running route", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Munich center", exact: true }),
  ).toBeVisible();
  expect(calls).toBe(0);
  await page
    .getByRole("button", { name: "Munich center", exact: true })
    .click();
  await find(page);
  expect(calls).toBe(1);
});

test("standalone planner explains its purpose without blog navigation", async ({
  page,
}) => {
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Choose your starting point and distance/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find a running route", exact: true }),
  ).toBeVisible();
});
