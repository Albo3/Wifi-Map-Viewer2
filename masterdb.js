// Master database management using IndexedDB
class MasterDatabase {
    constructor() {
        this.db = null;
        this.dbName = 'WifiMapMaster';
        this.dbVersion = 1;
        this.usingMemoryStorage = false;
        this.memoryStorage = null;
    }

    // Initialize the database
    async init() {
        return new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open(this.dbName, this.dbVersion);
                
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    
                    // Create network store
                    if (!db.objectStoreNames.contains('networks')) {
                        const networkStore = db.createObjectStore('networks', { keyPath: 'ssid' });
                        networkStore.createIndex('type', 'type', { unique: false });
                        networkStore.createIndex('security', 'capabilities', { unique: false });
                    }
                    
                    // Create notes store
                    if (!db.objectStoreNames.contains('notes')) {
                        db.createObjectStore('notes', { keyPath: 'ssid' });
                    }
                    
                    // Create metadata store
                    if (!db.objectStoreNames.contains('metadata')) {
                        db.createObjectStore('metadata', { keyPath: 'key' });
                    }
                };
                
                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    console.log("IndexedDB initialized successfully");
                    resolve(this.db);
                };
                
                request.onerror = (event) => {
                    console.error("IndexedDB error:", event.target.error);
                    // Fall back to memory-only storage
                    this.useMemoryStorage();
                    resolve(null);
                };
            } catch (e) {
                console.error("Error initializing IndexedDB:", e);
                // Fall back to memory-only storage
                this.useMemoryStorage();
                resolve(null);
            }
        });
    }

    // Add memory storage fallback
    useMemoryStorage() {
        console.log("Using in-memory storage (changes won't persist)");
        this.memoryStorage = {
            networks: new Map(),
            notes: new Map(),
            metadata: new Map()
        };
        this.usingMemoryStorage = true;
    }

    // Import data from a WiGLE SQLite database
    async importFromSQLite(sqliteData) {
        if (!this.db) await this.init();
        
        const SQL = await initSqlJs({ locateFile: () => 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm' });
        const importDb = new SQL.Database(new Uint8Array(sqliteData));
        
        // Get networks from the import database
        const importNetworks = importDb.exec(`
            SELECT ssid, lastlat, lastlon, bestlevel, 
                   capabilities, frequency, lasttime,
                   type
            FROM network 
            WHERE lastlat IS NOT NULL AND lastlon IS NOT NULL;
        `);
        
        if (importNetworks.length === 0 || !importNetworks[0].values.length) {
            return { added: 0, updated: 0 };
        }
        
        const columns = importNetworks[0].columns;
        const values = importNetworks[0].values;
        
        let stats = { added: 0, updated: 0 };
        
        // Start a transaction
        const tx = this.db.transaction(['networks', 'metadata'], 'readwrite');
        const networkStore = tx.objectStore('networks');
        
        for (const row of values) {
            const ssid = row[columns.indexOf("ssid")];
            const newLat = row[columns.indexOf("lastlat")];
            const newLon = row[columns.indexOf("lastlon")];
            const newSignal = row[columns.indexOf("bestlevel")];
            
            // Create network object
            const network = {
                ssid: ssid,
                lastlat: newLat,
                lastlon: newLon,
                bestlevel: newSignal,
                capabilities: row[columns.indexOf("capabilities")],
                frequency: row[columns.indexOf("frequency")],
                lasttime: row[columns.indexOf("lasttime")],
                type: row[columns.indexOf("type")],
                importDate: Date.now(),
                observations: 1  // Track number of observations
            };
            
            // Check if network exists
            const getRequest = networkStore.get(ssid);
            
            await new Promise(resolve => {
                getRequest.onsuccess = () => {
                    const existingNetwork = getRequest.result;
                    
                    if (existingNetwork) {
                        // Calculate weighted average for location based on signal strength
                        // Convert signal strength (negative dBm) to positive weight
                        // Higher signal = higher weight
                        const existingWeight = Math.pow(10, (existingNetwork.bestlevel + 100) / 10);
                        const newWeight = Math.pow(10, (newSignal + 100) / 10);
                        const totalWeight = existingWeight + newWeight;
                        
                        // Weighted lat/lon calculation
                        const weightedLat = (
                            existingNetwork.lastlat * existingWeight + 
                            newLat * newWeight
                        ) / totalWeight;
                        
                        const weightedLon = (
                            existingNetwork.lastlon * existingWeight + 
                            newLon * newWeight
                        ) / totalWeight;
                        
                        // Update the network with new weighted position and best signal
                        const updatedNetwork = {
                            ...existingNetwork,
                            lastlat: weightedLat,
                            lastlon: weightedLon,
                            bestlevel: Math.max(existingNetwork.bestlevel, newSignal),
                            observations: (existingNetwork.observations || 1) + 1,
                            lastUpdated: Date.now()
                        };
                        
                        // Store additional observation data if we want to show history
                        if (!updatedNetwork.observationHistory) {
                            updatedNetwork.observationHistory = [];
                        }
                        
                        // Add this observation to history (limit to last 10)
                        updatedNetwork.observationHistory.unshift({
                            lat: newLat,
                            lon: newLon,
                            signal: newSignal,
                            timestamp: Date.now()
                        });
                        
                        // Limit history size
                        if (updatedNetwork.observationHistory.length > 10) {
                            updatedNetwork.observationHistory = 
                                updatedNetwork.observationHistory.slice(0, 10);
                        }
                        
                        networkStore.put(updatedNetwork);
                        stats.updated++;
                    } else {
                        // Add new network
                        network.observationHistory = [{
                            lat: newLat, 
                            lon: newLon,
                            signal: newSignal,
                            timestamp: Date.now()
                        }];
                        
                        networkStore.add(network);
                        stats.added++;
                    }
                    resolve();
                };
                
                getRequest.onerror = () => {
                    // If error, try to add anyway
                    networkStore.add(network);
                    stats.added++;
                    resolve();
                };
            });
        }
        
        // Update metadata
        const metadataStore = tx.objectStore('metadata');
        const lastImportMeta = {
            key: 'lastImport',
            date: Date.now(),
            totalNetworks: values.length
        };
        metadataStore.put(lastImportMeta);
        
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(stats);
            tx.onerror = (event) => reject(`Transaction error: ${event.target.error}`);
        });
    }

    // Get all networks for display
    async getAllNetworks() {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['networks', 'notes'], 'readonly');
            const networkStore = tx.objectStore('networks');
            const noteStore = tx.objectStore('notes');
            
            const networks = [];
            const notesMap = new Map();
            
            // First get all notes
            const notesRequest = noteStore.openCursor();
            notesRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    // Store with normalized SSID as key
                    const normalizedSsid = this.normalizeSsid(cursor.value.ssid);
                    notesMap.set(normalizedSsid, cursor.value.note);
                    cursor.continue();
                } else {
                    // Then get all networks
                    const networksRequest = networkStore.openCursor();
                    networksRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            const network = cursor.value;
                            // Look up note using normalized SSID
                            const normalizedSsid = this.normalizeSsid(network.ssid);
                            network.note = notesMap.get(normalizedSsid) || '';
                            networks.push(network);
                            cursor.continue();
                        } else {
                            console.log(`Retrieved ${networks.length} networks, ${notesMap.size} with notes`);
                            resolve(networks);
                        }
                    };
                }
            };
            
            tx.onerror = (event) => reject(`Transaction error: ${event.target.error}`);
        });
    }

    // Save a note for a network
    async saveNote(ssid, note) {
        if (!this.db && !this.usingMemoryStorage) await this.init();
        
        // Normalize the SSID
        const normalizedSsid = this.normalizeSsid(ssid);
        
        const noteObj = {
            ssid: normalizedSsid,
            originalSsid: ssid,
            note: note,
            timestamp: Date.now()
        };
        
        if (this.usingMemoryStorage) {
            // Use in-memory storage
            this.memoryStorage.notes.set(normalizedSsid, noteObj);
            console.log(`Note saved in memory for: ${normalizedSsid}`);
            return Promise.resolve();
        } else {
            // Use IndexedDB as before
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('notes', 'readwrite');
                const noteStore = tx.objectStore('notes');
                
                const request = noteStore.put(noteObj);
                
                request.onsuccess = () => {
                    console.log(`Note saved for network: ${normalizedSsid}`);
                    resolve();
                };
                request.onerror = () => reject(`Error saving note: ${request.error}`);
            });
        }
    }

    // Helper method to normalize SSIDs for consistent key usage
    normalizeSsid(ssid) {
        // Handle null or undefined SSIDs
        if (!ssid) return '';
        
        // Trim whitespace and convert to string
        return String(ssid).trim();
    }

    // Get database statistics
    async getStats() {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['networks', 'notes', 'metadata'], 'readonly');
            const networkStore = tx.objectStore('networks');
            const noteStore = tx.objectStore('notes');
            const metadataStore = tx.objectStore('metadata');
            
            const stats = {
                totalNetworks: 0,
                networksWithNotes: 0,
                lastImport: null,
                networkTypes: {},
                securityTypes: {}
            };
            
            // Count networks
            const countRequest = networkStore.count();
            countRequest.onsuccess = () => {
                stats.totalNetworks = countRequest.result;
            };
            
            // Count notes
            const notesRequest = noteStore.count();
            notesRequest.onsuccess = () => {
                stats.networksWithNotes = notesRequest.result;
            };
            
            // Get last import metadata
            const metaRequest = metadataStore.get('lastImport');
            metaRequest.onsuccess = () => {
                if (metaRequest.result) {
                    stats.lastImport = new Date(metaRequest.result.date);
                }
            };
            
            // Count network types
            const typesRequest = networkStore.index('type').openCursor();
            typesRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const type = cursor.value.type || 'Unknown';
                    stats.networkTypes[type] = (stats.networkTypes[type] || 0) + 1;
                    cursor.continue();
                }
            };
            
            // Count security types
            const securityRequest = networkStore.index('security').openCursor();
            securityRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const security = cursor.value.capabilities || 'Unknown';
                    stats.securityTypes[security] = (stats.securityTypes[security] || 0) + 1;
                    cursor.continue();
                }
            };
            
            tx.oncomplete = () => resolve(stats);
            tx.onerror = (event) => reject(`Error getting stats: ${event.target.error}`);
        });
    }

    // Export the entire database as a SQLite file - improve note handling
    async exportToSQLite() {
        if (!this.db) await this.init();
        
        // Get all networks and notes
        const networks = await this.getAllNetworks();
        
        // Create a new SQLite database
        const SQL = await initSqlJs({ locateFile: () => 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm' });
        const exportDb = new SQL.Database();
        
        // Create tables
        exportDb.run(`
            CREATE TABLE network (
                ssid TEXT PRIMARY KEY,
                lastlat REAL,
                lastlon REAL,
                bestlevel INTEGER,
                capabilities TEXT,
                frequency INTEGER,
                lasttime INTEGER,
                type TEXT
            );
            
            CREATE TABLE network_notes (
                ssid TEXT PRIMARY KEY,
                note TEXT,
                timestamp INTEGER
            );
        `);
        
        // Insert networks
        const insertStmt = exportDb.prepare(`
            INSERT INTO network (
                ssid, lastlat, lastlon, bestlevel,
                capabilities, frequency, lasttime, type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        `);
        
        networks.forEach(network => {
            insertStmt.run([
                network.ssid,
                network.lastlat,
                network.lastlon,
                network.bestlevel,
                network.capabilities,
                network.frequency,
                network.lasttime,
                network.type
            ]);
        });
        
        insertStmt.free();
        
        // Insert notes - only for networks that actually have notes
        const noteStmt = exportDb.prepare(`
            INSERT INTO network_notes (ssid, note, timestamp)
            VALUES (?, ?, ?);
        `);
        
        let noteCount = 0;
        networks.forEach(network => {
            if (network.note && network.note.trim() !== '') {
                noteStmt.run([
                    network.ssid,
                    network.note,
                    Date.now()
                ]);
                noteCount++;
            }
        });
        
        console.log(`Exported ${networks.length} networks and ${noteCount} notes`);
        noteStmt.free();
        
        // Export the database to a binary array
        const data = exportDb.export();
        
        return data;
    }
}

// Create a global instance that can be accessed by other scripts
window.masterDb = new MasterDatabase(); 