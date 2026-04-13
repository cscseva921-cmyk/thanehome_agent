const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const FIREBASE_URL = process.env.FIREBASE_URL;
const leadStates = {};

async function getProperties() {
    try {
        const res = await fetch(`${FIREBASE_URL}/properties.json`);
        const data = await res.json();
        if (!data) return [];

        return Object.keys(data).map(key => ({
            id: key,
            ...data[key]
        }));
    } catch {
        return [];
    }
}

function filterProperties(properties, text) {
    return properties.filter(p => {
        const t = text.toLowerCase();

        return (
            (!t.includes("2bhk") || p.type === "2BHK") &&
            (!t.includes("3bhk") || p.type === "3BHK") &&
            (!t.includes("thane") || p.location.toLowerCase().includes("thane")) &&
            (!t.includes("pune") || p.location.toLowerCase().includes("pune")) &&
            (!t.includes("under 50") || parseInt(p.price) <= 5000000)
        );
    });
}

async function startBot() {

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('connection.update', ({ connection, qr }) => {
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'open') console.log("✅ BOT LIVE");
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = (msg.message.conversation || "").toLowerCase();

        // STEP 2: SAVE LEAD
        if (leadStates[sender]?.step === "DETAILS") {
            const property = leadStates[sender].property;
            const phone = sender.split("@")[0];

            const lead = {
                details: text,
                phone,
                property: property.name,
                price: property.price,
                location: property.location,
                time: new Date().toISOString()
            };

            await fetch(`${FIREBASE_URL}/leads.json`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(lead)
            });

            await sock.sendMessage(sender, {
                text: "✅ Enquiry sent! Our agent will call you."
            });

            delete leadStates[sender];
            return;
        }

        // PROPERTY SEARCH
        if (text.includes("buy") || text.includes("2bhk") || text.includes("3bhk")) {

            const properties = await getProperties();
            const results = filterProperties(properties, text);

            if (results.length === 0) {
                await sock.sendMessage(sender, { text: "❌ No matching property found" });
                return;
            }

            for (let p of results.slice(0, 3)) {
                leadStates[sender] = { step: "DETAILS", property: p };

                await sock.sendMessage(sender, {
                    image: { url: p.images[0] },
                    caption: `🏠 ${p.name}\n📍 ${p.location}\n💰 ₹${p.price}\n\nReply YES to enquire`
                });
            }
        }

        // CONFIRM
        else if (text === "yes" && leadStates[sender]) {
            leadStates[sender].step = "DETAILS";

            await sock.sendMessage(sender, {
                text: "Please send Name + Phone + Requirement"
            });
        }

        // LIST
        else if (text === "list") {
            const props = await getProperties();

            let msgText = "🏠 Properties:\n\n";
            props.forEach(p => {
                msgText += `${p.name} - ₹${p.price}\n`;
            });

            await sock.sendMessage(sender, { text: msgText });
        }

        else {
            await sock.sendMessage(sender, {
                text: "👋 Type:\n1. list\n2. 2BHK Thane\n3. buy property"
            });
        }
    });
}

startBot();
