// Add these at the top
let map, markers = [], selectedNetwork = null;
let saveDbBtn, addNoteBtn, noteEditor, networkNote, saveNoteBtn, cancelNoteBtn;

// Initialize on DOM content loaded
document.addEventListener('DOMContentLoaded', async function() {
    console.log("DOM loaded, initializing map...");
    
    // Check if masterDb is defined
    if (typeof window.masterDb === 'undefined') {
        console.error("MasterDb is not defined! Make sure masterdb.js is loaded first.");
        return;
    }
    
    // Initialize map
    map = L.map('map', {
        minZoom: 3,
        maxZoom: 19,
        zoomControl: true
    }).setView([-32.007, 115.755], 13);

    L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>, &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);
    
    // Initialize UI elements
    saveDbBtn = document.getElementById('saveDbBtn');
    addNoteBtn = document.getElementById('addNoteBtn');
    noteEditor = document.getElementById('noteEditor');
    networkNote = document.getElementById('networkNote');
    saveNoteBtn = document.getElementById('saveNoteBtn');
    cancelNoteBtn = document.getElementById('cancelNoteBtn');
    
    // Initialize database
    try {
        console.log("Initializing master database...");
        await window.masterDb.init();
        console.log("Master database initialized successfully");
        
        const networks = await window.masterDb.getAllNetworks();
        console.log(`Retrieved ${networks.length} networks from master database`);
        
        if (networks.length > 0) {
            console.log("Displaying networks on map...");
            displayNetworks(networks);
            
            // Update database stats display
            const stats = await window.masterDb.getStats();
            updateDbStats(stats);
            
            // Enable database controls
            saveDbBtn.disabled = false;
            document.getElementById('mergeDbBtn').disabled = false;
            document.getElementById('dbInfoBtn').disabled = false;
        } else {
            console.log("No networks in master database yet");
        }
    } catch (error) {
        console.error('Error initializing master database:', error);
    }
    
    // Initialize event listeners
    initEventListeners();
});

// Helper function to determine signal strength class
function getSignalStrengthClass(strength) {
    if (strength >= -50) return ['good', 'Excellent'];
    if (strength >= -70) return ['medium', 'Good'];
    return ['poor', 'Poor'];
}

// Helper function to create custom icon based on signal strength and note status
function createCustomIcon(strength, hasNote = false, observations = 1) {
    const [strengthClass] = getSignalStrengthClass(strength);
    const colors = {
        good: '#4CAF50',
        medium: '#FFC107',
        poor: '#F44336'
    };
    
    // Calculate marker size based on observations (min 6, max 10)
    const radius = Math.min(10, 6 + Math.log(observations));
    
    // Add a note indicator if the network has notes
    const noteIndicator = hasNote ? 
        `<circle cx="16" cy="4" r="4" fill="#3F51B5" stroke="white" stroke-width="1"/>` : '';
    
    // Add observation indicator
    const obsIndicator = observations > 1 ? 
        `<circle cx="10" cy="10" r="${radius + 2}" fill="none" stroke="${colors[strengthClass]}" 
                stroke-width="1" opacity="0.5"/>` : '';
    
    return L.divIcon({
        className: `custom-marker ${hasNote ? 'has-note' : ''}`,
        html: `<svg width="24" height="24" viewBox="0 0 24 24">
                ${obsIndicator}
                <circle cx="10" cy="10" r="${radius}" fill="${colors[strengthClass]}" 
                        stroke="white" stroke-width="2"/>
                ${noteIndicator}
               </svg>`,
        iconSize: [24, 24]
    });
}

