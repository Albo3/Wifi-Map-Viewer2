// Master database management using IndexedDB
class MasterDatabase {
    constructor() {
        this.db = null;
        this.SQL = null;
    }

    async init() {
        try {
            // Initialize SQL.js
            if (!this.SQL) {
                this.SQL = await initSqlJs({ 
                    locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
                });
            }
            
            // Try to load existing database from localStorage
            if (!this.db) {
                const loaded = await this.loadFromLocalStorage();
                if (!loaded) {
                    // Create new database if none exists
                    this.db = new this.SQL.Database();
                    
                    // Create base network table with all needed columns
                    this.db.run(`
                        CREATE TABLE network (
                            bssid TEXT PRIMARY KEY NOT NULL,
                            ssid TEXT NOT NULL,
                            frequency INTEGER NOT NULL,
                            capabilities TEXT NOT NULL,
                            lasttime INTEGER NOT NULL,
                            lastlat REAL NOT NULL,
                            lastlon REAL NOT NULL,
                            type TEXT NOT NULL DEFAULT 'W',
                            bestlevel INTEGER NOT NULL DEFAULT 0,
                            observations INTEGER DEFAULT 1,
                            accuracy FLOAT DEFAULT 0,
                            bestAccuracy FLOAT DEFAULT 0,
                            note TEXT,
                            note_timestamp INTEGER
                        )
                    `);
                }
            }
            
            // Save initial database state
            await this.saveToLocalStorage();
            
            return this.db;
        } catch (error) {
            console.error('Error initializing database:', error);
            throw error;
        }
    }

