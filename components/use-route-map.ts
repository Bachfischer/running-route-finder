import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap, LeafletMouseEvent } from "leaflet";
import type { Loop } from "@/lib/route";

type Place = { lat: number; lon: number; name: string };

/** Owns Leaflet's imperative lifetime, layers and resize handling. */
export function useRouteMap(
  place: Place | null,
  chosen: Loop | undefined,
  onPin: (place: Place) => void,
) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const onPinRef = useRef(onPin);
  const [ready, setReady] = useState(0);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    onPinRef.current = onPin;
  });
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
        map.on("click", (e: LeafletMouseEvent) =>
          onPinRef.current({
            lat: e.latlng.lat,
            lon: e.latlng.lng,
            name: "Pinned location",
          }),
        );
        setReady((version) => version + 1);
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
    if (!ready || !mapRef.current || !leaflet.current) return;
    const L = leaflet.current;
    const map = mapRef.current;
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
        { color: "#46675b", weight: 5 },
      ).addTo(group);
      map.fitBounds(line.getBounds(), { padding: [65, 65], animate: false });
      requestAnimationFrame(() => {
        if (mapRef.current !== map) return;
        map.invalidateSize();
        map.fitBounds(line.getBounds(), { padding: [65, 65], animate: false });
      });
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
  }, [place, chosen, ready]);

  return { host, mapRef, mapError };
}
