// Write queue for serialized sheet writes
const writeQueue = [];
let isProcessingQueue = false;

async function processWriteQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (writeQueue.length > 0) {
        const task = writeQueue.shift();
        await task();
        await sleep(5000);
    }

    isProcessingQueue = false;
}

function enqueueWrite(task) {
    return new Promise((resolve, reject) => {
        writeQueue.push(async () => {
            try { resolve(await task()); }
            catch (e) { reject(e); }
        });
        processWriteQueue();
    });
}

export async function mergeSheets(brand, platform, provider = "", quantity, status = "") {
    console.log("Start merging data: ", brand, platform, status, quantity);

    if (status) {
        if (!cachedStatusRows) cachedStatusRows = await getRowsBySheetIndex(id, 0);

        for (const row of cachedStatusRows) {
            if (row.get('Brand') == brand && row.get('Platform') == platform && row.get('Status') == status) {
                await enqueueWrite(async () => {
                    const formattedTimestamp = getUtc7Timestamp();
                    row.assign({ 'Quantity': quantity, 'Timestamp': formattedTimestamp });
                    if (row._rawData.length > 5) row._rawData = row._rawData.slice(0, 5);
                    await row.save();
                    console.log("Successfully assigned: ", brand, platform, status, quantity);
                });
            }
        }
    }

    if (provider) {
        if (!cachedShipRows) cachedShipRows = await getRowsBySheetIndex(id, 1);
        console.log("Start merging data shipping: ", brand, platform, provider, quantity);

        for (const row of cachedShipRows) {
            if (row.get('Brand') == brand && row.get('Platform') == platform && row.get('Provider') == provider) {
                await enqueueWrite(async () => {
                    const formattedTimestamp = getUtc7Timestamp();
                    row.assign({ 'Quantity': quantity, 'Timestamp': formattedTimestamp });
                    if (row._rawData.length > 5) row._rawData = row._rawData.slice(0, 5);
                    await row.save();
                    console.log("Successfully assigned: ", brand, platform, provider, quantity);
                });
            }
        }
    }
}

// Helper extracted to avoid repetition
function getUtc7Timestamp() {
    const utc7Time = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return utc7Time.toISOString().replace('T', ' ').substring(0, 19);
}