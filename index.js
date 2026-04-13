const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const FIREBASE_URL = process.env.FIREBASE_URL;

const leadStates = {};

// 🏠 Fetch Properties from Firebase
async function getProperties() {
    try {
        const response = await fetch(`${FIREBASE_URL}/properties.json`);
        const data = await response.json();
        if (!data) return [];

        return Object.keys(data).map(key => ({
            id: key,
            name: data[key].name,
            price: data[key].price,
            location: data[key].location,
            imageUrl: data[key].imageUrl
        }));
    } catch (error) {
        console.error("Property fetch error:", error);
        return [];
    }
}

async function startBot() {

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;

        if (qr) {
            console.clear();
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') console.log('✅ REAL ESTATE BOT ONLINE');
        if (connection === 'close') startBot();
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = (msg.message.conversation || "").toLowerCase();

        console.log("User:", text);

        // 🧾 STEP 2: SAVE LEAD
        if (leadStates[sender]?.step === 'WAITING_DETAILS') {

            const customerDetails = text;
            const property = leadStates[sender].property;
            const phone = sender.split('@')[0];

            const leadData = {
                name: customerDetails,
                phone: phone,
                property: property.name,
                price: property.price,
                location: property.location,
                status: "New Lead",
                timestamp: new Date().toISOString()
            };

            await fetch(`${FIREBASE_URL}/leads.json`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(leadData)
            });

            await sock.sendMessage(sender, {
                text: `✅ *Enquiry Submitted!*\n\nProperty: *${property.name}*\nLocation: ${property.location}\n\nOur team will contact you soon.`
            });

            delete leadStates[sender];
            return;
        }

        // 🏠 STEP 1: START ENQUIRY
        if (text.startsWith("buy ") || text.startsWith("property ")) {

            const search = text.replace("buy ", "").replace("property ", "").trim();
            const properties = await getProperties();

            const match = properties.find(p =>
                p.name.toLowerCase().includes(search)
            );

            if (!match) {
                await sock.sendMessage(sender, {
                    text: `❌ Property not found.\n\nType *list* to see available properties.`
                });
                return;
            }

            leadStates[sender] = { step: 'WAITING_DETAILS', property: match };

            const caption = `🏠 *Property Selected*\n\n*${match.name}*\n📍 ${match.location}\n💰 ₹${match.price}\n\nPlease send:\n*Name + Phone + Requirement*`;

            if (match.imageUrl) {
                await sock.sendMessage(sender, {
                    image: { url: match.imageUrl },
                    caption
                });
            } else {
                await sock.sendMessage(sender, { text: caption });
            }
        }

        // 📋 PROPERTY LIST
        else if (text.includes("list") || text.includes("property")) {

            const properties = await getProperties();

            if (properties.length === 0) {
                await sock.sendMessage(sender, {
                    text: "No properties available right now."
                });
                return;
            }

            let message = "🏠 *AVAILABLE PROPERTIES*\n\n";

            properties.forEach(p => {
                message += `🔹 *${p.name}*\n📍 ${p.location}\n💰 ₹${p.price}\n\n`;
            });

            message += "👉 Type *buy [property name]* to enquire";

            await sock.sendMessage(sender, { text: message });
        }

        // 👋 GREETING
        else if (text.includes("hi") || text.includes("hello")) {
            await sock.sendMessage(sender, {
                text: `👋 Welcome to *Thane Home Real Estate*\n\nType *list* to see properties\nType *buy property-name* to enquire`
            });
        }

        else {
            await sock.sendMessage(sender, {
                text: "🤔 समझ नहीं आया\n\nType *list* to see properties"
            });
        }
    });
}

startBot();
