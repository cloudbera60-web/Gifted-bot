const { 
    default: giftedConnect, 
    isJidGroup, 
    jidNormalizedUser,
    isJidBroadcast,
    downloadMediaMessage, 
    downloadContentFromMessage,
    downloadAndSaveMediaMessage, 
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
const crypto = require('crypto');
const zlib = require('zlib');

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
    AUTO_BIO: autoBio 
} = config;

const PORT = process.env.PORT || 4420;
const app = express();

// Global variables
let Gifted = null;
let store = null;
let currentSessionId = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 50;
const RECONNECT_DELAY = 5000;

logger.level = "silent";

// Simple middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static("public"));

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, "public");
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

// Simple HTML interface
const htmlInterface = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GIFTED-MD Session Connector</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        textarea {
            width: 100%;
            height: 200px;
            padding: 10px;
            border: 2px solid #ddd;
            border-radius: 5px;
            font-family: monospace;
            font-size: 14px;
            margin-bottom: 20px;
        }
        button {
            background: #4CAF50;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            margin-right: 10px;
        }
        button:hover {
            background: #45a049;
        }
        button:disabled {
            background: #cccccc;
            cursor: not-allowed;
        }
        #disconnectBtn {
            background: #f44336;
        }
        #disconnectBtn:hover {
            background: #da190b;
        }
        .status {
            margin-top: 20px;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 5px;
            border-left: 4px solid #007bff;
        }
        .status h3 {
            margin-top: 0;
        }
        #statusText {
            font-family: monospace;
            white-space: pre-wrap;
            max-height: 300px;
            overflow-y: auto;
        }
        .connected {
            color: green;
            font-weight: bold;
        }
        .disconnected {
            color: red;
            font-weight: bold;
        }
        .loading {
            color: orange;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 GIFTED-MD Session Connector</h1>
        
        <p>Paste your session ID below and click "Connect Bot":</p>
        
        <textarea id="sessionId" placeholder="Paste your Gifted~ session ID here..."></textarea>
        
        <div>
            <button id="connectBtn" onclick="connectBot()">🔗 Connect Bot</button>
            <button id="disconnectBtn" onclick="disconnectBot()" disabled>🔌 Disconnect</button>
            <button onclick="checkStatus()">🔄 Check Status</button>
        </div>
        
        <div class="status">
            <h3>📊 Status</h3>
            <div id="statusText">Ready to connect...</div>
        </div>
        
        <div id="botInfo" style="display:none; margin-top:20px; padding:15px; background:#e8f4fd; border-radius:5px;">
            <h3>🤖 Bot Information</h3>
            <div id="botDetails"></div>
        </div>
    </div>
    
    <script>
        let isConnected = false;
        
        function updateStatus(message, type = 'info') {
            const statusDiv = document.getElementById('statusText');
            const timestamp = new Date().toLocaleTimeString();
            statusDiv.innerHTML += \`[\${timestamp}] \${message}\\n\`;
            statusDiv.scrollTop = statusDiv.scrollHeight;
        }
        
        function clearStatus() {
            document.getElementById('statusText').innerHTML = '';
        }
        
        async function connectBot() {
            const sessionId = document.getElementById('sessionId').value.trim();
            
            if (!sessionId) {
                alert('Please paste a session ID');
                return;
            }
            
            if (!sessionId.startsWith('Gifted~')) {
                alert('Invalid session ID format. Must start with "Gifted~"');
                return;
            }
            
            document.getElementById('connectBtn').disabled = true;
            document.getElementById('connectBtn').innerText = 'Connecting...';
            
            clearStatus();
            updateStatus('🔄 Sending session ID to server...');
            
            try {
                const response = await fetch('/api/connect', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ sessionId: sessionId })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    updateStatus('✅ ' + data.message);
                    updateStatus('🔄 Starting bot connection...');
                    document.getElementById('disconnectBtn').disabled = false;
                    isConnected = true;
                    
                    // Check status every 3 seconds
                    setTimeout(checkStatus, 3000);
                } else {
                    updateStatus('❌ ' + data.message);
                    document.getElementById('connectBtn').disabled = false;
                    document.getElementById('connectBtn').innerText = '🔗 Connect Bot';
                }
                
            } catch (error) {
                updateStatus('❌ Connection error: ' + error.message);
                document.getElementById('connectBtn').disabled = false;
                document.getElementById('connectBtn').innerText = '🔗 Connect Bot';
            }
        }
        
        async function disconnectBot() {
            document.getElementById('disconnectBtn').disabled = true;
            document.getElementById('disconnectBtn').innerText = 'Disconnecting...';
            
            try {
                const response = await fetch('/api/disconnect', {
                    method: 'POST'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    updateStatus('✅ ' + data.message);
                    document.getElementById('connectBtn').disabled = false;
                    document.getElementById('connectBtn').innerText = '🔗 Connect Bot';
                    document.getElementById('disconnectBtn').innerText = '🔌 Disconnect';
                    isConnected = false;
                    document.getElementById('botInfo').style.display = 'none';
                }
                
            } catch (error) {
                updateStatus('❌ Disconnect error: ' + error.message);
                document.getElementById('disconnectBtn').disabled = false;
                document.getElementById('disconnectBtn').innerText = '🔌 Disconnect';
            }
        }
        
        async function checkStatus() {
            try {
                const response = await fetch('/api/status');
                const data = await response.json();
                
                if (data.connected && !isConnected) {
                    isConnected = true;
                    document.getElementById('connectBtn').disabled = true;
                    document.getElementById('disconnectBtn').disabled = false;
                    updateStatus('✅ Bot connected successfully!');
                    
                    // Get bot info
                    const botInfoResponse = await fetch('/api/bot-info');
                    const botInfoData = await botInfoResponse.json();
                    
                    if (botInfoData.connected) {
                        document.getElementById('botInfo').style.display = 'block';
                        document.getElementById('botDetails').innerHTML = \`
                            <p><strong>Bot ID:</strong> \${botInfoData.botId || 'N/A'}</p>
                            <p><strong>Bot Name:</strong> \${botInfoData.botName || 'N/A'}</p>
                            <p><strong>Phone:</strong> \${botInfoData.phone || 'N/A'}</p>
                            <p><strong>Status:</strong> <span class="connected">✅ Connected</span></p>
                        \`;
                    }
                } else if (!data.connected && isConnected) {
                    isConnected = false;
                    document.getElementById('connectBtn').disabled = false;
                    document.getElementById('disconnectBtn').disabled = true;
                    updateStatus('⚠️ Bot disconnected');
                    document.getElementById('botInfo').style.display = 'none';
                }
                
                // Continue checking if connected
                if (isConnected) {
                    setTimeout(checkStatus, 3000);
                }
                
            } catch (error) {
                updateStatus('⚠️ Status check error: ' + error.message);
            }
        }
        
        // Auto-focus textarea
        document.getElementById('sessionId').focus();
    </script>
</body>
</html>
`;

// API Routes
app.get("/", (req, res) => {
    res.send(htmlInterface);
});

app.get("/api/status", (req, res) => {
    res.json({
        status: "ok",
        connected: !!Gifted && Gifted.user?.id,
        botName: botName,
        version: botVersion,
        mode: botMode,
        sessionActive: currentSessionId !== null
    });
});

app.post("/api/connect", async (req, res) => {
    try {
        const { sessionId } = req.body;
        
        if (!sessionId || typeof sessionId !== 'string') {
            return res.status(400).json({ 
                success: false, 
                message: "Session ID is required" 
            });
        }

        if (!sessionId.startsWith('Gifted~')) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid session ID format. Must start with 'Gifted~'" 
            });
        }

        // Store session ID
        currentSessionId = sessionId;
        
        // Clear old session files
        const sessionDir = path.join(__dirname, "gift", "session");
        if (fs.existsSync(sessionDir)) {
            await fs.remove(sessionDir);
        }
        
        // Start the bot
        startGifted().then(() => {
            console.log("✅ Bot started with provided session ID");
        }).catch(err => {
            console.error("❌ Failed to start bot:", err);
        });

        res.json({ 
            success: true, 
            message: "Session ID accepted. Starting bot..." 
        });

    } catch (error) {
        console.error("Connection error:", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to process session ID", 
            error: error.message 
        });
    }
});

