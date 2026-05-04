import { GoogleSpreadsheet } from 'google-spreadsheet';
import { GoogleAuth } from 'google-auth-library';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
const secretClient = new SecretManagerServiceClient();

const docCache = {};
const id = "1faP8I6cN3NMxLL-YUstEbv0xoEn7OKj8XfKOrsTLGws";
let cachedStatusRows = null;
let cachedShipRows = null;

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

export function clearSheetCache() {
    cachedStatusRows = null;
    cachedShipRows = null;
}

export async function mergeSheets(brand, platform, provider="", quantity, status="") {
    console.log("Start merging data: ", brand, " ", platform, " ", status, " ", quantity);

    if(status) {
        if (!cachedStatusRows) cachedStatusRows = await getRowsBySheetIndex(id, 0);

        for (const row of cachedStatusRows) {
            const rowBrand = row.get('Brand');
            const rowPlatform = row.get('Platform');
            const rowStatus = row.get('Status');
    
            if (rowBrand == brand && rowPlatform == platform && rowStatus == status) {
                const now = new Date();
                const utc7Time = new Date(now.getTime() + (7 * 60 * 60 * 1000));
                const formattedTimestamp = utc7Time.toISOString().replace('T', ' ').substring(0, 19);
    
                row.assign({ 'Quantity': quantity, 'Timestamp': formattedTimestamp });
                if (row._rawData.length > 5) row._rawData = row._rawData.slice(0, 5);
                await row.save();
                await sleep(5000);
                console.log("Successfully assigned: ", brand, " ", platform, " ", status, " ", quantity);
            }
        }
    }

    if(provider) {
        if (!cachedShipRows) cachedShipRows = await getRowsBySheetIndex(id, 1);
        console.log("Start merging data shipping: ", brand, " ", platform, " ", provider, " ", quantity);

        for (const row of cachedShipRows) {
            const rowBrand = row.get('Brand');
            const rowPlatform = row.get('Platform');
            const rowProvider = row.get('Provider');

            if (rowBrand == brand && rowPlatform == platform && rowProvider == provider) {
                const now = new Date();
                const utc7Time = new Date(now.getTime() + (7 * 60 * 60 * 1000));
                const formattedTimestamp = utc7Time.toISOString().replace('T', ' ').substring(0, 19);

                row.assign({ 'Quantity': quantity, 'Timestamp': formattedTimestamp });
                if (row._rawData.length > 5) row._rawData = row._rawData.slice(0, 5);
                await row.save();
                await sleep(5000);
                console.log("Successfully assigned: ", brand, " ", platform, " ", provider, " ", quantity);
            }
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}