const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { Boom } = require('@hapi/boom');
const pino = require('pino');

const SessionManager = require('./sessionManager');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.disable('x-powered-by');

let deploymentStatus = {
    isDeployed: false,
    sessionExists: false,
    botConnected: false,
    botStarting: false,
    lastDeployment: null,
    error: null,
    renderServiceId: process.env.RENDER_SERVICE_ID || process.env.RENDER_SERVICE_NAME || 'render-service',
    port: PORT,
    timestamp: new Date().toISOString()
};

let Gifted = null;
let isBotRunning = false;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'deploy.html'));
});

app.get('/api/status', (req, res) => {
    try {
        deploymentStatus.sessionExists = SessionManager.checkSessionExists();
        deploymentStatus.timestamp = new Date().toISOString();
        
        res.json({
            success: true,
            ...deploymentStatus
        });
    } catch (error) {
        console.error('Status API error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/deploy', async (req, res) => {
    try {
        console.log('Deployment request received');
        
        const { sessionId } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID is required'
            });
        }

        if (!sessionId.startsWith('Gifted~')) {
            return res.status(400).json({
                success: false,
                message: 'Invalid session format. Must start with Gifted~'
            });
        }

        if (isBotRunning) {
            return res.status(400).json({
                success: false,
                message: 'Bot is already running'
            });
        }

        console.log('Saving session...');
        
        const saveResult = await SessionManager.saveSession(sessionId);
        
        if (!saveResult.success) {
            return res.status(500).json({
                success: false,
                message: 'Failed to save session: ' + saveResult.error
            });
        }

        console.log('Session saved successfully');
        
        deploymentStatus = {
            ...deploymentStatus,
            isDeployed: true,
            sessionExists: true,
            botConnected: false,
            botStarting: true,
            lastDeployment: new Date().toISOString(),
            error: null
        };

        setTimeout(() => {
            console.log('Starting bot...');
            startBot().catch(err => {
                console.error('Bot startup error:', err.message);
                deploymentStatus.error = err.message;
                deploymentStatus.botStarting = false;
            });
        }, 2000);

        res.json({
            success: true,
            message: 'Session saved successfully! Starting bot...',
            sessionHash: saveResult.hash
        });

    } catch (error) {
        console.error('Deployment error:', error);
        res.status(500).json({
            success: false,
            message: 'Deployment failed: ' + error.message
        });
    }
});

app.post('/api/stop', async (req, res) => {
    try {
        console.log('Stopping bot...');
        
        if (Gifted && Gifted.ws) {
            await Gifted.end();
            Gifted = null;
        }
        
        isBotRunning = false;
        deploymentStatus.botConnected = false;
        deploymentStatus.botStarting = false;
        
        res.json({
            success: true,
            message: 'Bot stopped successfully'
        });
    } catch (error) {
        console.error('Stop error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to stop bot: ' + error.message
        });
    }
});

app.post('/api/restart', async (req, res) => {
    try {
        console.log('Restarting bot...');
        
        if (Gifted && Gifted.ws) {
            await Gifted.end();
            Gifted = null;
        }
        
        isBotRunning = false;
        deploymentStatus.botConnected = false;
        deploymentStatus.botStarting = true;
        
        setTimeout(() => {
            startBot().catch(err => {
                console.error('Restart error:', err.message);
                deploymentStatus.error = err.message;
                deploymentStatus.botStarting = false;
            });
        }, 3000);
        
        res.json({
            success: true,
            message: 'Bot restart initiated'
        });
    } catch (error) {
        console.error('Restart error:', error);
        res.status(500).json({
            success: false,
            message: 'Restart failed: ' + error.message
        });
    }
});

app.post('/api/clear-session', async (req, res) => {
    try {
        console.log('Clearing session...');
        
        if (Gifted && Gifted.ws) {
            await Gifted.end();
            Gifted = null;
        }
        
        isBotRunning = false;
        
        const cleared = SessionManager.clearSession();
        
        deploymentStatus = {
            ...deploymentStatus,
            isDeployed: false,
            sessionExists: false,
            botConnected: false,
            botStarting: false,
            error: null
        };
        
        res.json({
            success: true,
            message: 'Session cleared successfully',
            cleared: cleared
        });
    } catch (error) {
        console.error('Clear session error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to clear session: ' + error.message
        });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        botRunning: isBotRunning,
        sessionExists: deploymentStatus.sessionExists
    });
});

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

