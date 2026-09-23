"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Map as LeafletMap, LayerGroup, LeafletMouseEvent } from "leaflet";
import {
  ArrowUpRight,
  LocateFixed,
  MapPin,
  Route,
  Download,
  Plus,
  Minus,
  Navigation,
  LoaderCircle,
  ArrowRight,
  Flag,
  Compass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toGpx } from "@/lib/gpx";
import { SiteFooter } from "@/components/site-header";
import type { LoopResult } from "@/lib/routing";
import { requestJson } from "@/lib/client-api";
type Place = { lat: number; lon: number; name: string };
const directions = ["Any", "N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compassPoints = [
  { value: "NW", label: "Northwest" },
  { value: "N", label: "North" },
  { value: "NE", label: "Northeast" },
  { value: "W", label: "West" },
  { value: "Any", label: "Best available" },
  { value: "E", label: "East" },
  { value: "SW", label: "Southwest" },
  { value: "S", label: "South" },
  { value: "SE", label: "Southeast" },
];
export default function Home() {
  const [query, setQuery] = useState(""),
    [place, setPlace] = useState<Place | null>(null),
    [places, setPlaces] = useState<Place[]>([]),
    [distance, setDistance] = useState("10"),
    [direction, setDirection] = useState("Any"),
    [busy, setBusy] = useState(false),
    [searching, setSearching] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<LoopResult | null>(null),
    [selected, setSelected] = useState(0),
    [mapReady, setMapReady] = useState(0),
    [mapError, setMapError] = useState(false);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const embedded = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("embed") === "1",
    () => false,
  );
  const mapRef = useRef<LeafletMap | null>(null),
    layerRef = useRef<LayerGroup | null>(null),
    host = useRef<HTMLDivElement>(null),
    request = useRef(0),
    searchController = useRef<AbortController | null>(null),
    routeController = useRef<AbortController | null>(null),
    busyRef = useRef(false),
    leaflet = useRef<typeof import("leaflet") | null>(null),
    resultsRef = useRef<HTMLDivElement>(null);
  const chosen = result?.routes[selected];
  useEffect(() => {
    let alive = true;
    let instance: LeafletMap | null = null;
    import("leaflet")
      .then((L) => {
        if (!alive || !host.current) return;
        leaflet.current = L;
        const map = L.map(host.current, { zoomControl: false }).setView(
          [48.151, 11.592],
          13,
        );
        instance = map;
        mapRef.current = map;
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        }).addTo(map);
        map.on("click", (e: LeafletMouseEvent) => {
          if (busyRef.current) return;
          request.current++;
          searchController.current?.abort();
          setPlace({
            lat: e.latlng.lat,
            lon: e.latlng.lng,
            name: "Pinned location",
          });
          setQuery(`${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`);
          setPlaces([]);
          setSearching(false);
          setResult(null);
          setError("");
        });
        setMapReady((version) => version + 1);
      })
      .catch(() => {
        if (alive) setMapError(true);
      });
    return () => {
      // This is a request sequence counter, not a DOM ref; invalidate every
      // pending response when the component unmounts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      request.current++;
      searchController.current?.abort();
      routeController.current?.abort();
      alive = false;
      instance?.remove();
      if (mapRef.current === instance) {
        mapRef.current = null;
        layerRef.current = null;
        leaflet.current = null;
      }
    };
  }, []);
  useEffect(() => {
    if (!mapReady || !mapRef.current || !leaflet.current) return;
    const L = leaflet.current!,
      map = mapRef.current!;
    map.invalidateSize();
    layerRef.current?.remove();
    const group = L.layerGroup().addTo(map);
    layerRef.current = group;
    if (chosen) {
      L.polyline(
        chosen.coordinates.map((c) => [c[1], c[0]]),
        { color: "#fff", weight: 9, opacity: 0.95 },
      ).addTo(group);
      const line = L.polyline(
        chosen.coordinates.map((c) => [c[1], c[0]]),
        { color: "#39829a", weight: 5 },
      ).addTo(group);
      map.fitBounds(line.getBounds(), { padding: [65, 65] });
    }
    const start = chosen
      ? { lat: chosen.coordinates[0][1], lon: chosen.coordinates[0][0] }
      : place;
    if (start) {
      L.circleMarker([start.lat, start.lon], {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: "#494e52",
        fillOpacity: 1,
      })
        .addTo(group)
        .bindTooltip("Start / finish");
      if (!chosen) map.setView([start.lat, start.lon], 14);
    }
  }, [place, chosen, mapReady]);
  useEffect(() => {
    if (result) {
      resultsRef.current?.focus({ preventScroll: true });
      if (window.matchMedia("(max-width: 760px)").matches)
        resultsRef.current?.scrollIntoView({
          behavior: "instant",
          block: "nearest",
        });
    }
  }, [result]);
  async function search() {
    if (query.trim().length < 3) return;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    const id = ++request.current;
    setSearching(true);
    setError("");
    try {
      const data = await requestJson<{ places: Place[] }>(
        "/api/search?q=" + encodeURIComponent(query),
        { signal: controller.signal },
      );
      if (id !== request.current) return;
      if (
        !Array.isArray(data.places) ||
        !data.places.every(
          (p) =>
            typeof p?.name === "string" &&
            Number.isFinite(p.lat) &&
            Number.isFinite(p.lon),
        )
      )
        throw Error(
          "The location service returned invalid data. Please try again.",
        );
      if (data.places.length === 1) {
        const match = data.places[0];
        setPlace(match);
        setQuery(match.name);
        setPlaces([]);
        setResult(null);
        return match;
      }
      setPlaces(data.places);
      if (!data.places.length)
        setError(
          "No locations found. Try a city and street, or pin a point on the map.",
        );
    } catch (e) {
      if (id === request.current && !controller.signal.aborted)
        setError((e as Error).message);
    } finally {
      if (id === request.current) setSearching(false);
    }
  }
  function locate() {
    if (!navigator.geolocation) {
      setError(
        "Location is unavailable. Search for an address or tap the map.",
      );
      return;
    }
    setError("");
    const id = ++request.current;
    setSearching(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (id !== request.current) return;
        setPlaces([]);
        const next = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          name: "Current location",
        };
        setPlace(next);
        setQuery(next.name);
        setResult(null);
        setSearching(false);
      },
      () => {
        if (id !== request.current) return;
        setSearching(false);
        setError(
          "Could not access your location. Search for an address or tap the map.",
        );
      },
      { timeout: 12000, maximumAge: 60000 },
    );
  }
  async function find() {
    if (busyRef.current) return;
    const start = place ?? (await search());
    if (!start || busyRef.current) return;
    const controller = new AbortController();
    routeController.current = controller;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const data = await requestJson<LoopResult>(
        "/api/loops",
        {
          signal: controller.signal,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...start,
            distance: Number(distance),
            direction,
          }),
        },
        150000,
      );
      if (controller.signal.aborted) return;
      if (
        !Array.isArray(data.routes) ||
        !data.routes.length ||
        data.routes.some(
          (r) =>
            !Number.isFinite(r.distance) ||
            !Array.isArray(r.coordinates) ||
            r.coordinates.length < 2 ||
            !r.coordinates.every(
              (c) =>
                Array.isArray(c) &&
                c.length === 2 &&
                c.every(Number.isFinite) &&
                Math.abs(c[0]) <= 180 &&
                Math.abs(c[1]) <= 85,
            ) ||
            ![
              r.parks,
              r.paths,
              r.repeat,
              r.steps,
              r.trafficLights,
              r.crossings,
              r.barriers,
              r.railwayCrossings,
            ].every(Number.isFinite),
        )
      )
        throw Error(
          "The route service returned invalid data. Please try again.",
        );
      setResult(data);
      setSelected(0);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(
        (e as Error).message || "Could not find a route. Please try again.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function download() {
    if (!chosen) return;
    const xml = toGpx(chosen.coordinates);
    const url = URL.createObjectURL(
      new Blob([xml], { type: "application/gpx+xml" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `loop-${(chosen.distance / 1000).toFixed(1)}km.gpx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className={embedded ? "app embedded" : "app"}>
      {!embedded && (
        <>
          <div className="project-heading">
            <div className="heading-kicker">
              <Compass size={15} /> THE RUNNING ROUTE FINDER
            </div>
            <h1>Running route finder</h1>
            <p>
              A better way out the door. Find a loop from wherever you are, with
              more green space and fewer interruptions along the way.
            </p>
          </div>
        </>
      )}
      <div className="workspace">
        <aside className="sidebar">
          <div className="intro">
            <span className="intro-kicker">YOUR ROUTE, YOUR WAY</span>
            <h2>Plan your run</h2>
            <p>
              Set your start, pick a distance, and head in a direction you like.
            </p>
          </div>
          <div className="form">
            <fieldset disabled={busy || !hydrated}>
              <label htmlFor="location" className="field-label">
                <span className="step-number">01</span> Starting point
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  search();
                }}
                className="location-search"
              >
                <MapPin size={18} />
                <Input
                  id="location"
                  placeholder="Address, place, or coordinates"
                  value={query}
                  onChange={(e) => {
                    request.current++;
                    searchController.current?.abort();
                    setSearching(false);
                    setError("");
                    setQuery(e.target.value);
                    setPlace(null);
                    setPlaces([]);
                    setResult(null);
                  }}
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon"
                  aria-label="Search location"
                  disabled={searching || query.trim().length < 3}
                >
                  {searching ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <ArrowRight />
                  )}
                </Button>
              </form>
              {places.length > 0 && (
                <ul className="places">
                  {places.map((p, i) => (
                    <li key={i}>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          request.current++;
                          searchController.current?.abort();
                          setSearching(false);
                          setError("");
                          setPlace(p);
                          setQuery(p.name);
                          setPlaces([]);
                          setResult(null);
                        }}
                      >
                        {p.name}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                variant="ghost"
                className="locate"
                onClick={locate}
                disabled={searching}
              >
                <LocateFixed size={16} /> Use my location
              </Button>
              <Button
                variant="ghost"
                className="example-start"
                onClick={() => {
                  request.current++;
                  searchController.current?.abort();
                  setSearching(false);
                  setPlace({
                    lat: 48.142,
                    lon: 11.577,
                    name: "Odeonsplatz, Munich",
                  });
                  setQuery("Odeonsplatz, Munich");
                  setPlaces([]);
                  setDistance("10");
                  setDirection("N");
                  setResult(null);
                  setError("");
                }}
              >
                Try 10 km from Odeonsplatz
              </Button>
              {place && (
                <p className="selected-start">Start selected · {place.name}</p>
              )}
              <div className="distance-label">
                <label htmlFor="distance" className="field-label">
                  <span className="step-number">02</span> Target distance
                </label>
                <span>2–25 km</span>
              </div>
              <div className="distance-control">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Decrease distance"
                  onClick={() => {
                    setDistance(String(Math.max(2, Number(distance) - 1)));
                    setResult(null);
                  }}
                >
                  <Minus />
                </Button>
                <div>
                  <Input
                    id="distance"
                    type="number"
                    aria-invalid={Number(distance) < 2 || Number(distance) > 25}
                    aria-describedby="distance-help"
                    min="2"
                    max="25"
                    step="0.5"
                    value={distance}
                    onChange={(e) => {
                      setDistance(e.target.value);
                      setResult(null);
                    }}
                  />
                  <span>km</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Increase distance"
                  onClick={() => {
                    setDistance(String(Math.min(25, Number(distance) + 1)));
                    setResult(null);
                  }}
                >
                  <Plus />
                </Button>
              </div>
              <p id="distance-help" className="field-hint">
                {Number(distance) < 2 || Number(distance) > 25
                  ? "Enter a distance between 2 and 25 km."
                  : "Parks and fewer interruptions, always preferred."}
              </p>
              <div className="presets">
                {[3, 5, 10, 21.1].map((k) => (
                  <Button
                    key={k}
                    variant="outline"
                    aria-pressed={Number(distance) === k}
                    onClick={() => {
                      setDistance(String(k));
                      setResult(null);
                    }}
                  >
                    {k} km
                  </Button>
                ))}
              </div>
              <div className="direction-options">
                <div className="field-label" id="direction-label">
                  <span className="step-number">03</span> Preferred direction
                  <span className="optional">Optional</span>
                </div>
                <div className="compass-layout">
                  <div
                    className="compass"
                    role="group"
                    aria-labelledby="direction-label"
                  >
                    {compassPoints.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        className={
                          value === "Any" ? "compass-center" : "compass-point"
                        }
                        aria-label={label}
                        aria-pressed={direction === value}
                        onClick={() => {
                          setDirection(value);
                          setResult(null);
                        }}
                      >
                        {value === "Any" ? (
                          <Compass size={21} strokeWidth={1.8} />
                        ) : (
                          value
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="compass-copy">
                    <strong>
                      {direction === "Any"
                        ? "Anywhere is good"
                        : `Head ${compassPoints.find((point) => point.value === direction)?.label.toLowerCase()}`}
                    </strong>
                    <span>
                      {direction === "Any"
                        ? "We'll find the best loop around your start."
                        : "We'll look for a loop on this side of your start."}
                    </span>
                  </div>
                </div>
              </div>
            </fieldset>
            <Button
              className="find-button"
              onClick={find}
              disabled={
                busy ||
                searching ||
                (!place && query.trim().length < 3) ||
                !Number.isFinite(Number(distance)) ||
                Number(distance) < 2 ||
                Number(distance) > 25
              }
            >
              {busy ? (
                <>
                  <LoaderCircle className="spin" />
                  Finding your loop…
                </>
              ) : (
                <>
                  Find a running route <ArrowUpRight size={20} />
                </>
              )}
            </Button>
            {busy && (
              <Button
                variant="ghost"
                onClick={() => {
                  routeController.current?.abort();
                  setError(
                    "Route search cancelled. You can change your start or distance and try again.",
                  );
                }}
              >
                Cancel search
              </Button>
            )}
            <div aria-live="polite">
              {result && (
                <p className="sr-only">
                  Found {result.routes.length} loops. Best match{" "}
                  {(result.routes[0].distance / 1000).toFixed(2)} kilometers.
                </p>
              )}
              {busy && (
                <p className="status">
                  Looking for park paths with fewer stops. This can take up to
                  two minutes.
                </p>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
            </div>
          </div>
          <div className="sidebar-footer">
            <Route size={17} />
            <span>Real paths. A finish where you started.</span>
          </div>
        </aside>
        <section
          className="map-panel"
          aria-label="Running route map"
          aria-busy={busy}
        >
          <div className="map-stage">
            <div ref={host} className="map" />
            {mapError && (
              <div className="map-error">
                Map could not load. You can still search for a location and
                export your route.
              </div>
            )}
            <div className="map-label">
              <MapPin size={15} />
              {place ? "Your starting point" : "Explore the map"}
              <span> / </span>
              {chosen ? "Your loop" : "Click the map to set a start"}
            </div>
            <div className="map-controls">
              <Button
                variant="outline"
                size="icon"
                aria-label="Zoom in"
                onClick={() => mapRef.current?.zoomIn()}
              >
                <Plus />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Zoom out"
                onClick={() => mapRef.current?.zoomOut()}
              >
                <Minus />
              </Button>
            </div>
            <div className="north">
              <Navigation size={19} />
              <span>N</span>
            </div>
            {!result && !busy && (
              <div className="empty-card">
                <div className="empty-icon">
                  <Flag size={23} />
                </div>
                <div>
                  <h2>
                    {place
                      ? "Your run starts here."
                      : "Every good run starts somewhere."}
                  </h2>
                  <p>
                    {place
                      ? "Pick your distance and find a way around."
                      : "Search a starting point or drop a pin on the map."}
                  </p>
                </div>
              </div>
            )}
            {busy && (
              <div className="empty-card">
                <LoaderCircle className="spin" />
                <div>
                  <h2>Finding a smoother run.</h2>
                  <p>Comparing parks, crossings and repeated paths.</p>
                </div>
              </div>
            )}
          </div>
          {chosen && result && (
            <div
              className="result-card"
              ref={resultsRef}
              tabIndex={-1}
              aria-label="Route recommendation"
            >
              <div className="result-top">
                <span className="eyebrow">
                  {selected === 0 ? "BEST MATCH FOUND" : "ALTERNATIVE LOOP"}
                </span>
                <span className="loop-tag">↺ Round trip</span>
              </div>
              <div className="result-stats">
                <div>
                  <strong>{(chosen.distance / 1000).toFixed(2)}</strong>
                  <span>km</span>
                </div>
                <div className="match">
                  <b>
                    {Math.abs(chosen.distance - Number(distance) * 1000) < 50
                      ? "On target"
                      : `${chosen.distance > Number(distance) * 1000 ? "+" : "−"}${(Math.abs(chosen.distance - Number(distance) * 1000) / 1000).toFixed(2)} km`}
                  </b>
                  <span>from your target</span>
                </div>
              </div>
              <div className="route-facts">
                {result.source === "openrouteservice" ? (
                  <>
                    <span>
                      {result.quality?.[selected]?.green == null
                        ? "Green rating unavailable"
                        : `${Math.round(result.quality[selected].green! * 100)}% of route rated green`}
                    </span>
                    <span>
                      {result.quality?.[selected]?.quiet == null
                        ? "Quiet rating unavailable"
                        : `${Math.round(result.quality[selected].quiet! * 100)}% of route rated quiet`}
                    </span>
                    <span>Stairs avoided where mapped</span>
                  </>
                ) : (
                  <>
                    <span>
                      {Math.round(chosen.parks * 100)}% in mapped green spaces
                    </span>
                    <span>
                      {chosen.trafficLights} mapped traffic-light encounters
                    </span>
                    <span>{chosen.crossings} mapped crossing sections</span>
                  </>
                )}
              </div>
              {result.routes.length > 1 && (
                <details className="alternative-options">
                  <summary>
                    Compare {result.routes.length - 1} alternatives
                  </summary>
                  <div className="alternatives">
                    {result.routes.map((r, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        aria-pressed={i === selected}
                        onClick={() => setSelected(i)}
                      >
                        {i === 0 ? "Best" : `Loop ${i + 1}`} ·{" "}
                        {(r.distance / 1000).toFixed(1)} km
                      </Button>
                    ))}
                  </div>
                </details>
              )}
              <Button
                className="export-button"
                variant="outline"
                onClick={download}
              >
                <Download size={17} /> Download GPX
              </Button>
              <details className="recommendation-details">
                <summary>Why this loop?</summary>
                {result.source === "openrouteservice" ? (
                  <p>
                    Four seeded walking loops are requested with green and quiet
                    preferences and mapped stairs avoided. One extra request may
                    adjust the length. We rank the returned routes by target
                    distance, direction and green/quiet ratings. Ratings
                    describe route segments, not park boundaries. Traffic lights
                    and crossings are not counted by this provider; a stop-free
                    run cannot be guaranteed. Check the map and local signs.
                  </p>
                ) : (
                  <>
                    <p>
                      We favor mapped parks and fewer interruptions: traffic
                      lights, road and railway crossings, gates, stairs, and
                      sharp turns. Distance, repeated paths and direction also
                      affect the choice. This is the best candidate found, not a
                      guaranteed stop-free route.
                    </p>
                    <div className="route-facts detail-facts">
                      <span>
                        {(chosen.repeat * 100).toFixed(1)}% repeated distance
                      </span>
                      <span>
                        {Math.round(chosen.paths * 100)}% paths & tracks
                      </span>
                      <span>
                        Loop heads{" "}
                        {directions[1 + (Math.round(chosen.bearing / 45) % 8)]}
                      </span>
                      <span>{chosen.barriers} mapped barriers</span>
                      <span>
                        {chosen.railwayCrossings} mapped railway crossings
                      </span>
                      <span>{Math.round(chosen.steps)} m of stairs</span>
                      <span>{chosen.sharpTurns} sharp junction turns</span>
                    </div>
                    <p>
                      Green-space coverage comes from mapped boundaries;
                      unmapped obstacles cannot be counted. Adjacent crossing
                      markings are grouped into sections; these are not
                      predicted stops or waiting times.
                    </p>
                  </>
                )}
              </details>
              <p className="route-note">
                {result.snapDistance > 30
                  ? `Starts ${Math.round(result.snapDistance)} m from your pin on a mapped path. `
                  : ""}
                {Math.abs(chosen.distance / 1000 - Number(distance)) /
                  Number(distance) >
                0.2
                  ? "Limited loop options here; try a nearby start. "
                  : ""}
                Based on mapped foot access. Check local signs and conditions.
              </p>
            </div>
          )}
        </section>
      </div>
      {!embedded && <SiteFooter />}
    </main>
  );
}
