
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");
const util = require("util");
const zlib = require("zlib");
const sharp = require('sharp');
const FormData = require('form-data');
const { fromBuffer } = require('file-type');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { Readable } = require('stream');
ffmpeg.setFfmpegPath(ffmpegPath);

// Session directory paths
const sessionDir = path.join(__dirname, "..", "gift", "session");
const sessionPath = path.join(sessionDir, "creds.json");

// ============================
// STICKER AND IMAGE FUNCTIONS
// ============================

/**
 * Convert WebP sticker to image (PNG/GIF)
 * @param {Buffer|string} webpData - Sticker data
 * @param {Object} options - Conversion options
 * @returns {Promise<Buffer>} Image buffer
 */
async function stickerToImage(webpData, options = {}) {
    try {
        const {
            upscale = true,
            targetSize = 512,
            framesToProcess = 200
        } = options;

        if (Buffer.isBuffer(webpData)) {
            const sharpInstance = sharp(webpData, {
                sequentialRead: true,
                animated: true,
                limitInputPixels: false,
                pages: framesToProcess
            });

            const metadata = await sharpInstance.metadata();
            const isAnimated = metadata.pages > 1 || metadata.hasAlpha;

            if (isAnimated) {
                return await sharpInstance
                    .gif({
                        compressionLevel: 0,
                        quality: 100,
                        effort: 1,
                        loop: 0
                    })
                    .resize({
                        width: upscale ? targetSize : metadata.width,
                        height: upscale ? targetSize : metadata.height,
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 },
                        kernel: 'lanczos3'
                    })
                    .toBuffer();
            } else {
                return await sharpInstance
                    .ensureAlpha()
                    .resize({
                        width: upscale ? targetSize : metadata.width,
                        height: upscale ? targetSize : metadata.height,
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 },
                        kernel: 'lanczos3'
                    })
                    .png({
                        compressionLevel: 0,
                        quality: 100,
                        progressive: false,
                        palette: true
                    })
                    .toBuffer();
            }
        }
        else if (typeof webpData === 'string') {
            if (!fs.existsSync(webpData)) {
                throw new Error('File not found');
            }

            const sharpInstance = sharp(webpData, {
                sequentialRead: true,
                animated: true,
                limitInputPixels: false,
                pages: framesToProcess
            });

            const metadata = await sharpInstance.metadata();
            const isAnimated = metadata.pages > 1 || metadata.hasAlpha;
            const outputPath = webpData.replace(/\.webp$/i, isAnimated ? '.gif' : '.png');

            if (isAnimated) {
                await sharpInstance
                    .gif({
                        compressionLevel: 0,
                        quality: 100,
                        effort: 1,
                        loop: 0
                    })
                    .resize({
                        width: upscale ? targetSize : metadata.width,
                        height: upscale ? targetSize : metadata.height,
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 },
                        kernel: 'lanczos3'
                    })
                    .toFile(outputPath);
            } else {
                await sharpInstance
                    .ensureAlpha()
                    .resize({
                        width: upscale ? targetSize : metadata.width,
                        height: upscale ? targetSize : metadata.height,
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 },
                        kernel: 'lanczos3'
                    })
                    .png({
                        compressionLevel: 0,
                        quality: 100,
                        progressive: false,
                        palette: true
                    })
                    .toFile(outputPath);
            }

            const imageBuffer = fs.readFileSync(outputPath);
            fs.unlinkSync(outputPath);
            
            // Remove input file if it was temporary
            if (webpData.includes('temp_')) {
                fs.unlinkSync(webpData);
            }
            
            return imageBuffer;
        }
        else {
            throw new Error('Invalid input type for stickerToImage');
        }
    } catch (error) {
        console.error('Error in stickerToImage:', error);
        throw error;
    }
}

// ============================
// MEDIA CONVERSION FUNCTIONS
// ============================

/**
 * Process files with temporary storage
 * @param {Buffer} inputBuffer - Input buffer
 * @param {string} extension - Output extension
 * @param {Function} processFn - Processing function
 * @returns {Promise<Buffer>} Output buffer
 */
