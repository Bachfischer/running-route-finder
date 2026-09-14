---
title: "Running route finder"
excerpt: "Find a running loop from any starting point. Choose a distance and direction, compare routes on OpenStreetMap paths, and download a GPX file."
permalink: /projects/running-routes/
date: 2026-09-13
author_profile: true
share: false
comments: false
---

A small tool for a familiar running question: where can I go for a loop of roughly the right distance?

Pick a starting point, choose how far you want to run, and explore a direction. The tool compares loops on OpenStreetMap paths and brings you back to the start. Choose a route and download the GPX file for your run.

{% if site.running_routes_url and site.running_routes_url != "" %}
<a href="{{ site.running_routes_url | escape }}" class="btn btn--primary">Launch route finder</a>
{% endif %}

## How it works

Nearby streets and trails become a graph with mapped pedestrian access. A* search connects candidate waypoints into loops. Candidates are ranked by distance accuracy, direction, and backtracking, with a small preference for paths and tracks.

The interface and route search run on Cloudflare Workers. Photon provides location search; Overpass provides OpenStreetMap data. No LLM is needed to calculate a route.

## Things to know

The result is the best loop found among the candidates, not a guarantee of the optimal route. Map data can miss closures or access restrictions. Check local signs and conditions before running. The tool does not assess elevation, weather, lighting, or surface quality.

Inspired by [Simon Willison's experiment with running routes](https://simonwillison.net/2026/Sep/12/astra-running-routes/).
