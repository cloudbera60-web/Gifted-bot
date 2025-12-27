const fs = require('fs-extra');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

class SessionManager {
    constructor() {
        this.sessionDir = path.join(__dirname, 'gift', 'session');
        this.sessionPath = path.join(this.sessionDir, 'creds.json');
        this.sessionLockPath = path.join(this.sessionDir, '.lock');
        this.backupDir = path.join(this.sessionDir, 'backups');
        this.ensureDirectories();
    }

    ensureDirectories() {
        const dirs = [
            this.sessionDir,
            this.backupDir,
            path.join(__dirname, 'gift', 'temp'),
            path.join(__dirname, 'public')
        ];
        
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    checkSessionExists() {
        try {
            if (!fs.existsSync(this.sessionPath)) {
                return false;
            }
            
            const stats = fs.statSync(this.sessionPath);
            return stats.size > 100;
        } catch (error) {
            console.error('Error checking session:', error.message);
            return false;
        }
    }

    isSessionLocked() {
        try {
            if (!fs.existsSync(this.sessionLockPath)) {
                return false;
            }
            
            const lockContent = fs.readFileSync(this.sessionLockPath, 'utf8');
            const lockData = JSON.parse(lockContent);
            const now = Date.now();
            
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
                locked: locked,
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
        this.setSessionLock(true);

        try {
            console.log('Validating session format...');
            
            const [header, b64data] = sessionId.split('~');
            
            if (header !== 'Gifted' || !b64data) {
                this.clearSessionLock();
                return {
                    success: false,
                    error: 'Invalid session format. Expected: Gifted~BASE64_DATA'
                };
            }

            console.log('Cleaning session data...');
            
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

            console.log('Decoding session data...');
            
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

            console.log('Decompressing session...');
            
            let decompressedData;
            try {
                decompressedData = zlib.gunzipSync(compressedData);
            } catch (decompressError) {
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

            console.log('Validating session structure...');
            
            let sessionJson;
            try {
                sessionJson = JSON.parse(decompressedData.toString('utf8'));
                
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
                    error: 'Invalid session data: ' + parseError.message
                };
            }

            console.log('Creating backup of existing session...');
            
            if (this.checkSessionExists()) {
                try {
                    const backupName = 'creds_backup_' + Date.now() + '.json';
                    const backupPath = path.join(this.backupDir, backupName);
                    fs.copyFileSync(this.sessionPath, backupPath);
                    console.log('Backup created: ' + backupName);
                } catch (backupError) {
                    console.warn('Failed to create backup:', backupError.message);
                }
            }

            console.log('Saving new session...');
            
            fs.writeFileSync(this.sessionPath, decompressedData, 'utf8');
            
            try {
                fs.chmodSync(this.sessionPath, 0o600);
            } catch (permError) {
                // Ignore permission errors
            }

            const authInfoPath = path.join(this.sessionDir, 'auth_info_baileys.json');
            try {
                fs.writeFileSync(authInfoPath, JSON.stringify(sessionJson, null, 2));
                console.log('Created auth_info_baileys.json');
            } catch (authError) {
                console.warn('Failed to create auth_info_baileys.json:', authError.message);
            }

            console.log('Session saved successfully');
            
            setTimeout(() => {
                this.clearSessionLock();
                console.log('Session lock released');
            }, 5000);

            return {
                success: true,
                hash: this.generateSessionHash(decompressedData),
                size: decompressedData.length
            };

        } catch (error) {
            console.error('Session save error:', error);
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
            console.log('Clearing session files...');
            
            let clearedCount = 0;
            const filesToClear = [
                this.sessionPath,
                path.join(this.sessionDir, 'auth_info_baileys.json'),
                path.join(this.sessionDir, 'app-state-sync-version.json'),
                path.join(this.sessionDir, 'app-state-sync-key-id.json'),
                this.sessionLockPath
            ];

            filesToClear.forEach(filePath => {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        clearedCount++;
                    }
                } catch (fileError) {
                    console.warn('Could not clear ' + filePath + ':', fileError.message);
                }
            });

            try {
                if (fs.existsSync(this.sessionDir)) {
                    const files = fs.readdirSync(this.sessionDir);
                    files.forEach(file => {
                        if (file.startsWith('pre-key-') || 
                            file.startsWith('sender-key-') || 
                            file.startsWith('session-')) {
                            try {
                                fs.unlinkSync(path.join(this.sessionDir, file));
                                clearedCount++;
                            } catch (e) {
                                // Ignore
                            }
                        }
                    });
                }
            } catch (dirError) {
                console.warn('Could not clear session files:', dirError.message);
            }

            try {
                if (fs.existsSync(this.backupDir)) {
                    const backupFiles = fs.readdirSync(this.backupDir);
                    backupFiles.forEach(file => {
                        try {
                            fs.unlinkSync(path.join(this.backupDir, file));
                        } catch (e) {
                            // Ignore
                        }
                    });
                }
            } catch (backupError) {
                console.warn('Could not clear backups:', backupError.message);
            }

            console.log('Cleared ' + clearedCount + ' session files');
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
