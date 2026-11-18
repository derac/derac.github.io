# San Marcos Parking

From the repository root, run `python3 -m http.server 8000` and open
`http://localhost:8000/san-marcos-parking/`.

The app opens with data saved in this browser or with the bundled snapshots in
`data/`. On startup, it checks for updates when City data is at least an hour
old or OSM data is at least a day old. When both OSM endpoints fail, the app
keeps the existing copy and waits 15 minutes before another automatic OSM
attempt. **Map info & sources** shows the data in use. **Refresh data** tries
all sources immediately when the browser is online.

OSM refresh uses Private.coffee first and the main Overpass API as a fallback.
The query preserves parking way geometry and requests center points for parking
relations. The basemap and address search require an internet connection.