    // Import data from a WiGLE SQLite database
    async importFromSQLite(sqliteData) {
        try {
            if (!this.SQL) {
                await this.init();
            }
            
            const importDb = new this.SQL.Database(new Uint8Array(sqliteData));
            
            // Check if this is a WiGLE database (has location table) or our exported database
            let isWigleDb = false;
            try {
                const tables = importDb.exec(`SELECT name FROM sqlite_master WHERE type='table'`);
                isWigleDb = tables[0].values.some(([name]) => name === 'location');
            } catch (e) {
                console.log('Error checking tables:', e);
            }

            let networks;
            
            if (isWigleDb) {
                // Use the existing WiGLE import query with location table
                networks = importDb.exec(`
                    WITH best_locations AS (
                        SELECT 
                            bssid,
                            lat, lon, level, accuracy,
                            ROW_NUMBER() OVER (
                                PARTITION BY bssid 
                                ORDER BY accuracy ASC, ABS(level) ASC
                            ) as quality_rank
                        FROM location
                        WHERE lat IS NOT NULL AND lon IS NOT NULL
                    ),
                    location_stats AS (
                        SELECT 
                            bssid,
                            AVG(lat) as avg_lat,
                            AVG(lon) as avg_lon,
                            MIN(accuracy) as best_accuracy,
                            MAX(level) as best_level,
                            COUNT(*) as observation_count
                        FROM best_locations
                        WHERE quality_rank <= 3
                        GROUP BY bssid
                    ),
                    network_groups AS (
                        SELECT 
                            n.ssid,
                            FIRST_VALUE(n.bssid) OVER (
                                PARTITION BY n.ssid 
                                ORDER BY COALESCE(l.best_level, n.bestlevel) DESC
                            ) as primary_bssid,
                            COUNT(DISTINCT n.bssid) as ap_count
                        FROM network n
                        LEFT JOIN location_stats l ON n.bssid = l.bssid
                        GROUP BY n.ssid
                    )
                    SELECT 
                        n.bssid,
                        n.ssid,
                        n.frequency,
                        n.capabilities,
                        n.lasttime,
                        COALESCE(l.avg_lat, n.lastlat) as lastlat,
                        COALESCE(l.avg_lon, n.lastlon) as lastlon,
                        n.type,
                        COALESCE(l.best_level, n.bestlevel) as bestlevel,
                        COALESCE(l.best_accuracy, 0) as accuracy,
                        COALESCE(l.observation_count, 1) as observations,
                        g.ap_count as access_points
                    FROM network n
                    LEFT JOIN location_stats l ON n.bssid = l.bssid
                    LEFT JOIN network_groups g ON n.ssid = g.ssid
                    WHERE n.bssid IS NOT NULL
                      AND COALESCE(l.avg_lat, n.lastlat) IS NOT NULL
                      AND COALESCE(l.avg_lon, n.lastlon) IS NOT NULL
                      AND n.bssid = g.primary_bssid
                    GROUP BY n.ssid
                `);
            } else {
                // Import from our exported database format
                networks = importDb.exec(`
                    WITH network_groups AS (
                        SELECT 
                            ssid,
                            FIRST_VALUE(bssid) OVER (
                                PARTITION BY ssid 
                                ORDER BY bestlevel DESC
                            ) as primary_bssid,
                            COUNT(DISTINCT bssid) as ap_count
                        FROM network
                        GROUP BY ssid
                    )
                    SELECT 
                        n.bssid,
                        n.ssid,
                        n.frequency,
                        n.capabilities,
                        n.lasttime,
                        n.lastlat,
                        n.lastlon,
                        n.type,
                        n.bestlevel,
                        n.accuracy,
                        n.observations,
                        g.ap_count as access_points,
                        n.note,
                        n.note_timestamp
                    FROM network n
                    LEFT JOIN network_groups g ON n.ssid = g.ssid
                    WHERE n.bssid IS NOT NULL
                      AND n.lastlat IS NOT NULL
                      AND n.lastlon IS NOT NULL
                      AND n.bssid = g.primary_bssid
                    GROUP BY n.ssid
                `);
            }
            
            if (!networks || networks.length === 0) {
                console.log('No networks found in import database');
                return { added: 0, updated: 0 };
            }
            
            let stats = { added: 0, updated: 0, notes: 0 };
            
            // Begin transaction
            this.db.run('BEGIN TRANSACTION');
            
            try {
                // Process each network
                networks[0].values.forEach(network => {
                    try {
                        const bssid = network[0];
                        if (!bssid) {
                            console.warn('Skipping network with no BSSID:', network);
                            return;
                        }

                        const newLat = network[5];
                        const newLon = network[6];
                        const newLevel = network[8];
                        const newAccuracy = network[9];
                        const observations = network[10];
                        // Get note data from our saved format
                        const note = network[12];  // Index for note in our saved format
                        const noteTimestamp = network[13];  // Index for note_timestamp
                        
                        // Check if network exists
                        const existing = this.db.exec(`
                            SELECT lastlat, lastlon, bestlevel, observations, 
                                   accuracy, bestAccuracy, note, note_timestamp 
                            FROM network 
                            WHERE bssid = ?`, 
                            [bssid]
                        );
                        
                        if (existing && existing.length > 0 && existing[0].values.length > 0) {
                            // Update existing network with better position data and preserve notes
                            this.db.run(`
                                UPDATE network 
                                SET lastlat = ?,
                                    lastlon = ?,
                                    bestlevel = ?,
                                    observations = ?,
                                    lasttime = MAX(lasttime, ?),
                                    ssid = ?,
                                    frequency = ?,
                                    capabilities = ?,
                                    type = ?,
                                    accuracy = ?,
                                    bestAccuracy = ?,
                                    note = COALESCE(?, note),
                                    note_timestamp = COALESCE(?, note_timestamp)
                                WHERE bssid = ?`,
                                [newLat, newLon, newLevel, observations,
                                 network[4], network[1], network[2], network[3],
                                 network[7], newAccuracy, 
                                 Math.min(existing[0].values[0][5] || Infinity, newAccuracy),
                                 note, noteTimestamp,  // Add note data to update
                                 bssid]
                            );
                            stats.updated++;
                            if (note) stats.notes++;
                        } else {
                            // Insert new network with notes
                            this.db.run(`
                                INSERT INTO network 
                                (bssid, ssid, frequency, capabilities, lasttime,
                                 lastlat, lastlon, type, bestlevel, observations,
                                 accuracy, bestAccuracy, note, note_timestamp)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [bssid, network[1], network[2], network[3], network[4],
                                 newLat, newLon, network[7], newLevel, observations,
                                 newAccuracy, newAccuracy, note, noteTimestamp]  // Include note data in insert
                            );
                            stats.added++;
                            if (note) stats.notes++;
                        }
                    } catch (e) {
                        console.error('Error processing network:', e, network);
                    }
                });
                
                // Import notes if they exist
                try {
                    const notes = importDb.exec(`SELECT bssid, note, timestamp FROM network_notes`);
                    if (notes && notes.length > 0) {
                        notes[0].values.forEach(([bssid, note, timestamp]) => {
                            try {
                                this.db.run(`
                                    UPDATE network 
                                    SET note = COALESCE(note, ?),
                                        note_timestamp = COALESCE(note_timestamp, ?)
                                    WHERE bssid = ?`,
                                    [note, timestamp, bssid]
                                );
                                stats.notes++;
                            } catch (e) {
                                console.error('Error importing note:', e);
                            }
                        });
                    }
                } catch (e) {
                    console.log('No notes table found in import database');
                }
                
                this.db.run('COMMIT');
                await this.saveToLocalStorage();
                
                console.log(`Import complete: ${stats.added} added, ${stats.updated} updated, ${stats.notes} notes`);
                return stats;
                
            } catch (error) {
                this.db.run('ROLLBACK');
                throw error;
            }
        } catch (error) {
            console.error('Error in importFromSQLite:', error);
            throw error;
        }
    }

    // Get all networks for display
    async getAllNetworks() {
        if (!this.db) await this.init();
        
        try {
            // Log the query execution for debugging
            console.log('Executing getAllNetworks query...');
            
            const result = this.db.exec(`
                SELECT 
                    bssid,
                    ssid,
                    frequency,
                    capabilities,
                    lasttime,
                    lastlat,
                    lastlon,
                    type,
                    bestlevel,
                    note
                FROM network
                WHERE lastlat IS NOT NULL AND lastlon IS NOT NULL
                ORDER BY bestlevel DESC
            `);
            
            if (!result || result.length === 0) {
                console.log('No networks found');
                return [];
            }
            
            // Log the first few results for debugging
            console.log('First few networks:', result[0].values.slice(0, 3));
            
            const columns = result[0].columns;
            const networks = result[0].values.map(row => {
                const network = {
                    bssid: row[columns.indexOf('bssid')],
                    ssid: row[columns.indexOf('ssid')],
                    frequency: row[columns.indexOf('frequency')],
                    capabilities: row[columns.indexOf('capabilities')],
                    lasttime: row[columns.indexOf('lasttime')],
                    lastlat: row[columns.indexOf('lastlat')],
                    lastlon: row[columns.indexOf('lastlon')],
                    type: row[columns.indexOf('type')],
                    bestlevel: row[columns.indexOf('bestlevel')],
                    note: row[columns.indexOf('note')] || ''
                };
                
                // Log networks with notes for debugging
                if (network.note) {
                    console.log('Found network with note:', {
                        ssid: network.ssid,
                        bssid: network.bssid,
                        note: network.note
                    });
                }
                
                return network;
            });
            
            return networks;
        } catch (error) {
            console.error('Error getting networks:', error);
            return [];
        }
    }

    // Save a note for a network
    async saveNote(bssid, note) {
        if (!this.db) await this.init();
        
        try {
            const timestamp = Date.now();
            
            console.log('Saving note:', { bssid, note, timestamp });
            
            if (!bssid) throw new Error('BSSID is required');
            
            this.db.run(`
                UPDATE network 
                SET note = $note, 
                    note_timestamp = $timestamp
                WHERE bssid = $bssid`,
                {
                    $bssid: bssid,
                    $note: note || '',
                    $timestamp: timestamp
                }
            );
            
            await this.saveToLocalStorage();
            console.log(`Note saved for network: ${bssid}`);
        } catch (error) {
            console.error('Error saving note:', error);
            throw error;
        }
    }

    // Get note for a network
    async getNote(ssid, bssid) {
        if (!this.db) await this.init();
        
        const result = this.db.exec(`
            SELECT note, timestamp 
            FROM network_notes 
            WHERE bssid = ?`,
            [bssid]
        );
        
        if (result.length > 0 && result[0].values.length > 0) {
            return {
                note: result[0].values[0][0],
                timestamp: result[0].values[0][1]
            };
        }
        
        return null;
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
        
        try {
            // Get total networks
            const networkCount = this.db.exec(`
                SELECT COUNT(*) as count 
                FROM network
                WHERE lastlat IS NOT NULL AND lastlon IS NOT NULL`
            );
            
            // Get networks with notes count - updated query
            const notesCount = this.db.exec(`
                SELECT COUNT(*) as count 
                FROM network
                WHERE note IS NOT NULL 
                  AND note != ''
                  AND note_timestamp IS NOT NULL`
            );
            
            // Get network types
            const types = this.db.exec(`
                SELECT type, COUNT(*) as count 
                FROM network 
                GROUP BY type`
            );
            
            // Get security types
            const security = this.db.exec(`
                SELECT capabilities, COUNT(*) as count 
                FROM network 
                GROUP BY capabilities`
            );

            const stats = {
                totalNetworks: networkCount[0]?.values[0]?.[0] || 0,
                networksWithNotes: notesCount[0]?.values[0]?.[0] || 0,
                lastImport: new Date(),
                networkTypes: {},
                securityTypes: {}
            };

            if (types && types[0]) {
                types[0].values.forEach(([type, count]) => {
                    stats.networkTypes[type || 'Unknown'] = count;
                });
            }

            if (security && security[0]) {
                security[0].values.forEach(([capabilities, count]) => {
                    stats.securityTypes[capabilities || 'Unknown'] = count;
                });
            }

            return stats;
        } catch (error) {
            console.error('Error getting stats:', error);
            return {
                totalNetworks: 0,
                networksWithNotes: 0,
                networkTypes: {},
                securityTypes: {}
            };
        }
    }

    // Export the entire database as a SQLite file - improve note handling
    async exportToSQLite() {
        if (!this.db) await this.init();
        return this.db.export();
    }

    // Add methods to persist and load the database
    async saveToLocalStorage() {
        try {
            if (!this.db) return;
            const data = this.db.export();
            const base64 = arrayBufferToBase64(data);
            localStorage.setItem('wifiDatabase', base64);
            console.log('Database saved to localStorage');
        } catch (error) {
            console.error('Error saving to localStorage:', error);
        }
    }

    async loadFromLocalStorage() {
        try {
            const savedData = localStorage.getItem('wifiDatabase');
            if (savedData) {
                const arrayBuffer = base64ToArrayBuffer(savedData);
                this.db = new this.SQL.Database(new Uint8Array(arrayBuffer));
                console.log('Database loaded from localStorage');
                return true;
            }
        } catch (error) {
            console.error('Error loading from localStorage:', error);
        }
        return false;
    }

    // Debug method to check notes in database
    async checkNotes() {
        if (!this.db) await this.init();
        
        try {
            const result = this.db.exec(`
                SELECT n.ssid, n.bssid, nn.note, nn.timestamp
                FROM network_notes nn
                JOIN network n ON n.bssid = nn.bssid
            `);
            
            if (!result || result.length === 0) {
                console.log('No notes found in database');
                return;
            }
            
            console.log('Notes in database:', result[0].values);
        } catch (error) {
            console.error('Error checking notes:', error);
        }
    }
}

// Helper functions for base64 conversion
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

// Create global instance
window.masterDb = new MasterDatabase(); 