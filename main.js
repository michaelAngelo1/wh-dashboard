import { warehouseShopee } from "./functions/shopee/worker.test.js";
import { warehouseTiktok } from "./functions/tiktok/worker.test.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mainWarehouse() {
    try {
        await Promise.all([
            warehouseShopee(),
            delay(10_000).then(() => warehouseTiktok()),
        ]);
    } catch (e) {
        console.log("Error in main warehouse: ", e);
        process.exit(1);
    }
}

await mainWarehouse();