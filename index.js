
const { 
    default: giftedConnect, 
    isJidGroup, 
    jidNormalizedUser,
    isJidBroadcast,
    downloadMediaMessage, 
    downloadContentFromMessage,
    DisconnectReason, 
    getContentType,
    fetchLatestWaWebVersion, 
    useMultiFileAuthState, 
    makeCacheableSignalKeyStore,
    jidDecode 
} = require("gifted-baileys");

const { 
    evt, 
    logger,
    emojis,
    gmdStore,
    commands,
    setSudo,
    delSudo,
    GiftedTechApi,
    GiftedApiKey,
    GiftedAutoReact,
    GiftedAntiLink,
    GiftedAutoBio,
    GiftedChatBot,
    loadSession,
    getMediaBuffer,
    getSudoNumbers,
    getFileContentType,
    bufferToStream,
    uploadToPixhost,
    uploadToImgBB,
    setCommitHash, 
    getCommitHash,
    gmdBuffer, gmdJson, 
    formatAudio, formatVideo,
    uploadToGithubCdn,
    uploadToGiftedCdn,
    uploadToPasteboard,
    uploadToCatbox,
    GiftedAnticall,
    createContext, 
    createContext2,
    verifyJidState,
    GiftedPresence,
    GiftedAntiDelete
} = require("./gift");

const { 
    Sticker, 
    createSticker, 
    StickerTypes 
} = require("wa-sticker-formatter");
const pino = require("pino");
const config = require("./config");
const axios = require("axios");
const googleTTS = require("google-tts-api");
const fs = require("fs-extra");
const path = require("path");
const { Boom } = require("@hapi/boom");
const express = require("express");
const { promisify } = require('util');
const stream = require('stream');
const pipeline = promisify(stream.pipeline);
const {
    MODE: botMode, 
    BOT_PIC: botPic, 
    FOOTER: botFooter, 
    CAPTION: botCaption, 
    VERSION: botVersion, 
    OWNER_NUMBER: ownerNumber, 
    OWNER_NAME: ownerName,  
    BOT_NAME: botName, 
    PREFIX: botPrefix,
    PRESENCE: botPresence,
    CHATBOT: chatBot,
    CHATBOT_MODE: chatBotMode,
    STARTING_MESSAGE: startMess,
    ANTIDELETE: antiDelete,
    ANTILINK: antiLink,
    ANTICALL: antiCall,
    TIME_ZONE: timeZone,
    BOT_REPO: giftedRepo,
    NEWSLETTER_JID: newsletterJid,
    NEWSLETTER_URL: newsletterUrl,
    AUTO_REACT: autoReact,
    AUTO_READ_STATUS: autoReadStatus,
    AUTO_LIKE_STATUS: autoLikeStatus,
    STATUS_LIKE_EMOJIS: statusLikeEmojis,
    AUTO_REPLY_STATUS: autoReplyStatus,
    STATUS_REPLY_TEXT: statusReplyText,
    AUTO_READ_MESSAGES: autoRead,
    AUTO_BLOCK: autoBlock,
    AUTO_BIO: autoBio } = config;
const PORT = process.env.PORT || 4420;
const app = express();

// ===== RENDER DEPLOYMENT SYSTEM =====
const sessionManager = require('./sessionManager');
let Gifted = null;
let isBotRunning = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 50;
const RECONNECT_DELAY = 5000;

// Initialize logger
logger.level = "silent";

// Serve static files
app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Deployment status tracking
let deploymentStatus = {
    isDeployed: false,
    sessionExists: false,
    botConnected: false,
    lastDeployment: null,
    error: null
};

// ===== EXPRESS ROUTES FOR DEPLOYMENT =====

// Serve deployment page
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/deploy.html");
});