async function withTempFiles(inputBuffer, extension, processFn) {
    const tempDir = path.join(__dirname, "..", "gift", "temp");
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempInput = path.join(tempDir, `temp_${Date.now()}_in`);
    const tempOutput = path.join(tempDir, `temp_${Date.now()}_out.${extension}`);

    try {
        fs.writeFileSync(tempInput, inputBuffer);
        await processFn(tempInput, tempOutput);
        const outputBuffer = fs.readFileSync(tempOutput);
        return outputBuffer;
    } finally {
        // Cleanup temp files
        try {
            if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
            if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
        } catch (cleanupErr) {
            console.warn('Temp cleanup warning:', cleanupErr.message);
        }
    }
}

/**
 * Convert any media to MP3 audio
 * @param {Buffer} buffer - Input buffer
 * @returns {Promise<Buffer>} MP3 buffer
 */
async function toAudio(buffer) {
    return withTempFiles(buffer, 'mp3', (input, output) => {
        return new Promise((resolve, reject) => {
            ffmpeg(input)
                .noVideo()
                .audioCodec('libmp3lame')
                .audioBitrate(64)
                .audioChannels(1)
                .audioFrequency(44100)
                .toFormat('mp3')
                .on('start', (cmd) => console.log('FFmpeg start:', cmd))
                .on('error', reject)
                .on('end', () => {
                    console.log('Audio conversion complete');
                    resolve();
                })
                .save(output);
        });
    });
}

/**
 * Convert audio to WhatsApp PTT format
 * @param {Buffer} buffer - Input buffer
 * @returns {Promise<Buffer>} OGG buffer
 */
async function toPtt(buffer) {
    return withTempFiles(buffer, 'ogg', (input, output) => {
        return new Promise((resolve, reject) => {
            ffmpeg(input)
                .audioCodec('libopus')
                .audioBitrate(24)
                .audioChannels(1)
                .audioFrequency(16000)
                .outputOptions([
                    '-application voip',
                    '-frame_duration 60'
                ])
                .toFormat('ogg')
                .on('error', reject)
                .on('end', resolve)
                .save(output);
        });
    });
}

/**
 * Convert any media to MP4 video
 * @param {Buffer} buffer - Input buffer
 * @returns {Promise<Buffer>} MP4 buffer
 */
async function toVideo(buffer) {
    return withTempFiles(buffer, 'mp4', (input, output) => {
        return new Promise((resolve, reject) => {
            ffmpeg()
                .input('color=black:s=640x360:r=1')
                .inputOptions(['-f lavfi'])
                .input(input)
                .outputOptions([
                    '-shortest',
                    '-preset ultrafast',
                    '-movflags +faststart',
                    '-pix_fmt yuv420p',
                    '-crf 28',
                    '-r 30'
                ])
                .videoCodec('libx264')
                .audioCodec('aac')
                .toFormat('mp4')
                .on('error', (err) => {
                    console.error('FFmpeg video error:', err);
                    reject(err);
                })
                .on('end', () => {
                    console.log('Video conversion complete');
                    resolve();
                })
                .save(output);
        });
    });
}

/**
 * Wait for file to stabilize (finish writing)
 * @param {string} filePath - File path
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<void>}
 */
async function waitForFileToStabilize(filePath, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        let lastSize = -1;
        let stableCount = 0;
        const maxStable = 3;

        const checkInterval = setInterval(() => {
            try {
                if (!fs.existsSync(filePath)) {
                    return;
                }

                const stats = fs.statSync(filePath);
                const currentSize = stats.size;

                if (currentSize === lastSize) {
                    stableCount++;
                    if (stableCount >= maxStable) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                } else {
                    stableCount = 0;
                    lastSize = currentSize;
                }

                if (Date.now() - start > timeout) {
                    clearInterval(checkInterval);
                    reject(new Error('File stabilization timeout'));
                }
            } catch (err) {
                clearInterval(checkInterval);
                reject(err);
            }
        }, 100);
    });
}

/**
 * Format audio to standard MP3
 * @param {Buffer} buffer - Input audio buffer
 * @returns {Promise<Buffer>} Formatted MP3 buffer
 */
