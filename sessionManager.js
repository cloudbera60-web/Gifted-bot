
const fs = require('fs-extra');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

class SessionManager {
    constructor() {
        this.sessionDir = path.join(__dirname, 'gift', 'session');
        this.sessionPath = path.join(this.sessionDir, 'creds.json');
        this.sessionLockPath = path.join(this.sessionDir, '.lock');
        this.ensureDirectories();
    }

    ensureDirectories() {
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }
        if (!fs.existsSync(path.join(__dirname, 'gift', 'temp'))) {
            fs.mkdirSync(path.join(__dirname, 'gift', 'temp'), { recursive: true });
        }
    }

    checkSessionExists() {
        try {
            return fs.existsSync(this.sessionPath) && 
                   fs.statSync(this.sessionPath).size > 0;
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
            
            // Lock expires after 5 minutes
            if (now - lockData.timestamp > 300000) {
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
                serviceId: process.env.RENDER_SERVICE_ID || 'unknown'
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
            // Ignore
        }
    }

    async saveSession(sessionId) {
        try {
            // Prevent concurrent deployments
            if (this.isSessionLocked()) {
                return {
                    success: false,
                    error: 'Another deployment is in progress. Please wait.'
                };
            }

            // Set lock
            this.setSessionLock(true);

            // Validate session format
            const [header, b64data] = sessionId.split('~');
            
            if (header !== 'Gifted' || !b64data) {
                this.clearSessionLock();
                return {
                    success: false,
                    error: 'Invalid session format. Expected: Gifted~BASE64_DATA'
                };
            }

            // Clean and decode
            const cleanB64 = b64data.replace(/\.{3,}/g, '');
            const compressedData = Buffer.from(cleanB64, 'base64');
            
            if (compressedData.length < 100) {
                this.clearSessionLock();
                return {
                    success: false,
                    error: 'Session data too short (likely invalid)'
                };
            }

            // Decompress
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

            // Validate JSON structure
            let sessionJson;
            try {
                sessionJson = JSON.parse(decompressedData.toString('utf8'));
                
                // Basic validation of WhatsApp session structure
                if (!sessionJson.creds || !sessionJson.creds.noiseKey || !sessionJson.creds.signedIdentityKey) {
                    throw new Error('Invalid session structure');
                }
            } catch (parseError) {
                this.clearSessionLock();
                return {
                    success: false,
                    error: 'Invalid session data (not valid JSON)'
                };
            }

            // Backup existing session if it exists
            if (this.checkSessionExists()) {
                const backupDir = path.join(this.sessionDir, 'backups');
                if (!fs.existsSync(backupDir)) {
                    fs.mkdirSync(backupDir, { recursive: true });
                }
                const backupName = `creds_backup_${Date.now()}.json`;
                fs.copyFileSync(this.sessionPath, path.join(backupDir, backupName));
                console.log(`📦 Existing session backed up as ${backupName}`);
            }

            // Save new session
            fs.writeFileSync(this.sessionPath, decompressedData, 'utf8');
            
            // Ensure proper permissions
            fs.chmodSync(this.sessionPath, 0o600);
            
            // Create auth_info_baileys.json for compatibility
            const authInfoPath = path.join(this.sessionDir, 'auth_info_baileys.json');
            fs.writeFileSync(authInfoPath, JSON.stringify(sessionJson, null, 2));

            console.log('✅ Session saved successfully');
            
            // Release lock after a short delay
            setTimeout(() => {
                this.clearSessionLock();
            }, 10000);

            return {
                success: true,
                hash: this.generateSessionHash(decompressedData)
            };

        } catch (error) {
            this.clearSessionLock();
            console.error('❌ Session save error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    generateSessionHash(data) {
        return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
    }

    clearSession() {
        try {
            if (fs.existsSync(this.sessionPath)) {
                fs.unlinkSync(this.sessionPath);
            }
            
            const authInfoPath = path.join(this.sessionDir, 'auth_info_baileys.json');
            if (fs.existsSync(authInfoPath)) {
                fs.unlinkSync(authInfoPath);
            }
            
            this.clearSessionLock();
            console.log('🗑️ Session cleared');
            return true;
        } catch (error) {
            console.error('Failed to clear session:', error);
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
            const sessionData = JSON.parse(data);
            
            return {
                size: stats.size,
                modified: stats.mtime,
                hash: this.generateSessionHash(data),
                hasCreds: !!sessionData.creds,
                keysCount: sessionData.keys ? Object.keys(sessionData.keys).length : 0
            };
        } catch (error) {
            return null;
        }
    }
}

module.exports = new SessionManager();
