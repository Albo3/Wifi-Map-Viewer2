# WiFi Map Viewer

A powerful web-based application for visualizing and managing WiFi networks from SQLite database files. This tool helps you analyze WiFi data collected from various sources, including WiGLE database exports.

<img src="screenshot.avif" alt="WiFi Map Viewer Screenshot" width="800" style="max-width: 100%; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.2);">

## Features

- **Interactive Map Visualization**: Display WiFi networks on an interactive map with color-coded markers
- **Signal Strength Indicators**: Color-coded markers show signal strength (green for excellent, yellow for good, red for poor)
- **Database Management**: Import, merge, and export WiFi network databases
- **Network Notes**: Add and save notes for specific WiFi networks
- **Search Functionality**: Quickly find networks by SSID
- **Detailed Statistics**: View comprehensive statistics about your WiFi database
- **Persistent Storage**: Local database storage using IndexedDB
- **Multiple Observations**: Track networks seen multiple times with weighted position averaging
- **Offline Capable**: Works entirely in the browser with no server requirements

## Usage

1. **Getting Started**:
   - Open `index.html` in any modern web browser
   - The app will load any previously imported networks from local storage

2. **Importing Data**:
   - Click "Choose File" and select a WiFi database file (.sqlite or .db)
   - Compatible with WiGLE SQLite exports and previously exported databases
   - The map will populate with markers representing WiFi networks

3. **Navigating the Map**:
   - Zoom and pan to explore the network distribution
   - Click on markers to view detailed information about each network
   - Networks with notes have a blue indicator dot

4. **Searching**:
   - Use the search box to filter networks by SSID
   - Matching networks will be highlighted on the map

5. **Adding Notes**:
   - Click on a network marker to select it
   - Click "Add Note" to open the note editor
   - Enter your notes and click "Save Note"

6. **Database Management**:
   - Click "Save DB" to export your entire database as a SQLite file
   - Click "DB Info" to view detailed statistics about your database
   - Import additional databases to merge with your existing data

## WiGLE Compatibility

This application is fully compatible with [WiGLE.net](https://wigle.net/) SQLite database exports:

1. **Exporting from WiGLE**:
   - In the WiGLE Android app, go to "Database" → "Export Database"
   - Select SQLite as the export format
   - Transfer the exported .sqlite file to your computer

2. **Importing WiGLE Data**:
   - Load the exported .sqlite file directly into WiFi Map Viewer
   - All network data including coordinates, signal strength, and security types will be properly imported
   - Multiple WiGLE database files can be merged for comprehensive coverage

3. **Data Consistency**:
   - The application maintains the same database schema as WiGLE for core network data
   - Additional metadata like notes are stored separately to avoid conflicts
   - Exported databases can be re-imported into WiGLE if needed

## Technical Details

This application is built entirely with client-side web technologies:

- **Mapping**: [Leaflet.js](https://leafletjs.com/) for interactive map rendering
- **Database**: [SQL.js](https://sql.js.org/) for client-side SQLite processing
- **Storage**: IndexedDB for persistent local storage
- **UI**: Pure JavaScript, HTML5, and CSS3

### Data Processing

- Networks are stored with weighted position averaging based on signal strength
- Multiple observations of the same network improve position accuracy
- Network metadata includes signal strength, security type, and frequency

## Project Structure

- `index.html` - Main HTML file and entry point
- `styles.css` - CSS styles for the application
- `script.js` - Core application logic and UI interactions
- `masterdb.js` - Database management and storage functionality

## Privacy & Security

All data processing happens entirely in your browser. No data is sent to any server, making this application safe for analyzing sensitive WiFi data.

## Compatibility

- Works in all modern browsers (Chrome, Firefox, Safari, Edge)
- Requires JavaScript enabled
- No internet connection required after initial page load

## License

This project is licensed under the MIT License.

Third-party libraries used in this project (Leaflet.js and SQL.js) are subject to their respective licenses.
