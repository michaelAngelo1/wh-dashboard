import { loadTokens, refreshTokens, getShopCipher } from '../../auth/tiktok/mainAuth.js';
import crypto from 'crypto';
import axios from 'axios';

function convertTimestamp(orderCreatedTime) {
    const date = new Date(orderCreatedTime * 1000);
    const utc7Date = new Date(date.getTime() + (7 * 60 * 60 * 1000)); 
    const isoString = utc7Date.toISOString();
    const result = isoString.replace('T', ' ').substring(0, 19);
    return result;
}

function getStartOfToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day} 00:00:00`;
}

function getEndOfToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day} 23:59:59`;
}

const internalAppBrands = {
    "Eileen Grace": 1,
    "Mamaway": 1,
    "SHRD": 1,
    "CHESS": 1,
    "Miss Daisy": 1,
    "Polynia": 1,
    "CHESS": 1,
    "Cléviant": 1,
    "Mossèru": 1,
    "Evoke": 1,
    "Dr Jou": 1,
    "Mirae": 2,
    "Swissvita": 2,
    "G-Belle": 2,
    "Past Nine": 2,
    "Nutri & Beyond": 2,
    "Ivy & Lily": 2,
    "Naruko": 2,
    "Relove": 2,
    "Joey & Roo": 2, 
    "Rocketindo Shop": 2,
    "M2": 3,
}

async function getOrderList(brand, shopCipher, accessToken) {

    try {
        let tiktokAppKey;
        let tiktokAppSecret;

        if(internalAppBrands[brand] == 1) {
            tiktokAppKey = "6j6u4kmpdda19"
            tiktokAppSecret = "c4680b9ff6797160adb92104a77e2e1aa085c733"
        } else if(internalAppBrands[brand] == 2) {
            tiktokAppKey = "6j7inu4s9dkfq"
            tiktokAppSecret = "3493907831adc26d58c74262f709b48a2205a2d0"
        } else {
            tiktokAppKey = "6jbrll2ed26dp";
            tiktokAppSecret = "04679ae180556cdc79b11a3e7cbd8da33f0d6e92";
        }

        const path = "/order/202309/orders/search";
        const baseUrl = "https://open-api.tiktokglobalshop.com" + path + "?";

        let keepFetching = true;
        let currPageToken = "";
        
        const nowSeconds = Math.floor(Date.now() / 1000);
        const jakartaOffset = 25200;
        const secondsPassedToday = (nowSeconds + jakartaOffset) % 86400;
        const JAKARTA_MIDNIGHT_TS = nowSeconds - secondsPassedToday;
        const JAKARTA_MIDNIGHT_YESTERDAY = JAKARTA_MIDNIGHT_TS - (5 * 86400);
        const JAKARTA_1430_YESTERDAY = JAKARTA_MIDNIGHT_TS - 34200;
        const JAKARTA_1500_YESTERDAY = JAKARTA_MIDNIGHT_TS - 32400;

        const createTimeFrom = JAKARTA_MIDNIGHT_YESTERDAY;
        const createTimeTo = nowSeconds;
        
        console.log("Create time from: ", convertTimestamp(createTimeFrom));
        console.log('Create time to: ', convertTimestamp(createTimeTo));
        
        let orderTotal = 0;
        let orders = [];

        while(keepFetching) {
            const requestBody = {
                create_time_ge: createTimeFrom,
                create_time_lt: createTimeTo,
            }

            const timestamp = Math.floor(Date.now() / 1000);
            const queryParams = {
                app_key: tiktokAppKey, 
                timestamp: timestamp,
                page_size: 100,
                shop_cipher: shopCipher
            }
            if(currPageToken) {
                queryParams.page_token = currPageToken;
            }
            const sortedKeys = Object.keys(queryParams).sort();

            let result = tiktokAppSecret + path;
            for(const key of sortedKeys) {
                result += key + queryParams[key];
            }
            result += JSON.stringify(requestBody);
            result += tiktokAppSecret;

            const sign = crypto.createHmac('sha256', tiktokAppSecret).update(result).digest('hex');
            queryParams.sign = sign;
            const querySearchParams = new URLSearchParams(queryParams);
            const completeUrl = baseUrl + querySearchParams.toString();


            const response = await axios.post(completeUrl, 
                requestBody,
                {
                    headers: {
                        'content-type': 'application/json',
                        'x-tts-access-token': accessToken
                    }
                }
            );

            // console.log("[TIKTOK-REALTIME] Raw response order list: ", response);

            if(response.data.data && response.data.data.orders) {
                orders.push(...response.data.data.orders);
                orderTotal += response.data.data.orders.length;
            }

            const nextPageToken = response.data.data.next_page_token;

            if(nextPageToken && nextPageToken.length > 0) {
                currPageToken = nextPageToken;
            } else {
                keepFetching = false;
            }
        }

        // This number may be inflated due to: unspecified order status (should be other than UNPAID)
        // Next step should account for order status
        // If is_cod = true, then pay_time can be empty
        // If is_cod = false, then pay_time can not be empty.
        console.log("Order total on brand: ", brand, " length: ", orderTotal);

        await processOrdersGMV(brand, orders);
    } catch (e) {
        console.log("[TIKTOK-REALTIME] Error getting wh-dashboard tiktok data on brand: ", brand);
        console.log(e);
    }
}