async function formatAudio(buffer) {
    const tempDir = path.join(__dirname, "..", "gift", "temp");
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const inputPath = path.join(tempDir, `temp_audio_in_${Date.now()}.mp3`);
    const outputPath = path.join(tempDir, `temp_audio_out_${Date.now()}.mp3`);

    fs.writeFileSync(inputPath, buffer);

    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioCodec('libmp3lame')
            .audioBitrate('128k')
            .audioFrequency(44100)
            .audioChannels(2)
            .outputOptions(['-id3v2_version 3'])
            .on('error', (err) => {
                // Cleanup on error
                try {
                    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                } catch (e) {}
                reject(err);
            })
            .on('end', async () => {
                try {
                    await waitForFileToStabilize(outputPath);
                    const formattedBuffer = fs.readFileSync(outputPath);
                    
                    // Cleanup
                    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                    
                    resolve(formattedBuffer);
                } catch (err) {
                    reject(err);
                }
            })
            .save(outputPath);
    });
}

/**
 * Format video to standard MP4
 * @param {Buffer} buffer - Input video buffer
 * @returns {Promise<Buffer>} Formatted MP4 buffer
 */
async function formatVideo(buffer) {
    const tempDir = path.join(__dirname, "..", "gift", "temp");
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const inputPath = path.join(tempDir, `temp_video_in_${Date.now()}.mp4`);
    const outputPath = path.join(tempDir, `temp_video_out_${Date.now()}.mp4`);

    fs.writeFileSync(inputPath, buffer);

    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-preset ultrafast',
                '-movflags +faststart',
                '-pix_fmt yuv420p',
                '-crf 23',
                '-maxrate 2M',
                '-bufsize 4M',
                '-r 30',
                '-g 60'
            ])
            .size('1280x720')
            .aspect('16:9')
            .audioBitrate('128k')
            .audioChannels(2)
            .audioFrequency(44100)
            .toFormat('mp4')
            .on('error', (err) => {
                // Cleanup on error
                try {
                    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                } catch (e) {}
                reject(err);
            })
            .on('end', async () => {
                try {
                    await waitForFileToStabilize(outputPath);
                    const formattedBuffer = fs.readFileSync(outputPath);
                    
                    // Cleanup
                    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                    
                    resolve(formattedBuffer);
                } catch (err) {
                    reject(err);
                }
            })
            .save(outputPath);
    });
}

// ============================
// TEXT FORMATTING FUNCTIONS
// ============================

/**
 * Convert text to monospace font
 * @param {string} input - Input text
 * @returns {string} Monospace text
 */
function monospace(input) {
    const monospaceMap = {
        'A': '𝙰', 'B': '𝙱', 'C': '𝙲', 'D': '𝙳', 'E': '𝙴', 'F': '𝙵', 'G': '𝙶',
        'H': '𝙷', 'I': '𝙸', 'J': '𝙹', 'K': '𝙺', 'L': '𝙻', 'M': '𝙼', 'N': '𝙽',
        'O': '𝙾', 'P': '𝙿', 'Q': '𝚀', 'R': '𝚁', 'S': '𝚂', 'T': '𝚃', 'U': '𝚄',
        'V': '𝚅', 'W': '𝚆', 'X': '𝚇', 'Y': '𝚈', 'Z': '𝚉',
        'a': '𝚊', 'b': '𝚋', 'c': '𝚌', 'd': '𝚍', 'e': '𝚎', 'f': '𝚏', 'g': '𝚐',
        'h': '𝚑', 'i': '𝚒', 'j': '𝚓', 'k': '𝚔', 'l': '𝚕', 'm': '𝚖', 'n': '𝚗',
        'o': '𝚘', 'p': '𝚙', 'q': '𝚚', 'r': '𝚛', 's': '𝚜', 't': '𝚝', 'u': '𝚞',
        'v': '𝚟', 'w': '𝚠', 'x': '𝚡', 'y': '𝚢', 'z': '𝚣',
        '0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔',
        '7': '𝟕', '8': '𝟖', '9': '𝟗',
        ' ': ' ', '!': '!', '?': '?', '.': '.', ',': ',', ':': ':', ';': ';',
        '(': '(', ')': ')', '[': '[', ']': ']', '{': '{', '}': '}',
        '+': '+', '-': '-', '*': '*', '/': '/', '=': '=', '<': '<', '>': '>',
        '@': '@', '#': '#', '$': '$', '%': '%', '^': '^', '&': '&', '_': '_',
        '|': '|', '~': '~', '`': '`'
    };
    
    return input.split('').map(char => monospaceMap[char] || char).join('');
}