// Helper function to display networks on the map
function displayNetworks(networks) {
    console.log(`Displaying ${networks.length} networks on map`);
    
    // Clear existing markers
    map.eachLayer((layer) => {
        if (layer instanceof L.MarkerClusterGroup) {
            map.removeLayer(layer);
        }
    });
    
    markers = []; // Clear markers array
    const bounds = L.latLngBounds();
    
    // Create marker cluster group with options
    const markerCluster = L.markerClusterGroup({
        // Customize clustering distance - adjust this to control when clusters are formed
        maxClusterRadius: 40,
        
        // Spiderfy settings - make it easier to select individual markers
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: true,
        zoomToBoundsOnClick: true,
        
        // Animate the transitions
        animate: true,
        
        // Distance away from center to spiderfy markers
        spiderfyDistanceMultiplier: 1.5,
        
        // Custom icon creation for clusters
        iconCreateFunction: function(cluster) {
            const childCount = cluster.getChildCount();
            
            // Get signal strength classes of all markers in the cluster
            const childMarkers = cluster.getAllChildMarkers();
            let goodCount = 0, mediumCount = 0, poorCount = 0;
            
            childMarkers.forEach(marker => {
                if (marker.options.icon.options.html.includes('#4CAF50')) {
                    goodCount++;
                } else if (marker.options.icon.options.html.includes('#FFC107')) {
                    mediumCount++;
                } else if (marker.options.icon.options.html.includes('#F44336')) {
                    poorCount++;
                }
            });
            
            // Determine which color should be dominant
            let className = 'marker-cluster-large'; // Default to poor signal (red)
            if (goodCount > mediumCount && goodCount > poorCount) {
                className = 'marker-cluster-small'; // Good signal (green)
            } else if (mediumCount > poorCount) {
                className = 'marker-cluster-medium'; // Medium signal (yellow)
            }
            
            // Show how many networks have notes
            const notesCount = childMarkers.filter(marker => 
                marker.options.icon.options.html.includes('#3F51B5')
            ).length;
            
            const noteBadge = notesCount > 0 ? 
                `<div style="position:absolute; top:-5px; right:-5px; background:#3F51B5; color:white; border-radius:50%; width:16px; height:16px; font-size:10px; display:flex; align-items:center; justify-content:center;">${notesCount}</div>` : '';
            
            return L.divIcon({
                html: `<div class="${className}">
                          <div>${childCount}</div>
                          ${noteBadge}
                       </div>`,
                className: 'marker-cluster',
                iconSize: new L.Point(40, 40)
            });
        }
    });
    
    // Add markers for each network
    networks.forEach(network => {
        const hasNote = network.note && network.note.trim() !== '';
        
        const marker = L.marker([network.lastlat, network.lastlon], {
            icon: createCustomIcon(
                network.bestlevel, 
                hasNote, 
                network.observations || 1
            )
        });

        // Add tooltip showing SSID for easy identification
        marker.bindTooltip(network.ssid, {
            permanent: false,
            direction: 'top',
            className: 'network-tooltip',
            offset: [0, -10]
        });

        // Create popup content with network information
        const [strengthClass, strengthLabel] = getSignalStrengthClass(network.bestlevel);
        
        const observationInfo = network.observations > 1 ? 
            `<div class="popup-row">
                <span class="popup-label">Observations:</span>
                <span>${network.observations} data points</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">Last Updated:</span>
                <span>${new Date(network.lastUpdated || network.importDate).toLocaleString()}</span>
            </div>` : '';
        
        const noteSection = hasNote ? 
            `<div class="popup-row note-row">
                <span class="popup-label">Network Notes:</span>
                <span>${network.note}</span>
            </div>` : '';
        
        marker.bindPopup(`
            <div class="custom-popup">
                <h3>${network.ssid}</h3>
                <div class="popup-row">
                    <span class="signal-strength ${strengthClass}">
                        Signal: ${network.bestlevel} dBm (${strengthLabel})
                    </span>
                </div>
                <div class="popup-row">
                    <span class="popup-label">Frequency:</span>
                    <span>${(network.frequency/1000).toFixed(1)} GHz</span>
                </div>
                <div class="popup-row">
                    <span class="popup-label">Security:</span>
                    <span>${network.capabilities || 'Unknown'}</span>
                </div>
                <div class="popup-row">
                    <span class="popup-label">Type:</span>
                    <span>${network.type || 'Unknown'}</span>
                </div>
                ${observationInfo}
                ${noteSection}
            </div>
        `);

        // Add click handler
        marker.on('click', function() {
            selectedNetwork = {
                ssid: network.ssid,
                marker: marker
            };
            
            // Enable the add note button
            addNoteBtn.disabled = false;
            
            // Load existing note
            networkNote.value = network.note || '';
        });

        // Add to cluster group rather than directly to map
        markerCluster.addLayer(marker);

        markers.push({
            marker: marker,
            ssid: network.ssid.toLowerCase()
        });

        bounds.extend([network.lastlat, network.lastlon]);
    });
    
    // Add the cluster group to the map
    map.addLayer(markerCluster);
    
    // Add event listener for when spiderfied - show tooltips automatically
    markerCluster.on('spiderfied', function(e) {
        // Highlight spiderfied markers but DON'T show tooltips automatically
        e.markers.forEach(function(marker) {
            marker.getElement().classList.add('marker-highlight-spider');
            // Removed: marker.openTooltip() - We don't want all tooltips open at once
        });
    });
    
    // Remove highlight and close tooltips when unspiderfied
    markerCluster.on('unspiderfied', function(e) {
        e.markers.forEach(function(marker) {
            marker.getElement().classList.remove('marker-highlight-spider');
            marker.closeTooltip();
        });
    });
    
    // Fit map to show all markers
    if (networks.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}

// Function to update database statistics display
function updateDbStats(stats) {
    const statsElement = document.getElementById('dbStats');
    if (statsElement) {
        statsElement.innerHTML = `
            <div><strong>Total Networks:</strong> ${stats.totalNetworks}</div>
            <div><strong>Networks with Notes:</strong> ${stats.networksWithNotes}</div>
        `;
    }
}

// Initialize all event listeners
function initEventListeners() {
    // File input handler
    document.getElementById('dbFile').addEventListener('change', async function(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            console.log(`Importing database file: ${file.name} (${file.size} bytes)`);
            const buffer = await file.arrayBuffer();
            
            // Import from SQLite into our master database
            console.log("Starting import process...");
            const importStats = await window.masterDb.importFromSQLite(buffer);
            console.log(`Import complete: ${importStats.added} added, ${importStats.updated} updated`);
            
            // Get all networks from master database
            const networks = await window.masterDb.getAllNetworks();
            console.log(`Retrieved ${networks.length} networks from master database after import`);
            
            // Display networks
            displayNetworks(networks);
            
            // Update database stats
            const stats = await window.masterDb.getStats();
            updateDbStats(stats);
            
            // Enable buttons
            saveDbBtn.disabled = false;
            document.getElementById('mergeDbBtn').disabled = false;
            document.getElementById('dbInfoBtn').disabled = false;
            
            // Show import results
            alert(`Import complete!\n\nAdded ${importStats.added} new networks\nUpdated ${importStats.updated} existing networks`);
        } catch (error) {
            console.error('Error importing database:', error);
            alert('Error importing database: ' + error.message);
        }
    });

    // Add Note button
    addNoteBtn.addEventListener('click', function() {
        if (selectedNetwork) {
            noteEditor.style.display = 'block';
        }
    });

    // Save Note button
    saveNoteBtn.addEventListener('click', async function() {
        if (selectedNetwork) {
            const note = networkNote.value.trim();
            const hasNote = note !== '';
            
            try {
                console.log(`Saving note for network: ${selectedNetwork.ssid}`);
                // Save note to master database
                await window.masterDb.saveNote(selectedNetwork.ssid, note);
                
                // Update marker icon
                // Get the current signal strength from the marker
                let currentStrength = -70; // Default to medium
                if (selectedNetwork.marker.options.icon.options.html.includes('#4CAF50')) {
                    currentStrength = -40; // Good
                } else if (selectedNetwork.marker.options.icon.options.html.includes('#F44336')) {
                    currentStrength = -80; // Poor
                }
                
                // Update the marker icon to show note indicator
                selectedNetwork.marker.setIcon(createCustomIcon(currentStrength, hasNote));
                
                // Update the popup to include the note
                const popupContent = selectedNetwork.marker.getPopup().getContent();
                const updatedContent = popupContent.includes('Network Notes:') 
                    ? popupContent.replace(/<div class="popup-row note-row">[\s\S]*?<\/div>/, 
                        `<div class="popup-row note-row">
                            <span class="popup-label">Network Notes:</span>
                            <span>${note || 'None'}</span>
                        </div>`)
                    : popupContent.replace('</div>', 
                        `<div class="popup-row note-row">
                            <span class="popup-label">Network Notes:</span>
                            <span>${note || 'None'}</span>
                        </div></div>`);
                
                selectedNetwork.marker.setPopupContent(updatedContent);
                
                // Hide the note editor
                noteEditor.style.display = 'none';
                
                // No need to manually save the database
                alert('Note saved!');
            } catch (error) {
                console.error('Error saving note:', error);
                alert('Error saving note: ' + error.message);
            }
        }
    });

    // Cancel Note button
    cancelNoteBtn.addEventListener('click', function() {
        noteEditor.style.display = 'none';
    });

    // Save database button
    document.getElementById('saveDbBtn').addEventListener('click', async function() {
        try {
            console.log("Exporting master database to SQLite...");
            // Export the master database to SQLite format
            const data = await window.masterDb.exportToSQLite();
            
            // Create a download
            const blob = new Blob([data], { type: 'application/x-sqlite3' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'wifi_master_database.sqlite';
            a.click();
            
            // Clean up
            URL.revokeObjectURL(url);
            
            alert('Database exported successfully!');
        } catch (error) {
            console.error('Error exporting database:', error);
            alert('Error exporting database: ' + error.message);
        }
    });

    // Search input handler
    document.getElementById('searchInput').addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase();
        let matchCount = 0;

        markers.forEach(({marker, ssid}) => {
            const matches = ssid.includes(searchTerm);
            
            if (matches) {
                matchCount++;
                // Get marker element - this might need to wait until it's spiderfied
                const element = marker.getElement();
                if (element) {
                    element.classList.add('highlighted-marker');
                }
                
                // Open the popup if we're filtering down to just a few items
                if (matchCount < 10) {
                    marker.openPopup();
                }
            } else {
                const element = marker.getElement();
                if (element) {
                    element.classList.remove('highlighted-marker');
                }
                marker.closePopup();
            }
        });

        document.getElementById('searchCount').textContent = 
            searchTerm ? `Found ${matchCount} matches` : '';
    });

    // Merge DB button
    document.getElementById('mergeDbBtn').addEventListener('click', function() {
        document.getElementById('dbFile').click(); // Reuse the main file input
    });

    // DB Info button
    document.getElementById('dbInfoBtn').addEventListener('click', async function() {
        const infoPanel = document.getElementById('dbInfoPanel');
        const detailedStats = document.getElementById('detailedDbStats');
        
        // Get detailed database statistics
        try {
            const stats = await window.masterDb.getStats();
            
            let statsHtml = `<h4>Network Statistics</h4>`;
            
            // Total networks
            statsHtml += `<div class="stat-section"><strong>Total Networks:</strong> ${stats.totalNetworks}</div>`;
            statsHtml += `<div class="stat-section"><strong>Networks with Notes:</strong> ${stats.networksWithNotes}</div>`;
            
            if (stats.lastImport) {
                statsHtml += `<div class="stat-section"><strong>Last Import:</strong> ${stats.lastImport.toLocaleString()}</div>`;
            }
            
            // Network types
            statsHtml += `<div class="stat-section"><strong>Network Types:</strong><ul>`;
            Object.entries(stats.networkTypes).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
                statsHtml += `<li>${type || 'Unknown'}: ${count}</li>`;
            });
            statsHtml += `</ul></div>`;
            
            // Security types
            statsHtml += `<div class="stat-section"><strong>Top Security Types:</strong><ul>`;
            Object.entries(stats.securityTypes).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([security, count]) => {
                statsHtml += `<li>${security || 'Unknown'}: ${count}</li>`;
            });
            statsHtml += `</ul></div>`;
            
            detailedStats.innerHTML = statsHtml;
            infoPanel.style.display = 'block';
        } catch (error) {
            console.error('Error getting database stats:', error);
            detailedStats.innerHTML = `<div class="error">Error loading statistics: ${error.message}</div>`;
            infoPanel.style.display = 'block';
        }
    });

    // Close info panel button
    document.getElementById('closeInfoBtn').addEventListener('click', function() {
        document.getElementById('dbInfoPanel').style.display = 'none';
    });
}

