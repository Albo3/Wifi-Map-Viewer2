// Add these at the top
let map, markers = [], selectedNetwork = null, markerCluster = null;
let saveDbBtn, addNoteBtn, noteEditor, networkNote, saveNoteBtn, cancelNoteBtn;
let storageAvailable = true;

// Initialize on DOM content loaded
document.addEventListener('DOMContentLoaded', async function() {
    console.log("DOM loaded, initializing map...");
    
    // Check if storage is available
    try {
        // Test IndexedDB availability
        const testDb = indexedDB.open('test-db');
        testDb.onerror = function() {
            console.error("IndexedDB access denied - storage will not persist");
            storageAvailable = false;
            // Show warning to user
            showStorageWarning();
        };
    } catch (e) {
        console.error("Error checking storage:", e);
        storageAvailable = false;
    }
    
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

    // Use only OpenStreetMap (Free, no API key needed)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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
    
    // Create marker cluster group with options - use global variable
    markerCluster = L.markerClusterGroup({
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
    // File input handler - update ID from 'dbFile' to 'fileInput'
    document.getElementById('fileInput').addEventListener('change', async function(event) {
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
            // Set the network name in the display span
            document.getElementById('networkNameDisplay').textContent = selectedNetwork.ssid;
            
            // Load existing note content
            const existingNote = selectedNetwork.marker.getPopup()
                .getContent().match(/Network Notes:<\/span>\s*<span>(.*?)<\/span>/);
            
            if (existingNote && existingNote[1] && existingNote[1] !== 'None') {
                networkNote.value = existingNote[1];
            } else {
                networkNote.value = '';
            }
            
            // Display the note editor
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

    // Add event listener for the note editor close button
    document.getElementById('noteCloseBtn').addEventListener('click', function() {
        noteEditor.style.display = 'none';
    });

    // Add event listener for the cancel button (which should do the same thing)
    document.getElementById('cancelNoteBtn').addEventListener('click', function() {
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

    // Updated search handler with dropdown functionality
    document.getElementById('search').addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase();
        const searchResultsContainer = document.getElementById('searchResults');
        
        // Clear previous results
        searchResultsContainer.innerHTML = '';
        
        if (!searchTerm) {
            searchResultsContainer.style.display = 'none';
            return;
        }
        
        // Find matching networks
        let matchCount = 0;
        const matchingNetworks = [];
        
        markers.forEach(({marker, ssid}) => {
            if (ssid.includes(searchTerm)) {
                matchCount++;
                matchingNetworks.push({
                    ssid: ssid,
                    marker: marker
                });
            }
        });
        
        // Update search count
        const searchCountElement = document.getElementById('searchCount');
        if (searchCountElement) {
            searchCountElement.textContent = searchTerm ? `Found ${matchCount} matches` : '';
        }
        
        // Build dropdown if we have matches
        if (matchCount > 0) {
            searchResultsContainer.style.display = 'block';
            
            // Create dropdown items (limit to 10 for performance)
            matchingNetworks.slice(0, 10).forEach(network => {
                const item = document.createElement('div');
                item.className = 'search-result-item';
                item.textContent = network.ssid;
                
                // Add click handler to zoom to network
                item.addEventListener('click', function() {
                    if (!markerCluster) {
                        console.error("Marker cluster not initialized");
                        return;
                    }
                    
                    try {
                        // First zoom to marker's position at a reasonable zoom level
                        map.setView(network.marker.getLatLng(), 16);
                        
                        // Then use zoomToShowLayer to make it visible and open the popup
                        setTimeout(() => {
                            try {
                                markerCluster.zoomToShowLayer(network.marker, function() {
                                    // This callback runs when the marker should be visible
                                    network.marker.openPopup();
                                    
                                    // Select this network
                                    selectedNetwork = {
                                        ssid: network.ssid,
                                        marker: network.marker
                                    };
                                    
                                    // Enable add note button
                                    addNoteBtn.disabled = false;
                                });
                            } catch (e) {
                                console.error("Error in zoomToShowLayer:", e);
                                // Fallback approach if zoomToShowLayer fails
                                map.setView(network.marker.getLatLng(), 18);
                                network.marker.openPopup();
                            }
                        }, 300); // Small delay to let the map settle
                    } catch (e) {
                        console.error("Error in search click handler:", e);
                    }
                    
                    // Hide the search results
                    searchResultsContainer.style.display = 'none';
                });
                
                searchResultsContainer.appendChild(item);
            });
            
            // Add "show all" option if there are many results
            if (matchCount > 10) {
                const showAllItem = document.createElement('div');
                showAllItem.className = 'search-result-item show-all';
                showAllItem.textContent = `Show all ${matchCount} results on map`;
                
                showAllItem.addEventListener('click', function() {
                    // Create bounds for all matching markers
                    const bounds = L.latLngBounds(matchingNetworks.map(n => n.marker.getLatLng()));
                    map.fitBounds(bounds, { padding: [50, 50] });
                    searchResultsContainer.style.display = 'none';
                });
                
                searchResultsContainer.appendChild(showAllItem);
            }
        } else {
            // No matches
            searchResultsContainer.style.display = 'none';
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.search-container')) {
            document.getElementById('searchResults').style.display = 'none';
        }
    });

    // Merge DB button
    document.getElementById('mergeDbBtn').addEventListener('click', function() {
        document.getElementById('fileInput').click(); // Update from 'dbFile' to 'fileInput'
    });

    // DB Info button
    document.getElementById('dbInfoBtn').addEventListener('click', async function() {
        const infoPanel = document.getElementById('dbInfoPanel');
        const detailedStats = document.getElementById('detailedDbStats');
        
        // Get detailed database statistics
        try {
            const stats = await window.masterDb.getStats();
            
            // Calculate percentages for visualization
            const totalNetworks = stats.totalNetworks;
            
            // Sort security types by count (descending)
            const securityTypesArray = Object.entries(stats.securityTypes)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);
            
            // Build HTML with better formatting and visualization - Remove network types chart
            let statsHtml = `
                <div class="stat-grid">
                    <div class="stat-card">
                        <div class="stat-value">${stats.totalNetworks.toLocaleString()}</div>
                        <div class="stat-label">Total Networks</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${stats.networksWithNotes.toLocaleString()}</div>
                        <div class="stat-label">Networks with Notes</div>
                    </div>
                </div>`;
            
            // Add last import time if available
            if (stats.lastImport) {
                statsHtml += `
                    <div class="stat-card">
                        <h4>Last Database Update</h4>
                        <div class="stat-section">
                            ${stats.lastImport.toLocaleString()}
                        </div>
                    </div>`;
            }
            
            // Enhanced Security Types visualization with better bars and formatting
            statsHtml += `<div class="stat-card">
                <h4>Top Security Types</h4>
                <div class="security-list-container">`;
            
            // Get maximum count for percentage calculation    
            const maxCount = securityTypesArray[0][1];
            
            // Add a summary of security distribution
            statsHtml += `<div class="security-summary">
                <div class="security-bar-container">`;
            
            // Create a stacked bar for security distribution overview
            let cumulativePercent = 0;
            securityTypesArray.forEach(([security, count], index) => {
                const percentage = (count / totalNetworks) * 100;
                const color = getSecurityColor(security, index);
                
                statsHtml += `<div class="security-stack-segment" style="width: ${percentage}%; background-color: ${color};" 
                    title="${security}: ${count} (${percentage.toFixed(1)}%)"></div>`;
                    
                cumulativePercent += percentage;
            });
            
            // Add "other" category if needed
            if (cumulativePercent < 100) {
                statsHtml += `<div class="security-stack-segment security-other" style="width: ${100-cumulativePercent}%;" 
                    title="Other: ${totalNetworks - securityTypesArray.reduce((sum, [_, count]) => sum + count, 0)} networks"></div>`;
            }
            
            statsHtml += `</div>
                </div>`;
            
            // Detailed list of security types
            statsHtml += `<ul class="security-list">`;
            
            securityTypesArray.forEach(([security, count], index) => {
                const percentage = Math.round((count / totalNetworks) * 100);
                const relativePercentage = Math.round((count / maxCount) * 100);
                
                // Format the security string to be more readable
                const formattedSecurity = formatSecurityType(security);
                const color = getSecurityColor(security, index);
                    
                statsHtml += `
                    <li class="security-list-item">
                        <div class="security-info">
                            <div class="security-name">${formattedSecurity}</div>
                            <div class="security-count-label">${count.toLocaleString()} networks (${percentage}%)</div>
                        </div>
                        <div class="security-bar-wrapper">
                            <div class="security-bar" style="width: ${relativePercentage}%; background-color: ${color};"></div>
                        </div>
                    </li>`;
            });
            
            statsHtml += `</ul></div></div>`;
            
            detailedStats.innerHTML = statsHtml;
            infoPanel.style.display = 'flex'; // Use flex to enable proper scrolling
            
            // Add event listener for the X button
            document.getElementById('infoCloseBtn').addEventListener('click', function() {
                infoPanel.style.display = 'none';
            });
            
        } catch (error) {
            console.error('Error getting database stats:', error);
            detailedStats.innerHTML = `<div class="error">Error loading statistics: ${error.message}</div>`;
            infoPanel.style.display = 'flex';
        }
    });

    // Close info panel button
    document.getElementById('closeInfoBtn').addEventListener('click', function() {
        document.getElementById('dbInfoPanel').style.display = 'none';
    });

    // Add event listener for clear cache button
    document.getElementById('clearCacheBtn').addEventListener('click', async function() {
        if (confirm("This will clear all stored data including notes. Continue?")) {
            try {
                // Delete the database
                await new Promise((resolve, reject) => {
                    const request = indexedDB.deleteDatabase('WifiMapMaster');
                    request.onsuccess = () => {
                        console.log("Database deleted successfully");
                        resolve();
                    };
                    request.onerror = () => {
                        console.error("Error deleting database");
                        reject();
                    };
                });
                
                // Clear localStorage too
                localStorage.clear();
                
                alert("Cache cleared. The page will now reload.");
                location.reload();
            } catch (e) {
                console.error("Error clearing cache:", e);
                alert("Error clearing cache: " + e.message);
            }
        }
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

    // Use the same OpenStreetMap tiles for consistency
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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

// Helper function to determine color based on security type
function getSecurityColor(security, index) {
    if (security.includes('WPA3') || security.includes('SAE')) {
        return '#2ecc71'; // Strong security - green
    } else if (security.includes('WPA2') && security.includes('CCMP')) {
        return '#3498db'; // Good security - blue
    } else if (security.includes('WPA')) {
        return '#f39c12'; // Moderate security - orange
    } else if (security.includes('WEP')) {
        return '#e74c3c'; // Poor security - red
    } else if (security.includes('ESS') && !security.includes('WPA') && !security.includes('WEP')) {
        return '#95a5a6'; // Open networks - gray
    } else {
        // Fallback colors for other types
        const colors = ['#9b59b6', '#1abc9c', '#34495e', '#d35400', '#2c3e50'];
        return colors[index % colors.length];
    }
}

// Helper function to format security type for better readability
function formatSecurityType(security) {
    return security
        .replace(/\]\[/g, '• ')  // Replace '][' with bullet points
        .replace(/[\[\]]/g, '') // Remove brackets
        .replace(/WPA2-PSK-CCMP/g, '<span class="security-highlight">WPA2</span>') // Highlight main parts
        .replace(/WPA-PSK-CCMP/g, '<span class="security-highlight">WPA</span>')
        .replace(/RSN-PSK-CCMP/g, '<span class="security-highlight">RSN</span>')
        .replace(/RSN-SAE-CCMP/g, '<span class="security-highlight wpa3">WPA3</span>')
        .replace(/ESS/g, '<span class="security-tag">ESS</span>')
        .replace(/WPS/g, '<span class="security-tag wps">WPS</span>')
        .replace(/MFPC/g, '<span class="security-tag mfpc">MFPC</span>');
}

// Function to show storage warning
function showStorageWarning() {
    const warning = document.createElement('div');
    warning.className = 'storage-warning';
    warning.innerHTML = `
        <div class="warning-content">
            <strong>Warning:</strong> Storage access is restricted. 
            Your notes and database changes will not persist after page reload.
            <button class="close-warning">×</button>
        </div>
    `;
    document.body.appendChild(warning);
    
    // Add close button handler
    warning.querySelector('.close-warning').addEventListener('click', function() {
        warning.style.display = 'none';
    });
} 