/**
 * Format bytes to human readable size
 * @param {number} bytes - Bytes to format
 * @returns {string} Formatted size
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Generate random filename with extension
 * @param {string} ext - File extension
 * @returns {string} Random filename
 */
function gmdRandom(ext) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `${timestamp}_${random}${ext.startsWith('.') ? ext : '.' + ext}`;
}

/**
 * Convert text to various fancy fonts
 * @param {string} text - Input text
 * @returns {Promise<Array>} Array of font variations
 */
async function gmdFancy(text) {
    return new Promise((resolve, reject) => {
        axios.get('http://qaz.wtf/u/convert.cgi?text=' + encodeURIComponent(text))
            .then(({ data }) => {
                let $ = cheerio.load(data);
                let hasil = [];
                $('table > tbody > tr').each(function (a, b) {
                    const name = $(b).find('td:nth-child(1) > h6 > a').text().trim();
                    const result = $(b).find('td:nth-child(2)').text().trim();
                    if (name && result) {
                        hasil.push({ name, result });
                    }
                });
                resolve(hasil);
            })
            .catch(reject);
    });
}

// ============================
// NETWORK FUNCTIONS
// ============================

/**
 * Fetch buffer from URL
 * @param {string} url - URL to fetch
 * @param {Object} options - Axios options
 * @returns {Promise<Buffer>} Buffer data
 */
async function gmdBuffer(url, options = {}) {
    try {
        const defaultOptions = {
            method: "GET",
            url,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1'
            },
            responseType: 'arraybuffer',
            timeout: 30000,
            maxRedirects: 5
        };

        const mergedOptions = { ...defaultOptions, ...options };
        
        const res = await axios(mergedOptions);
        
        if (!res.data || res.data.length === 0) {
            throw new Error("Empty response data");
        }
        
        return res.data;
    } catch (err) {
        console.error("gmdBuffer Error:", err.message);
        throw err;
    }
}

/**
 * Fetch JSON from URL
 * @param {string} url - URL to fetch
 * @param {Object} options - Axios options
 * @returns {Promise<Object>} JSON data
 */
async function gmdJson(url, options = {}) {
    try {
        const defaultOptions = {
            method: 'GET',
            url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive'
            },
            timeout: 30000,
            maxRedirects: 5
        };

        const mergedOptions = { ...defaultOptions, ...options };
        
        const res = await axios(mergedOptions);
        
        if (!res.data) {
            throw new Error("Empty response data");
        }
        
        return res.data;
    } catch (err) {
        console.error("gmdJson Error:", err.message);
        throw err;
    }
}

/**
 * Get latest WhatsApp web version
 * @returns {Promise<Array>} Version array
 */
async function latestWaVersion() {
    try {
        const data = await gmdJson("https://web.whatsapp.com/check-update?version=1&platform=web");
        if (data && data.currentVersion) {
            return [data.currentVersion.replace(/\./g, ", ")];
        }
        return ["2.3000.0"];
    } catch (error) {
        console.error("Failed to get WA version:", error.message);
        return ["2.3000.0"];
    }
}

// ============================
// VALIDATION FUNCTIONS
// ============================

/**
 * Check if string is a valid URL
 * @param {string} url - URL to check
 * @returns {boolean} True if valid URL
 */