app.post("/api/disconnect", async (req, res) => {
    try {
        if (Gifted) {
            try {
                await Gifted.logout();
            } catch (e) {}
            try {
                await Gifted.ws.close();
            } catch (e) {}
            Gifted = null;
        }
        
        if (store) {
            store.destroy();
            store = null;
        }
        
        currentSessionId = null;
        const sessionDir = path.join(__dirname, "gift", "session");
        if (fs.existsSync(sessionDir)) {
            await fs.remove(sessionDir);
        }
        
        res.json({ 
            success: true, 
            message: "Bot disconnected successfully" 
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: "Failed to disconnect", 
            error: error.message 
        });
    }
});

app.get("/api/bot-info", (req, res) => {
    if (!Gifted || !Gifted.user) {
        return res.json({ 
            connected: false, 
            message: "Bot not connected" 
        });
    }
    
    res.json({
        connected: true,
        botId: Gifted.user.id,
        botName: Gifted.user.name,
        platform: Gifted.user.platform,
        phone: Gifted.user.phone,
        pushname: Gifted.user.pushname,
        sessionActive: true
    });
});

// Bot initialization function
async function startGifted() {
    try {
        console.log("🚀 Starting Gifted-MD Bot...");
        
        const { version, isLatest } = await fetchLatestWaWebVersion();
        console.log("📱 Using WhatsApp version:", version);
        
        // Create session directory
        const sessionDir = path.join(__dirname, "gift", "session");
        await fs.ensureDir(sessionDir);
        
        // Use file auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        if (store) {
            store.destroy();
        }
        store = new gmdStore();
        
        const giftedSock = {
            version,
            logger: pino({ level: "silent" }),
            browser: ['GIFTED', "safari", "1.0.0"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            getMessage: async (key) => {
                if (store) {
                    const msg = store.loadMessage(key.remoteJid, key.id);
                    return msg?.message || undefined;
                }
                return { conversation: 'Error occurred' };
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

        Gifted = giftedConnect(giftedSock);
        
        store.bind(Gifted.ev);

        Gifted.ev.process(async (events) => {
            if (events['creds.update']) {
                await saveCreds();
                console.log("📝 Credentials updated");
            }
        });

        // Load plugins
        try {
            const pluginsPath = path.join(__dirname, "gifted");
            if (fs.existsSync(pluginsPath)) {
                const pluginFiles = fs.readdirSync(pluginsPath);
                for (const fileName of pluginFiles) {
                    if (path.extname(fileName).toLowerCase() === ".js") {
                        try {
                            require(path.join(pluginsPath, fileName));
                            console.log(`✅ Loaded plugin: ${fileName}`);
                        } catch (e) {
                            console.error(`❌ Failed to load ${fileName}: ${e.message}`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("❌ Error reading plugins folder:", error.message);
        }

        // Setup event handlers
        setupEventHandlers();

        // Handle connection updates
        Gifted.ev.on("connection.update", handleConnectionUpdate);

        console.log("✅ Bot initialization complete");

    } catch (error) {
        console.error('❌ Socket initialization error:', error);
        reconnectWithRetry();
    }
}

function setupEventHandlers() {
    if (!Gifted) return;

    // Auto-react
    if (autoReact === "true") {
        Gifted.ev.on('messages.upsert', async (mek) => {
            const ms = mek.messages[0];
            try {
                if (ms.key.fromMe) return;
                if (!ms.key.fromMe && ms.message) {
                    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                    await GiftedAutoReact(randomEmoji, ms, Gifted);
                }
            } catch (err) {
                console.error('Error during auto reaction:', err);
            }
        });
    }

    // Anti-delete
    let giftech = { chats: {} };
    const botJid = `${Gifted.user?.id.split(':')[0]}@s.whatsapp.net`;

    Gifted.ev.on("messages.upsert", async ({ messages }) => {
        try {
            const ms = messages[0];
            if (!ms?.message) return;

            const { key } = ms;
            if (!key?.remoteJid) return;
            if (key.fromMe) return;
            if (key.remoteJid === 'status@broadcast') return;

            if (!giftech.chats[key.remoteJid]) giftech.chats[key.remoteJid] = [];
            giftech.chats[key.remoteJid].push({
                ...ms,
                timestamp: Date.now()
            });

            if (giftech.chats[key.remoteJid].length > 50) {
                giftech.chats[key.remoteJid] = giftech.chats[key.remoteJid].slice(-50);
            }
        } catch (error) {
            console.error('Anti-delete system error:', error);
        }
    });

    // Auto bio
    if (autoBio === 'true') {
        setTimeout(() => {
            try {
                GiftedAutoBio(Gifted);
            } catch (e) {}
        }, 1000);
        setInterval(() => {
            try {
                GiftedAutoBio(Gifted);
            } catch (e) {}
        }, 60000);
    }

    // Anti-call
    Gifted.ev.on("call", async (json) => {
        try {
            await GiftedAnticall(json, Gifted);
        } catch (e) {}
    });

    // Presence update
    Gifted.ev.on("messages.upsert", async ({ messages }) => {
        if (messages && messages.length > 0) {
            try {
                await GiftedPresence(Gifted, messages[0].key.remoteJid);
            } catch (e) {}
        }
    });

    // Chatbot
    if (chatBot === 'true' || chatBot === 'audio') {
        try {
            GiftedChatBot(Gifted, chatBot, chatBotMode, createContext, createContext2, googleTTS);
        } catch (e) {}
    }

    // Anti-link
    if (antiLink !== 'false') {
        Gifted.ev.on('messages.upsert', async ({ messages }) => {
            const message = messages[0];
            if (!message?.message || message.key.fromMe) return;
            try {
                await GiftedAntiLink(Gifted, message, antiLink);
            } catch (e) {}
        });
    }
}

async function handleConnectionUpdate(update) {
    const { connection, lastDisconnect } = update;
    
    if (connection === "connecting") {
        console.log("🕗 Connecting Bot...");
        reconnectAttempts = 0;
    }

    if (connection === "open") {
        console.log("✅ Connection Instance is Online");
        reconnectAttempts = 0;
        
        setTimeout(async () => {
            try {
                const totalCommands = commands.filter((command) => command.pattern).length;
                console.log('💜 Connected to Whatsapp, Active!');
                console.log(`📊 Loaded ${totalCommands} commands`);
                    
                if (startMess === 'true') {
                    const md = botMode === 'public' ? "public" : "private";
                    const connectionMsg = `
*${botName} 𝐂𝐎𝐍𝐍𝐄𝐂𝐓𝐄𝐃*

𝐏𝐫𝐞𝐟𝐢𝐱       : *[ ${botPrefix} ]*
𝐏𝐥𝐮𝐠𝐢𝐧𝐬      : *${totalCommands.toString()}*
𝐌𝐨𝐝𝐞        : *${md}*
𝐎𝐰𝐧𝐞𝐫       : *${ownerNumber}*

> *${botCaption}*`;

                    await Gifted.sendMessage(
                        Gifted.user.id,
                        {
                            text: connectionMsg,
                            ...createContext(botName, {
                                title: "BOT INTEGRATED",
                                body: "Status: Ready for Use"
                            })
                        }
                    );
                }
            } catch (err) {
                console.error("Post-connection setup error:", err);
            }
        }, 5000);
    }

    if (connection === "close") {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        
        console.log(`Connection closed due to: ${reason}`);
        
        if (reason === DisconnectReason.badSession) {
            console.log("Bad session file, delete it and scan again");
            const sessionDir = path.join(__dirname, "gift", "session");
            if (fs.existsSync(sessionDir)) {
                await fs.remove(sessionDir);
            }
            reconnectWithRetry();
        } else if (reason === DisconnectReason.connectionClosed) {
            console.log("Connection closed, reconnecting...");
            reconnectWithRetry();
        } else if (reason === DisconnectReason.connectionLost) {
            console.log("Connection lost from server, reconnecting...");
            reconnectWithRetry();
        } else if (reason === DisconnectReason.connectionReplaced) {
            console.log("Connection replaced, another new session opened");
            process.exit(1);
        } else if (reason === DisconnectReason.loggedOut) {
            console.log("Device logged out, delete session and scan again");
            const sessionDir = path.join(__dirname, "gift", "session");
            if (fs.existsSync(sessionDir)) {
                await fs.remove(sessionDir);
            }
            reconnectWithRetry();
        } else if (reason === DisconnectReason.restartRequired) {
            console.log("Restart required, restarting...");
            reconnectWithRetry();
        } else if (reason === DisconnectReason.timedOut) {
            console.log("Connection timed out, reconnecting...");
            reconnectWithRetry();
        } else {
            console.log(`Unknown disconnect reason: ${reason}, attempting reconnection...`);
            reconnectWithRetry();
        }
    }
}

async function reconnectWithRetry() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('Max reconnection attempts reached. Waiting for manual restart...');
        return;
    }

    reconnectAttempts++;
    const delay = Math.min(RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), 300000);
    
    console.log(`Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms...`);
    
    setTimeout(async () => {
        try {
            await startGifted();
        } catch (error) {
            console.error('Reconnection failed:', error);
            reconnectWithRetry();
        }
    }, delay);
}

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📱 Bot interface available at http://localhost:${PORT}`);
    console.log(`📊 Status API: http://localhost:${PORT}/api/status`);
});

// Handle process exit
process.on('SIGINT', () => {
    console.log('🛑 Shutting down...');
    if (Gifted) {
        try {
            Gifted.ws.close();
        } catch (e) {}
    }
    if (store) {
        store.destroy();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down...');
    if (Gifted) {
        try {
            Gifted.ws.close();
        } catch (e) {}
    }
    if (store) {
        store.destroy();
    }
    process.exit(0);
});

// Auto-start bot if session exists on startup
setTimeout(() => {
    const sessionDir = path.join(__dirname, "gift", "session");
    if (fs.existsSync(sessionDir)) {
        console.log("🔄 Found existing session, starting bot...");
        startGifted().catch(err => {
            console.error("❌ Failed to start bot:", err);
        });
    } else {
        console.log("📝 No existing session found. Use the web interface to connect.");
    }
}, 2000);