async function startBot() {
    if (isBotRunning) {
        console.log('Bot is already running');
        return;
    }

    try {
        console.log('Checking session...');
        
        if (!SessionManager.checkSessionExists()) {
            deploymentStatus.error = 'No session available';
            deploymentStatus.botStarting = false;
            console.log('No session available');
            return;
        }

        console.log('Starting WhatsApp bot...');
        isBotRunning = true;
        deploymentStatus.botStarting = true;
        deploymentStatus.error = null;

        const { default: giftedConnect, fetchLatestWaWebVersion, useMultiFileAuthState, makeCacheableSignalKeyStore } = require('gifted-baileys');
        
        const { gmdStore } = require('./gift/gmdFunctions');
        
        const { version } = await fetchLatestWaWebVersion();
        const sessionDir = path.join(__dirname, 'gift', 'session');
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        let store = new gmdStore();
        
        const giftedSock = {
            version,
            logger: pino({ level: 'silent' }),
            browser: ['GIFTED-MD', 'Chrome', '3.0'],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino())
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
            generateHighQualityLinkPreview: false
        };

        console.log('Connecting to WhatsApp...');
        
        Gifted = giftedConnect(giftedSock);
        store.bind(Gifted.ev);

        Gifted.ev.process(async (events) => {
            if (events['creds.update']) {
                await saveCreds();
                console.log('Credentials updated');
            }
        });

        loadBotFunctionality(Gifted);

        Gifted.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'connecting') {
                console.log('Connecting to WhatsApp...');
            }

            if (connection === 'open') {
                console.log('WhatsApp connection established');
                deploymentStatus.botConnected = true;
                deploymentStatus.botStarting = false;
                deploymentStatus.error = null;
                
                try {
                    const config = require('./config');
                    const { createContext } = require('./gift');
                    
                    const connectionMsg = `
*GIFTED-MD CONNECTED ON RENDER*

Service: *${deploymentStatus.renderServiceId}*
Port: *${PORT}*
Time: *${new Date().toLocaleString()}*

> Bot is now ready to use!`;

                    await Gifted.sendMessage(
                        Gifted.user.id,
                        {
                            text: connectionMsg,
                            ...createContext('GIFTED-MD', {
                                title: 'BOT DEPLOYED',
                                body: 'Status: Connected'
                            })
                        }
                    );
                    console.log('Connection message sent');
                } catch (err) {
                    console.error('Connection message error:', err);
                }
            }

            if (connection === 'close') {
                console.log('Connection closed');
                deploymentStatus.botConnected = false;
                deploymentStatus.botStarting = false;
                
                const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                console.log('Disconnect reason:', reason);
                
                if (reason === 428 || reason === 408 || reason === 515) {
                    console.log('Attempting to reconnect...');
                    setTimeout(() => reconnectWithRetry(), 5000);
                } else {
                    console.log('Session may be invalid');
                    deploymentStatus.error = 'Connection lost';
                    isBotRunning = false;
                }
            }
        });

        console.log('Bot initialized successfully');

    } catch (error) {
        console.error('Bot startup error:', error);
        deploymentStatus.error = error.message;
        deploymentStatus.botStarting = false;
        isBotRunning = false;
        
        setTimeout(() => reconnectWithRetry(), 5000);
    }
}

async function reconnectWithRetry() {
    if (isBotRunning) {
        console.log('Attempting reconnection...');
        await startBot();
    }
}

function loadBotFunctionality(gifted) {
    console.log('Loading bot functionality...');
    
    gifted.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        
        if (!msg?.message || msg.key.fromMe) {
            return;
        }
        
        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || '';
        
        if (text.toLowerCase() === 'ping') {
            await gifted.sendMessage(msg.key.remoteJid, { text: 'Pong! 🏓' });
        }
        
        if (text.toLowerCase().startsWith('hello')) {
            await gifted.sendMessage(msg.key.remoteJid, { 
                text: 'Hello! I am GIFTED-MD running on Render! 🚀' 
            });
        }
    });
    
    console.log('Bot functionality loaded');
}

async function initializeServer() {
    try {
        console.log('Initializing Render Deployment Server...');
        console.log('Port:', PORT);
        
        const dirs = ['gift/session', 'gift/temp', 'public'];
        dirs.forEach(dir => {
            const fullPath = path.join(__dirname, dir);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
                console.log('Created directory:', dir);
            }
        });

        if (SessionManager.checkSessionExists()) {
            console.log('Existing session found');
            deploymentStatus.sessionExists = true;
            
            setTimeout(() => {
                console.log('Auto-starting bot...');
                startBot().catch(err => {
                    console.error('Auto-start failed:', err.message);
                });
            }, 3000);
        } else {
            console.log('No session found. Please deploy via web interface.');
        }

        app.listen(PORT, '0.0.0.0', () => {
            console.log('Server running on port:', PORT);
            console.log('Access at: http://localhost:' + PORT);
            console.log('Health check: http://localhost:' + PORT + '/health');
        });

    } catch (error) {
        console.error('Server initialization error:', error);
        process.exit(1);
    }
}

initializeServer();

process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    
    if (Gifted && Gifted.ws) {
        console.log('Disconnecting from WhatsApp...');
        await Gifted.end();
    }
    
    console.log('Shutdown complete');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down...');
    
    if (Gifted && Gifted.ws) {
        await Gifted.end();
    }
    
    process.exit(0);
});
