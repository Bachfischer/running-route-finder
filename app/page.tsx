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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toGpx } from "@/lib/gpx";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import type { LoopResult } from "@/lib/routing";
type Place = { lat: number; lon: number; name: string };
const directions = ["Any", "N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export default function Home() {
  const [query, setQuery] = useState(""),
    [place, setPlace] = useState<Place | null>(null),
    [places, setPlaces] = useState<Place[]>([]),
    [distance, setDistance] = useState("5"),
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
    const id = ++request.current;
    setSearching(true);
    setError("");
    try {
      const res = await fetch("/api/search?q=" + encodeURIComponent(query));
      const data = (await res.json()) as { places: Place[]; error?: string };
      if (id !== request.current) return;
      if (!res.ok) throw Error(data.error);
      setPlaces(data.places);
      if (!data.places.length)
        setError(
          "No locations found. Try a city and street, or pin a point on the map.",
        );
    } catch (e) {
      if (id === request.current) setError((e as Error).message);
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
    if (!place) {
      setError("Choose a starting location first.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/loops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...place,
          distance: Number(distance),
          direction,
        }),
      });
      const data = (await res.json()) as LoopResult & { error?: string };
      if (!res.ok) throw Error(data.error);
      setResult(data);
      setSelected(0);
    } catch (e) {
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
          <SiteHeader />
          <div className="project-heading">
            <div className="breadcrumbs">
              <a href="/projects/">Projects</a>
              <span>/</span>
              <span>Running route finder</span>
            </div>
            <h1>Running route finder</h1>
            <p>
              Find a loop from your doorstep. Choose a distance, explore a
              direction, and head back to where you started.
            </p>
          </div>
        </>
      )}
      <div className="workspace">
        <aside className="sidebar">
          <div className="intro">
            <h2>Plan your run</h2>
            <p>Choose where to start and how far to go.</p>
          </div>
          <div className="form">
            <fieldset disabled={busy || !hydrated}>
              <label htmlFor="location" className="field-label">
                <span className="number">01</span> Starting point
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
                <p className="selected-start">
                  Start selected · {place.lat.toFixed(4)},{" "}
                  {place.lon.toFixed(4)}
                </p>
              )}
              <div className="distance-label">
                <label htmlFor="distance" className="field-label">
                  <span className="number">02</span> Target distance
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
                  : "Park routes preferred · fewer traffic lights"}
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
              <label className="field-label">
                <span className="number">03</span> Head in a direction{" "}
                <span className="optional">Optional</span>
              </label>
              <div
                className="directions"
                role="group"
                aria-label="Preferred direction"
              >
                {directions.map((d) => (
                  <Button
                    key={d}
                    variant="outline"
                    aria-pressed={direction === d}
                    onClick={() => {
                      setDirection(d);
                      setResult(null);
                    }}
                  >
                    {d === "Any" ? (
                      <>
                        <Route size={15} />
                        Any
                      </>
                    ) : (
                      d
                    )}
                  </Button>
                ))}
              </div>
              <p className="field-hint">
                The side of your start you’d like to explore.
              </p>
            </fieldset>
            <Button
              className="find-button"
              onClick={find}
              disabled={
                busy ||
                !place ||
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
                  Find my loop <ArrowUpRight size={20} />
                </>
              )}
            </Button>
            <div aria-live="polite">
              {result && (
                <p className="sr-only">
                  Found {result.routes.length} loops. Best match{" "}
                  {(result.routes[0].distance / 1000).toFixed(2)} kilometers.
                </p>
              )}
              {busy && (
                <p className="status">
                  Loading nearby paths and comparing loops. This can take up to
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
              {place ? "Your starting point" : "Explore Munich"}
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
                  <h2>Connecting the dots.</h2>
                  <p>Looking for a loop with less backtracking.</p>
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
                <span>
                  {Math.round(chosen.parks * 100)}% in mapped green spaces
                </span>
                <span>
                  {chosen.trafficLights} mapped traffic-light encounters
                </span>
                <span>
                  {(chosen.repeat * 100).toFixed(1)}% repeated distance
                </span>
                <span>{Math.round(chosen.paths * 100)}% paths & tracks</span>
                <span>
                  Loop heads{" "}
                  {directions[1 + (Math.round(chosen.bearing / 45) % 8)]}
                </span>
              </div>
              {result.routes.length > 1 && (
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
                <p>
                  We favor mapped parks, gardens and woodland, and penalize
                  traffic lights and repeated paths. Distance and your preferred
                  direction also influence the ranking. This is the best
                  candidate found in the searched area.
                </p>
                <p>
                  Green-space coverage comes from mapped boundaries; unmapped
                  parks or signals cannot be counted. A traffic light may be
                  unavoidable to complete the loop.
                </p>
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