async function processOrdersGMV(brand, orders) {
    const tiktokOnlyOrders = orders
    let shipByTodayCount = 0;
    let awaitCollectionCount = 0;
    let awaitShipmentCount = 0;
    let shippedByTodayTime = getEndOfToday();

    tiktokOnlyOrders.forEach(o => {
        let collectionSlaTime = convertTimestamp(o.tts_sla_time ? o.tts_sla_time : 0)
        
        if(collectionSlaTime <= shippedByTodayTime && (
            o.status == "AWAITING_COLLECTION" || 
            o.status == "AWAITING_SHIPMENT")
        ) {
            // console.log("Order ID: ", o.id);
            shipByTodayCount++;
            if(o.status == "AWAITING_COLLECTION") awaitCollectionCount++;
            else awaitShipmentCount++;
        } 
        else {
            console.log("Order ID: ", o.id);
            console.log("Order Status: ", o.status);
            // console.log("Creation time: ", convertTimestamp(o.create_time));
            console.log("TTS SLA time: ", o.tts_sla_time ? convertTimestamp(o.tts_sla_time) : null)
            // console.log("\n");
        }
    });
    
    console.log(`Today's Orders by Status: ${brand}\n`);
    console.log("TO_SHIP BY 23:59 TODAY: ", shipByTodayCount);
    console.log("Awaiting Collection: ", awaitCollectionCount);
    console.log("Awaiting Shipment: ", awaitShipmentCount);
    console.log("\n")
}

async function mainRealtimeTiktok(brand) {
    console.log("Main WH Dashboard tiktok: ", brand);
    
    const tokens = await loadTokens(brand);
    let accessToken = tokens.accessToken;

    const shopCipher = await getShopCipher(brand, accessToken);

    await getOrderList(brand, shopCipher, accessToken);
}

export async function parentRealtimeTiktok() {
    // await mainRealtimeTiktok("Eileen Grace");
    // await mainRealtimeTiktok("Mamaway");
    // await mainRealtimeTiktok("SHRD");
    // await mainRealtimeTiktok("Miss Daisy");
    await mainRealtimeTiktok("Polynia");
    // await mainRealtimeTiktok("CHESS");
    // await mainRealtimeTiktok("Cléviant");
    // await mainRealtimeTiktok("Mossèru");
    // await mainRealtimeTiktok("Evoke")
    // await mainRealtimeTiktok("Dr Jou");
    // await mainRealtimeTiktok("Mirae");
    // await mainRealtimeTiktok("Swissvita");
    // await mainRealtimeTiktok("G-Belle");
    // await mainRealtimeTiktok("Past Nine");
    // await mainRealtimeTiktok("Nutri & Beyond");
    // await mainRealtimeTiktok("Ivy & Lily");
    // await mainRealtimeTiktok("Naruko");
    // await mainRealtimeTiktok("Relove");
    // await mainRealtimeTiktok("Joey & Roo");
    // await mainRealtimeTiktok("Rocketindo Shop");
    // await mainRealtimeTiktok("M2");
}

await parentRealtimeTiktok();