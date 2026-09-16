# Munich routing regression

`munich-10km.json.gz` is an OpenStreetMap extract obtained via Overpass on 2026-09-15. It contains 77,413 elements in the first northward search area for a 10 km run from Odeonsplatz (48.142, 11.577). The network and routing/access/barrier/traffic-signal tags and green-space geometry are preserved; all tags returned by the recorded query are preserved. It is not a route fabricated for the tests.

Map data © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0): https://www.openstreetmap.org/copyright and https://opendatacommons.org/licenses/odbl/1-0/. This fixture remains ODbL data independently of the application code license. The extract is provided as a database in this repository; changes to the fixture retain that license and attribution.

The regression checks actual graph routing for 10 km without accessing public providers. Provider/live failures therefore do not make ordinary CI flaky. Refresh deliberately, record the query/date, and review route-quality differences. The live smoke script is separately opt-in.

The exact query is `munich-query.overpass`. `munich-result.json` is the computed result used by deterministic browser tests, also ODbL-derived. It is not loaded by the application. The park-focused algorithm finds 10.260 km, 90.4% green-space coverage, 99.3% paths/tracks, 2.5% repeated distance and no mapped signals, crossing sections, gates, railway crossings or stairs.