// Update marker behavior to only show names on mouseover
function createCustomMarker(network) {
    // Determine marker color based on signal strength or other criteria
    const signalStrength = network.signal || -70;
    let markerColor;
    
    if (signalStrength > -65) {
        markerColor = 'marker-green';
    } else if (signalStrength > -75) {
        markerColor = 'marker-yellow';
    } else {
        markerColor = 'marker-red';
    }
    
    // Create a more visually pleasing marker with custom styles
    const marker = L.circleMarker([network.lat, network.lng], {
        radius: 8,
        fillColor: getColorForClass(markerColor),
        color: '#fff',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
    });
    
    // Add count badge if needed
    if (network.count && network.count > 1) {
        marker.bindTooltip(network.count.toString(), {
            permanent: true,
            direction: 'center',
            className: 'marker-label'
        });
    }
    
    // Only show network name on mouseover instead of permanently
    if (network.ssid || network.bssid) {
        const tooltipContent = network.ssid || network.bssid;
        marker.bindTooltip(tooltipContent, {
            permanent: false,
            direction: 'top',
            className: 'network-tooltip'
        });
    }
    
    return marker;
}

// Helper function to get color codes
function getColorForClass(className) {
    switch(className) {
        case 'marker-green': return '#2ecc71';
        case 'marker-yellow': return '#f1c40f';
        case 'marker-red': return '#e74c3c';
        default: return '#3498db';
    }
}

// Modify map initialization to use a darker map theme
function initializeMap() {
    // Use a darker map theme if available
    map = L.map('map', {
        minZoom: 3,
        maxZoom: 19,
        zoomControl: true
    }).setView([-32.007, 115.755], 13);

    // You can use Stamen's Toner Lite for a softer look, or switch to a dark theme
    // For a true dark theme, you might need to use a service like Mapbox with a dark style
    L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>, &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);
}

// Additional function to modify cluster behavior if using MarkerCluster
function initializeClusterOptions() {
    return {
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 18,
        // The key setting to prevent automatically showing all labels
        spiderfyDistanceMultiplier: 1.5,
        // Don't auto-bind tooltips for all markers when expanding
        singleMarkerMode: false,
        iconCreateFunction: function(cluster) {
            const count = cluster.getChildCount();
            let size = 'small';
            
            if (count > 10) {
                size = 'medium';
            }
            if (count > 20) {
                size = 'large';
            }
            
            return L.divIcon({
                html: '<div><span>' + count + '</span></div>',
                className: 'marker-cluster marker-cluster-' + size,
                iconSize: L.point(40, 40)
            });
        }
    };
} 