
const fs = require('fs-extra');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

class SessionManager {
    constructor() {
        this.sessionDir = path.join(__dirname, '..', 'gift', 'session');
        this.sessionPath = path.join(this.sessionDir, 'creds.json');
        this.sessionLockPath = path.join(this.sessionDir, '.lock');
        this.backupDir = path.join(this.sessionDir, 'backups');
        this.ensureDirectories();
    }

    ensureDirectories() {
        // Create all necessary directories
        const dirs = [
            this.sessionDir,
            this.backupDir,
            path.join(__dirname, '..', 'gift', 'temp'),
            path.join(__dirname, '..', 'public')
        ];
        
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    checkSessionExists() {
        try {
            return fs.existsSync(this.sessionPath) && 
                   fs.statSync(this.sessionPath).size > 100; // Minimum size check
        } catch (error) {
            return false;
        }
    }

    isSessionLocked() {
        try {
            if (!fs.existsSync(this.sessionLockPath)) return false;
            
            const lockContent = fs.readFileSync(this.sessionLockPath, 'utf8');
            const lockData = JSON.parse(lockContent);
            const now = Date.now();
            
            // Lock expires after 2 minutes
            if (now - lockData.timestamp > 120000) {
                this.clearSessionLock();
                return false;
            }
            
            return lockData.locked;
        } catch (error) {
            return false;
        }
    }

    setSessionLock(locked = true) {
        try {
            const lockData = {
                locked,
                timestamp: Date.now(),
                serviceId: process.env.RENDER_SERVICE_ID || process.env.RENDER_SERVICE_NAME || 'render-service'
            };
            fs.writeFileSync(this.sessionLockPath, JSON.stringify(lockData, null, 2));
        } catch (error) {
            console.error('Failed to set session lock:', error);
        }
    }

    clearSessionLock() {
        try {
            if (fs.existsSync(this.sessionLockPath)) {
                fs.unlinkSync(this.sessionLockPath);
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    }

    async saveSession(sessionId) {
        // Set lock to prevent concurrent saves
        this.setSessionLock(true);

        try {
            console.log('🔍 Validating session format...');
            
            // Validate session format
            const [header, b64data] = sessionId.split('~');
            
            if (header !== 'Gifted' || !b64data) {
                this.clearSessionLock();
                return {
                    success: false,
                    error: 'Invalid session format. Expected: Gifted~BASE64_DATA'
                };
            }

            console.log('🔧 Cleaning session data...');
            
            // Clean base64 data
            const cleanB64 = b64data
                .replace(/\.{3,}/g, '')
                .replace(/\s/g, '')
                .trim();
            
            if (cleanB64.length < 100) {
                this.clearSessionLock();
                return {
                    success: false,
                    error: 'Session data too short (likely invalid)'
                };
            }

            console.log('📥 Decoding session data...');
            
            // Decode base64
            let compressedData;
            try {
                compressedData = Buffer.from(cleanB64, 'base64');
            } catch (decodeError) {
                this.clearSessionLock();
                return {
                    success: false,
                    error: 'Failed to decode base64 data'
                };
            }

            console.log('⚙️ Decompressing session...');
            
            // Decompress data
            let decompressedData;
            try {
                decompressedData = zlib.gunzipSync(compressedData);
            } catch (decompressError) {
                // Try inflate if gunzip fails
                try {
                    decompressedData = zlib.inflateSync(compressedData);
                } catch (inflateError) {
                    this.clearSessionLock();
                    return {
                        success: false,
                        error: 'Failed to decompress session data'
                    };
                }
            }

            console.log('🔎 Validating session structure...');
            
            // Validate JSON structure
            let sessionJson;
            try {
                sessionJson = JSON.parse(decompressedData.toString('utf8'));
                
                // Basic validation of WhatsApp session structure
                if (!sessionJson.creds) {
                    throw new Error('Missing credentials');
                }
                
                if (!sessionJson.creds.noiseKey || !sessionJson.creds.signedIdentityKey) {
                    throw new Error('Invalid session keys');
                }
            } catch (parseError) {
                this.clearSessionLock();
                return {
                    success: false,
                    error: `Invalid session data: ${parseError.message}`
                };
            }

            console.log('💾 Creating backup of existing session...');
            
            // Backup existing session if it exists
            if (this.checkSessionExists()) {
                try {
                    const backupName = `creds_backup_${Date.now()}.json`;
                    const backupPath = path.join(this.backupDir, backupName);
                    fs.copyFileSync(this.sessionPath, backupPath);
                    console.log(`📦 Backup created: ${backupName}`);
                } catch (backupError) {
                    console.warn('⚠️ Failed to create backup:', backupError.message);
                }
            }

            console.log('💿 Saving new session...');
            
            // Save new session
            fs.writeFileSync(this.sessionPath, decompressedData, 'utf8');
            
            // Set secure permissions
            try {
                fs.chmodSync(this.sessionPath, 0o600);
            } catch (permError) {
                // Ignore permission errors on some systems
            }

            // Create auth_info_baileys.json for compatibility
            const authInfoPath = path.join(this.sessionDir, 'auth_info_baileys.json');
            try {
                fs.writeFileSync(authInfoPath, JSON.stringify(sessionJson, null, 2));
                console.log('✅ Created auth_info_baileys.json');
            } catch (authError) {
                console.warn('⚠️ Failed to create auth_info_baileys.json:', authError.message);
            }

            console.log('🎉 Session saved successfully');
            
            // Release lock after short delay
            setTimeout(() => {
                this.clearSessionLock();
                console.log('🔓 Session lock released');
            }, 5000);

            return {
                success: true,
                hash: this.generateSessionHash(decompressedData),
                size: decompressedData.length
            };

        } catch (error) {
            console.error('❌ Session save error:', error);
            this.clearSessionLock();
            return {
                success: false,
                error: error.message
            };
        }
    }

    generateSessionHash(data) {
        try {
            return crypto.createHash('sha256')
                .update(data)
                .digest('hex')
                .substring(0, 16);
        } catch (error) {
            return 'unknown';
        }
    }

    clearSession() {
        try {
            console.log('🧹 Clearing session files...');
            
            let clearedCount = 0;
            const filesToClear = [
                this.sessionPath,
                path.join(this.sessionDir, 'auth_info_baileys.json'),
                path.join(this.sessionDir, 'app-state-sync-version.json'),
                path.join(this.sessionDir, 'app-state-sync-key-id.json'),
                path.join(this.sessionDir, 'pre-key-*'),
                path.join(this.sessionDir, 'sender-key-*'),
                path.join(this.sessionDir, 'session-*')
            ];

            filesToClear.forEach(filePattern => {
                try {
                    if (filePattern.includes('*')) {
                        // Handle wildcard patterns
                        const dir = path.dirname(filePattern);
                        const pattern = path.basename(filePattern);
                        
                        if (fs.existsSync(dir)) {
                            const files = fs.readdirSync(dir);
                            files.forEach(file => {
                                if (file.match(new RegExp(pattern.replace('*', '.*')))) {
                                    fs.unlinkSync(path.join(dir, file));
                                    clearedCount++;
                                }
                            });
                        }
                    } else if (fs.existsSync(filePattern)) {
                        fs.unlinkSync(filePattern);
                        clearedCount++;
                    }
                } catch (fileError) {
                    console.warn(`⚠️ Could not clear ${filePattern}:`, fileError.message);
                }
            });

            // Clear lock file
            this.clearSessionLock();
            
            // Clear backup directory
            try {
                if (fs.existsSync(this.backupDir)) {
                    const backupFiles = fs.readdirSync(this.backupDir);
                    backupFiles.forEach(file => {
                        fs.unlinkSync(path.join(this.backupDir, file));
                    });
                }
            } catch (backupError) {
                console.warn('⚠️ Could not clear backups:', backupError.message);
            }

            console.log(`🗑️ Cleared ${clearedCount} session files`);
            return true;
            
        } catch (error) {
            console.error('❌ Failed to clear session:', error);
            return false;
        }
    }

    getSessionInfo() {
        try {
            if (!this.checkSessionExists()) {
                return null;
            }

            const stats = fs.statSync(this.sessionPath);
            const data = fs.readFileSync(this.sessionPath, 'utf8');
            let sessionData;
            
            try {
                sessionData = JSON.parse(data);
            } catch (parseError) {
                return {
                    size: stats.size,
                    modified: stats.mtime,
                    valid: false,
                    error: 'Invalid JSON'
                };
            }

            return {
                size: stats.size,
                modified: stats.mtime,
                hash: this.generateSessionHash(data),
                valid: !!(sessionData.creds && sessionData.creds.noiseKey),
                hasKeys: !!(sessionData.keys && Object.keys(sessionData.keys).length > 0),
                backupCount: fs.existsSync(this.backupDir) ? 
                    fs.readdirSync(this.backupDir).length : 0
            };
        } catch (error) {
            return null;
        }
    }
}

module.exports = new SessionManager();
