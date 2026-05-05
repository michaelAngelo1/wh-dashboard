import { GoogleSpreadsheet } from 'google-spreadsheet';
import { GoogleAuth } from 'google-auth-library';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
const secretClient = new SecretManagerServiceClient();

const docCache = {};
const id = "1faP8I6cN3NMxLL-YUstEbv0xoEn7OKj8XfKOrsTLGws";
let cachedShipRowsPromise = null;

export function clearSheetCache() {
    cachedShipRowsPromise = null;
}

const writeQueue = [];
let isProcessingQueue = false;

async function processWriteQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (writeQueue.length > 0) {
        const task = writeQueue.shift();
        try {
            await task();
        } catch (e) {
            console.error("[MERGE-SHEETS] Write queue task failed: ", e.message);
        }
        await sleep(1500);
    }

    isProcessingQueue = false;
}

function enqueueWrite(task) {
    return new Promise((resolve) => {
        const attempt = async () => {
            try {
                resolve(await task());
            } catch (e) {
                console.error(`[MERGE-SHEETS] Write failed, re-queuing: ${e.message}`);
                writeQueue.push(attempt);
            }
        };
        writeQueue.push(attempt);
        processWriteQueue();
    });
}

async function loadCredentials() {
    const secretName = "projects/231801348950/secrets/realtime-service-account/versions/latest";
    const [version] = await secretClient.accessSecretVersion({ name: secretName });
    const data = version.payload.data.toString('UTF-8');
    return JSON.parse(data);
}

async function getDoc(id) {
    if (docCache[id]) return docCache[id];

    const creds = await loadCredentials();
    console.log("Creds: ", creds.client_email);

    const auth = new GoogleAuth({
        credentials: creds,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ],
    });

    const authClient = await auth.getClient();
    const doc = new GoogleSpreadsheet(id, authClient);
    await doc.loadInfo();

    docCache[id] = doc;
    return doc;
}

async function getRowsBySheetIndex(id, sheetIndex) {
    const doc = await getDoc(id);
    return await doc.sheetsByIndex[sheetIndex].getRows();
}

export async function mergeSheets(brand, platform, provider, status, quantity) {
    if (!cachedShipRowsPromise) cachedShipRowsPromise = getRowsBySheetIndex(id, 0);

    const shipRows = await cachedShipRowsPromise;
    for (const row of shipRows) {
        if (row.get('Brand') == brand && row.get('Platform') == platform &&
            row.get('Provider') == provider && row.get('Status') == status) {
            await enqueueWrite(async () => {
                row.assign({ 'Quantity': quantity, 'Timestamp': getUtc7Timestamp() });
                if (row._rawData.length > 6) row._rawData = row._rawData.slice(0, 6);
                await row.save();
                console.log("Successfully assigned: ", brand, platform, provider, status, quantity);
            });
        }
    }
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getUtc7Timestamp() {
    const utc7Time = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return utc7Time.toISOString().replace('T', ' ').substring(0, 19);
}