// API: Get deployment status
app.get("/api/status", (req, res) => {
    deploymentStatus.sessionExists = sessionManager.checkSessionExists();
    res.json({
        ...deploymentStatus,
        renderServiceId: process.env.RENDER_SERVICE_ID || 'not-set',
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

// API: Deploy with session
app.post("/api/deploy", async (req, res) => {
    try {
        const { sessionId } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "Session ID is required"
            });
        }

        // Validate session format
        if (!sessionId.startsWith('Gifted~')) {
            return res.status(400).json({
                success: false,
                message: "Invalid session format. Must start with 'Gifted~'"
            });
        }

        // Check if bot is already running
        if (isBotRunning) {
            return res.status(400).json({
                success: false,
                message: "Bot is already running. Please wait or restart the service."
            });
        }

        // Save session
        const saveResult = await sessionManager.saveSession(sessionId);
        
        if (!saveResult.success) {
            return res.status(500).json({
                success: false,
                message: `Failed to save session: ${saveResult.error}`
            });
        }

        // Update deployment status
        deploymentStatus = {
            isDeployed: true,
            sessionExists: true,
            botConnected: false,
            lastDeployment: new Date().toISOString(),
            error: null
        };

        // Start bot in background
        setTimeout(() => {
            startGifted().catch(err => {
                console.error("Bot startup error:", err.message);
                deploymentStatus.error = err.message;
            });
        }, 1000);

        res.json({
            success: true,
            message: "Session saved successfully! Starting bot...",
            nextSteps: "The bot will connect shortly. Check /api/status for updates."
        });

    } catch (error) {
        console.error("Deployment error:", error);
        res.status(500).json({
            success: false,
            message: `Deployment failed: ${error.message}`
        });
    }
});

// API: Stop bot
app.post("/api/stop", async (req, res) => {
    try {
        if (Gifted && Gifted.ws) {
            await Gifted.end();
            Gifted = null;
        }
        
        isBotRunning = false;
        deploymentStatus.botConnected = false;
        
        res.json({
            success: true,
            message: "Bot stopped successfully"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Failed to stop bot: ${error.message}`
        });
    }
});

// API: Restart bot
app.post("/api/restart", async (req, res) => {
    try {
        if (Gifted && Gifted.ws) {
            await Gifted.end();
        }
        
        isBotRunning = false;
        Gifted = null;
        
        // Start again
        setTimeout(() => {
            startGifted().catch(err => {
                console.error("Restart error:", err.message);
            });
        }, 2000);
        
        res.json({
            success: true,
            message: "Bot restart initiated"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Restart failed: ${error.message}`
        });
    }
});

// Start Express server
app.listen(PORT, () => {
    console.log(`🚀 Render Deployment Server running on port: ${PORT}`);
    console.log(`📱 Access at: http://localhost:${PORT}`);
    
    // Check for existing session on startup
    if (sessionManager.checkSessionExists()) {
        console.log("✅ Existing session found. Starting bot...");
        deploymentStatus.sessionExists = true;
        setTimeout(() => {
            startGifted().catch(err => {
                console.error("Auto-start failed:", err.message);
            });
        }, 3000);
    } else {
        console.log("📝 No session found. Please deploy via web interface.");
    }
});

// ===== WHATSAPP BOT LOGIC =====

async function startGifted() {
    if (isBotRunning) {
        console.log("⚠️ Bot is already running");
        return;
    }

    try {
        // Check session exists
        if (!sessionManager.checkSessionExists()) {
            console.log("❌ No session available. Please deploy first.");
            deploymentStatus.error = "No session available";
            return;
        }

        console.log("🚀 Starting WhatsApp bot...");
        isBotRunning = true;
        deploymentStatus.error = null;

        const { version, isLatest } = await fetchLatestWaWebVersion();
        const sessionDir = path.join(__dirname, "gift", "session");
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        // Create or reuse store
        let store;
        if (store) {
            store.destroy();
        }
        store = new gmdStore();
        
        // Configure socket
        const giftedSock = {
            version,
            logger: pino({ level: "silent" }),
            browser: ['GIFTED-MD', "Chrome", "1.0.0"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            getMessage: async (key) => {
                if (store) {
                    const msg = store.loadMessage(key.remoteJid, key.id);
                    return msg?.message || undefined;
                }
                return { conversation: 'GIFTED-MD' };
            },
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            markOnlineOnConnect: true,
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
            patchMessageBeforeSending: (message) => {
                const requiresPatch = !!(
                    message.buttonsMessage ||
                    message.templateMessage ||
                    message.listMessage
                );
                if (requiresPatch) {
                    message = {
                        viewOnceMessage: {
                            message: {
                                messageContextInfo: {
                                    deviceListMetadataVersion: 2,
                                    deviceListMetadata: {},
                                },
                                ...message,
                            },
                        },
                    };
                }
                return message;
            }
        };

        // Connect to WhatsApp
        Gifted = giftedConnect(giftedSock);
        store.bind(Gifted.ev);

        // Handle credential updates
        Gifted.ev.process(async (events) => {
            if (events['creds.update']) {
                await saveCreds();
            }
        });

        // ===== EXISTING BOT FUNCTIONALITY =====
        // [Keep all your existing bot functionality from the original index.js]
        // This includes:
        // - Auto react
        // - Anti-delete
        // - Auto bio
        // - Anti-call
        // - Chatbot
        // - Anti-link
        // - Status handling
        // - Plugin loading
        // - Message processing
        // - Command handling
        
        // For brevity, I'm including the structure but you should copy your actual bot logic here
        // Copy all your existing Gifted.ev.on handlers from the original index.js
        
        // Connection update handler
        Gifted.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === "connecting") {
                console.log("🕗 Connecting to WhatsApp...");
            }

            if (connection === "open") {
                console.log("✅ WhatsApp connection established");
                deploymentStatus.botConnected = true;
                deploymentStatus.error = null;
                
                // Send connection message if configured
                if (startMess === 'true' && Gifted.user?.id) {
                    try {
                        const totalCommands = commands.filter(c => c.pattern).length;
                        const md = botMode === 'public' ? "public" : "private";
                        const connectionMsg = `
*${botName} CONNECTED*

Prefix    : *[ ${botPrefix} ]*
Plugins   : *${totalCommands}*
Mode      : *${md}*
Owner     : *${ownerNumber}*
Tutorials : *${config.YT || 'N/A'}*
Updates   : *${newsletterUrl}*

> ${botCaption}`;

                        await Gifted.sendMessage(
                            Gifted.user.id,
                            {
                                text: connectionMsg,
                                ...createContext(botName, {
                                    title: "BOT DEPLOYED ON RENDER",
                                    body: "Status: Ready for Use"
                                })
                            }
                        );
                    } catch (err) {
                        console.error("Connection message error:", err);
                    }
                }
            }

            if (connection === "close") {
                deploymentStatus.botConnected = false;
                const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                console.log(`Connection closed: ${reason}`);
                
                // Handle reconnection
                if ([
                    DisconnectReason.connectionClosed,
                    DisconnectReason.connectionLost,
                    DisconnectReason.restartRequired,
                    DisconnectReason.timedOut
                ].includes(reason)) {
                    console.log("Attempting to reconnect...");
                    setTimeout(() => reconnectWithRetry(), RECONNECT_DELAY);
                } else if (reason === DisconnectReason.badSession || 
                          reason === DisconnectReason.loggedOut) {
                    console.log("Session invalid. Please redeploy.");
                    deploymentStatus.error = "Session invalid - please redeploy";
                    sessionManager.clearSession();
                }
            }
        });

    } catch (error) {
        console.error('Bot startup error:', error);
        deploymentStatus.error = error.message;
        isBotRunning = false;
        
        // Attempt reconnection
        setTimeout(() => reconnectWithRetry(), RECONNECT_DELAY);
    }
}

// Reconnection logic
async function reconnectWithRetry() {
    if (!isBotRunning) return;
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('Max reconnection attempts reached');
        deploymentStatus.error = "Max reconnection attempts reached";
        isBotRunning = false;
        return;
    }

    reconnectAttempts++;
    const delay = Math.min(RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), 300000);
    
    console.log(`Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
    
    setTimeout(async () => {
        try {
            await startGifted();
            reconnectAttempts = 0;
        } catch (error) {
            console.error('Reconnection failed:', error);
            reconnectWithRetry();
        }
    }, delay);
}

// Graceful shutdown
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function cleanup() {
    console.log('Shutting down...');
    if (Gifted && Gifted.ws) {
        await Gifted.end();
    }
    process.exit(0);
}