function isUrl(url) {
    if (typeof url !== 'string') return false;
    try {
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Check if string is a valid number
 * @param {string|number} number - Number to check
 * @returns {boolean} True if valid number
 */
function isNumber(number) {
    if (typeof number === 'number') return !isNaN(number);
    if (typeof number !== 'string') return false;
    const num = parseInt(number);
    return !isNaN(num) && isFinite(num);
}

/**
 * Verify JID format
 * @param {string} jid - JID to verify
 * @returns {boolean} True if valid JID
 */
function verifyJidState(jid) {
    if (!jid || typeof jid !== 'string') return false;
    const valid = jid.endsWith('@s.whatsapp.net') || 
                  jid.endsWith('@g.us') || 
                  jid.endsWith('@broadcast');
    if (!valid) {
        console.warn('Invalid JID format:', jid);
    }
    return valid;
}

// ============================
// ENCRYPTION FUNCTIONS
// ============================

/**
 * Encode string to base64
 * @param {string} str - String to encode
 * @returns {Promise<string>} Base64 string
 */
async function eBase(str = '') {
    return Buffer.from(str).toString('base64');
}

/**
 * Decode base64 to string
 * @param {string} base64Str - Base64 string
 * @returns {Promise<string>} Decoded string
 */
async function dBase(base64Str) {
    return Buffer.from(base64Str, 'base64').toString('utf-8');
}

/**
 * Encode string to binary
 * @param {string} str - String to encode
 * @returns {Promise<string>} Binary string
 */
async function eBinary(str = '') {
    return str.split('').map(char => 
        char.charCodeAt(0).toString(2).padStart(8, '0')
    ).join(' ');
}

/**
 * Decode binary to string
 * @param {string} binaryStr - Binary string
 * @returns {Promise<string>} Decoded string
 */
async function dBinary(binaryStr) {
    return binaryStr.split(' ').map(bin => 
        String.fromCharCode(parseInt(bin, 2))
    ).join('');
}

// ============================
// UTILITY FUNCTIONS
// ============================

/**
 * Calculate runtime from seconds
 * @param {number} seconds - Seconds
 * @returns {string} Formatted runtime
 */
function runtime(seconds) {
    seconds = Number(seconds);
    if (isNaN(seconds) || seconds < 0) return '0 seconds';
    
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    const parts = [];
    if (d > 0) parts.push(d + (d === 1 ? ' day' : ' days'));
    if (h > 0) parts.push(h + (h === 1 ? ' hour' : ' hours'));
    if (m > 0) parts.push(m + (m === 1 ? ' minute' : ' minutes'));
    if (s > 0) parts.push(s + (s === 1 ? ' second' : ' seconds'));
    
    return parts.join(', ') || '0 seconds';
}

/**
 * Sleep/wait function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================
// SESSION MANAGEMENT
// ============================

/**
 * Load session from environment/config
 * @returns {Promise<boolean>} True if session loaded successfully
 */
async function loadSession() {
    try {
        // For Render deployment, we check if session file exists
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
            console.log("📁 Created session directory");
            return false;
        }

        if (fs.existsSync(sessionPath)) {
            const stats = fs.statSync(sessionPath);
            if (stats.size > 0) {
                console.log(`✅ Session file found (${formatBytes(stats.size)})`);
                
                // Validate session JSON structure
                try {
                    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                    if (sessionData.creds && sessionData.creds.noiseKey) {
                        console.log("✅ Session is valid");
                        return true;
                    } else {
                        console.warn("⚠️ Session file exists but invalid structure");
                        return false;
                    }
                } catch (parseErr) {
                    console.error("❌ Failed to parse session file:", parseErr.message);
                    return false;
                }
            } else {
                console.log("📭 Session file is empty");
                return false;
            }
        } else {
            console.log("📭 No session file found");
            return false;
        }
    } catch (error) {
        console.error("❌ Session loading error:", error.message);
        return false;
    }
}

// ============================
// DATA STORE CLASS
// ============================

class gmdStore {
    constructor() {
        this.messages = new Map();
        this.contacts = new Map();
        this.chats = new Map();
        this.maxMessages = 10000;
        this.maxChats = 5000;
        this.cleanupInterval = null;
        this.startCleanup();
    }

    /**
     * Start periodic cleanup
     */
    startCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.cleanupInterval = setInterval(() => this.cleanup(), 300000); // 5 minutes
    }

    /**
     * Load message from store
     * @param {string} jid - Chat JID
     * @param {string} id - Message ID
     * @returns {Object|null} Message or null
     */
    loadMessage(jid, id) {
        const chatMessages = this.messages.get(jid);
        return chatMessages?.get(id) || null;
    }

    /**
     * Save message to store
     * @param {string} jid - Chat JID
     * @param {Object} message - Message object
     */
    saveMessage(jid, message) {
        if (!this.messages.has(jid)) {
            this.messages.set(jid, new Map());
        }
        
        const chatMessages = this.messages.get(jid);
        if (message.key?.id) {
            chatMessages.set(message.key.id, message);
            
            // Limit messages per chat
            if (chatMessages.size > this.maxMessages) {
                const firstKey = chatMessages.keys().next().value;
                chatMessages.delete(firstKey);
            }
        }
    }

    /**
     * Get all messages for a chat
     * @param {string} jid - Chat JID
     * @returns {Array} Messages array
     */
    getChatMessages(jid) {
        const chatMessages = this.messages.get(jid);
        return chatMessages ? Array.from(chatMessages.values()) : [];
    }

    /**
     * Clean up old data
     */
    cleanup() {
        try {
            // Clean old chats
            if (this.messages.size > this.maxChats) {
                const chatsToDelete = this.messages.size - this.maxChats;
                const oldestChats = Array.from(this.messages.keys())
                    .slice(0, chatsToDelete);
                oldestChats.forEach(jid => this.messages.delete(jid));
            }
            
            // Clean old messages in each chat
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            for (const [jid, chatMessages] of this.messages) {
                const messagesToDelete = [];
                for (const [id, message] of chatMessages) {
                    if (message.timestamp && message.timestamp < oneHourAgo) {
                        messagesToDelete.push(id);
                    }
                }
                messagesToDelete.forEach(id => chatMessages.delete(id));
            }
            
        } catch (error) {
            console.error('Store cleanup error:', error);
        }
    }

    /**
     * Bind to event emitter
     * @param {Object} ev - Event emitter
     */
    bind(ev) {
        ev.on('messages.upsert', ({ messages }) => {
            messages.forEach(msg => {
                if (msg.key?.remoteJid) {
                    msg.timestamp = Date.now();
                    this.saveMessage(msg.key.remoteJid, msg);
                }
            });
        });

        ev.on('messages.delete', ({ keys }) => {
            keys.forEach(key => {
                if (key.remoteJid) {
                    const chatMessages = this.messages.get(key.remoteJid);
                    if (chatMessages && key.id) {
                        chatMessages.delete(key.id);
                    }
                }
            });
        });

        ev.on('chats.set', ({ chats }) => {
            chats.forEach(chat => {
                this.chats.set(chat.id, chat);
            });
        });

        ev.on('contacts.set', ({ contacts }) => {
            contacts.forEach(contact => {
                this.contacts.set(contact.id, contact);
            });
        });
    }

    /**
     * Destroy store and cleanup
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.messages.clear();
        this.contacts.clear();
        this.chats.clear();
        console.log('🗑️ Store destroyed');
    }

    /**
     * Get store statistics
     * @returns {Object} Statistics
     */
    getStats() {
        let totalMessages = 0;
        for (const chatMessages of this.messages.values()) {
            totalMessages += chatMessages.size;
        }
        
        return {
            totalChats: this.messages.size,
            totalMessages,
            totalContacts: this.contacts.size,
            totalStoredChats: this.chats.size
        };
    }
}

// ============================
// EXPORT ALL FUNCTIONS
// ============================

module.exports = {
    // Media conversion
    stickerToImage,
    toAudio,
    toVideo,
    toPtt,
    formatAudio,
    formatVideo,
    
    // Text formatting
    monospace,
    formatBytes,
    gmdRandom,
    gmdFancy,
    runtime,
    
    // Network
    gmdBuffer,
    gmdJson,
    latestWaVersion,
    
    // Validation
    isUrl,
    isNumber,
    verifyJidState,
    
    // Encryption
    eBase,
    dBase,
    eBinary,
    dBinary,
    
    // Utilities
    sleep,
    loadSession,
    
    // Store
    gmdStore,
    
    // Additional helper functions
    waitForFileToStabilize
};
