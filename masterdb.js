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
                    
                    // Create base network table
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
                            bestlevel INTEGER NOT NULL DEFAULT 0
                        )
                    `);
                    
                    // Add note columns separately
                    try {
                        this.db.run(`ALTER TABLE network ADD COLUMN note TEXT`);
                        this.db.run(`ALTER TABLE network ADD COLUMN note_timestamp INTEGER`);
                    } catch (e) {
                        // Columns might already exist
                        console.log('Note columns might already exist');
                    }
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
            
            // First check if our network table has the note columns
            try {
                // Try to add note columns - if they exist, this will fail silently
                this.db.run(`ALTER TABLE network ADD COLUMN note TEXT`);
                this.db.run(`ALTER TABLE network ADD COLUMN note_timestamp INTEGER`);
            } catch (e) {
                // Column might already exist, that's fine
                console.log('Note columns might already exist');
            }
            
            // Import networks
            const networks = importDb.exec(`
                SELECT bssid, ssid, frequency, capabilities, lasttime, 
                       lastlat, lastlon, type, bestlevel
                FROM network
                WHERE lastlat IS NOT NULL AND lastlon IS NOT NULL`
            );
            
            if (!networks || networks.length === 0) {
                console.log('No networks found in import database');
                return { added: 0, updated: 0 };
            }
            
            let stats = { added: 0, updated: 0, notes: 0 };
            
            // Begin transaction
            this.db.run('BEGIN TRANSACTION');
            
            try {
                // Import networks
                networks[0].values.forEach(network => {
                    try {
                        this.db.run(`
                            INSERT OR REPLACE INTO network 
                            (bssid, ssid, frequency, capabilities, lasttime, 
                             lastlat, lastlon, type, bestlevel)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            network
                        );
                        stats.added++;
                    } catch (e) {
                        console.error('Error inserting network:', e);
                    }
                });
                
                // Check if old notes table exists and import notes if it does
                try {
                    const notes = importDb.exec(`
                        SELECT bssid, note, timestamp 
                        FROM network_notes`
                    );
                    
                    if (notes && notes.length > 0) {
                        notes[0].values.forEach(([bssid, note, timestamp]) => {
                            try {
                                this.db.run(`
                                    UPDATE network 
                                    SET note = ?, note_timestamp = ?
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
                    // network_notes table doesn't exist, that's fine for new databases
                    console.log('No notes table found in import database');
                }
                
                this.db.run('COMMIT');
                
                // Save to localStorage after import
                await this.saveToLocalStorage();
                
                console.log(`Import complete: ${stats.added} networks, ${stats.notes} notes`);
            } catch (error) {
                this.db.run('ROLLBACK');
                throw error;
            }
            
            importDb.close();
            return stats;
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
            
            // Get networks with notes count
            const notesCount = this.db.exec(`
                SELECT COUNT(*) as count 
                FROM network_notes`
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
                totalNetworks: networkCount[0].values[0][0],
                networksWithNotes: notesCount[0].values[0][0],
                lastImport: new Date(),
                networkTypes: {},
                securityTypes: {}
            };

            // Process network types
            if (types && types[0]) {
                types[0].values.forEach(([type, count]) => {
                    stats.networkTypes[type || 'Unknown'] = count;
                });
            }

            // Process security types
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