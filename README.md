# WiFi Map Viewer

A powerful web-based application for visualizing and managing WiFi networks from SQLite database files. This tool helps you analyze WiFi data collected from various sources, including WiGLE database exports.

<img src="screenshot.avif" alt="WiFi Map Viewer Screenshot" width="800" style="max-width: 100%; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.2);">

## Features

- **Interactive Map Visualization**: Display WiFi networks on an interactive map with color-coded markers
- **Intelligent Network Grouping**: Automatically groups multiple access points of the same network (e.g., mesh networks, dual-band routers)
- **Advanced Position Triangulation**: 
  - Uses weighted averaging based on signal strength and GPS accuracy
  - Selects best quality readings for more accurate positioning
  - Handles multiple observations of the same network
- **Signal Strength Visualization**: 
  - Color-coded markers (green for excellent, yellow for good, red for poor)
  - Marker size indicates number of observations
  - Special indicators for networks with notes
- **Database Management**: 
  - Import and merge WiGLE SQLite databases
  - Export combined database
  - Add and manage network notes
- **Smart Search**: Quickly find networks by SSID with real-time filtering
- **Detailed Statistics**: 
  - Network counts and distribution
  - Security type analysis
  - Multiple access point detection
- **Persistent Storage**: Local database storage using IndexedDB
- **Offline Capable**: Works entirely in the browser with no server requirements

## Usage

1. **Getting Started**:
   - Open `index.html` in any modern web browser
   - The app will load any previously imported networks from local storage

2. **Importing Data**:
   - Click "Choose File" and select a WiFi database file (.sqlite or .db)
   - Compatible with WiGLE SQLite exports
   - Automatically merges duplicate networks and combines multiple access points

3. **Navigating the Map**:
   - Zoom and pan to explore network distribution
   - Click markers to view detailed information:
     - Network name and BSSID
     - Number of access points if multiple exist
     - Signal strength and frequency
     - Security capabilities
     - Observation count and accuracy

4. **Network Management**:
   - Search for networks using the search box
   - Add notes to networks for future reference
   - View network statistics and distribution

## Technical Details

### Data Processing

- **Network Identification**:
  - Uses BSSID (MAC address) as unique identifier
  - Groups multiple BSSIDs under same SSID when appropriate
  - Handles both 2.4GHz and 5GHz bands from same router

- **Position Calculation**:
  - Weighted average based on signal strength
  - Considers GPS accuracy from location data
  - Uses top 3 highest quality readings for positioning
  - Handles multiple observations over time

- **Quality Metrics**:
  - Signal strength (dBm)
  - GPS accuracy
  - Number of observations
  - Time of observation

### Database Structure

- **Network Table**:
  - Primary key: BSSID
  - SSID and network capabilities
  - Best signal level and position
  - Observation count and accuracy
  - Custom notes and timestamps

## Privacy & Security

All data processing happens entirely in your browser. No data is sent to any server, making this application safe for analyzing sensitive WiFi data.

## Compatibility

- Works in all modern browsers (Chrome, Firefox, Safari, Edge)
- Requires JavaScript enabled
- No internet connection required after initial page load

## License

This project is licensed under the MIT License.

Third-party libraries used:
- Leaflet.js for mapping
- SQL.js for database management
- Leaflet.markercluster for marker clustering
