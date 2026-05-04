import axios from 'axios';
import crypto from 'crypto';
import 'dotenv/config';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { sleep, mergeSheets } from '../mergeSheets.js';
const secretClient = new SecretManagerServiceClient();

function convertTimestamp(orderCreatedTime) {
    const date = new Date(orderCreatedTime * 1000);
    const utc7Date = new Date(date.getTime() + (7 * 60 * 60 * 1000)); 
    const isoString = utc7Date.toISOString();
    const result = isoString.replace('T', ' ').substring(0, 19);
    return result;
}

function getEndOfToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day} 23:59:59`;
}

async function getOrderList(brand, partner_id, partner_key, access_token, shop_id, JAKARTA_MIDNIGHT_TODAY, nowSeconds) {
    console.log("[REALTIME-SALES] Handle realtime get order list on brand: ", brand);
    let allOrders = [];
    const HOST = "https://partner.shopeemobile.com";
    const PATH = "/api/v2/order/get_order_list";

    // Removed INVOICE_PENDING (Invalid) and UNPAID
    const statusesToFetch = [
        'READY_TO_SHIP', 
        'PROCESSED', 
        'SHIPPED', 
        'COMPLETED', 
        'IN_CANCEL', 
        'CANCELLED'
    ];

    try {
        const time_from = JAKARTA_MIDNIGHT_TODAY - (1 * 86400); 
        console.log("Time from: ", convertTimestamp(time_from));
        const time_to = nowSeconds;
        console.log("Time to: ", convertTimestamp(time_to));

        for (const status of statusesToFetch) {
            let cursor = "";
            let more = true;

            while (more) {
                const timestamp = Math.floor(Date.now() / 1000);
                const baseString = `${partner_id}${PATH}${timestamp}${access_token}${shop_id}`;
                const sign = crypto.createHmac('sha256', partner_key)
                    .update(baseString)
                    .digest('hex');

                const { data } = await axios.get(HOST + PATH, {
                    params: {
                        partner_id,
                        shop_id,
                        access_token,
                        timestamp,
                        sign,
                        time_range_field: 'create_time',
                        time_from: time_from,
                        time_to: time_to,
                        page_size: 100,
                        cursor,
                        order_status: status,
                        response_optional_fields: 'order_status'
                    }
                });

                if (data.error) {
                    console.log(`[REALTIME-SALES] API Skip [${status}]: ${data.message || data.error}`);
                    break;
                }

                const responseData = data.response;
                if (responseData && responseData.order_list) {
                    responseData.order_list.forEach(order => {
                        allOrders.push(order.order_sn);
                    });
                    
                    more = responseData.more;
                    cursor = responseData.next_cursor;
                } else {
                    more = false;
                }
            }
        }

    } catch (e) {
        console.log("[REALTIME-SALES] Error get order list on brand: ", brand);
        console.log(e);
    }

    return [...new Set(allOrders)];
}

async function getOrderDetail(brand, batch, partner_id, partner_key, access_token, shop_id) {
    const HOST = "https://partner.shopeemobile.com";
    const PATH = "/api/v2/order/get_order_detail";
    let instantCount = 0;
    let regularCount = 0;

    try {
        const order_sn_list = batch.join(',');
        const timestamp = Math.floor(Date.now() / 1000);
        const baseString = `${partner_id}${PATH}${timestamp}${access_token}${shop_id}`;
        const sign = crypto.createHmac('sha256', partner_key)
            .update(baseString)
            .digest('hex');

        const { data } = await axios.get(HOST + PATH, {
            params: {
                partner_id,
                shop_id,
                access_token,
                timestamp,
                sign,
                order_sn_list,
                response_optional_fields: 'item_list,pay_time,payment_method'
            }
        });

        if (data.error) throw new Error(data.message || data.error);

        // Get Order List
        // time_from: yesterday's 12 PM
        // time_to: today's 12 PM
        if (data.response && data.response.order_list) {
            data.response.order_list.forEach(order => {
                // console.log("Order ID: ", order.order_sn);
                // console.log("Creation time: ", convertTimestamp(order.create_time));
                // console.log("Ship by Date: ", convertTimestamp(order.ship_by_date));
                // console.log("Order Status: ", order.order_status);

                // If order status is READY_TO_SHIP and ship by date is today's 23:59:59
                if(order.order_status == "READY_TO_SHIP" && (order.ship_by_date && convertTimestamp(order.ship_by_date) <= getEndOfToday())) {
                    if(convertTimestamp(order.ship_by_date) < getEndOfToday()) instantCount++;
                    else if(convertTimestamp(order.ship_by_date) == getEndOfToday()) regularCount++;
                    
                    // Check the shipping_carrier
                    console.log("\n");
                    console.log("Order ID: ", order.order_sn);
                    console.log("Ship by Date: ", convertTimestamp(order.ship_by_date));
                    console.log("Order Status: ", order.order_status);
                    console.log("\n");
                } 
            });
        }

    } catch (e) {
        console.log(`[REALTIME-SALES] Detail Error (${brand}): ${e.message}`);
    }

    return {
        regularCount,
        instantCount
    };
}


export async function mainRealtime(brand, partner_id, partner_key, access_token, shop_id) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const jakartaOffset = 25200; 
    const secondsPassedToday = (nowSeconds + jakartaOffset) % 86400;
    const JAKARTA_MIDNIGHT_TODAY = nowSeconds - secondsPassedToday;

    const allOrders = await getOrderList(brand, partner_id, partner_key, access_token, shop_id, JAKARTA_MIDNIGHT_TODAY, nowSeconds);
    
    console.log(`[REALTIME-SALES] Total ${brand} orders fetched: ${allOrders.length}`);

    let batchSize = 50;
    let totalRegularCount = 0;
    let totalInstantCount = 0;
    for(let i = 0; i < allOrders.length; i += batchSize) {
        const batchOrderSns = allOrders.slice(i, i + batchSize); 
        let { regularCount, instantCount } = await getOrderDetail(brand, batchOrderSns, partner_id, partner_key, access_token, shop_id, JAKARTA_MIDNIGHT_TODAY); 
        totalRegularCount += regularCount;
        totalInstantCount += instantCount;
    }
    let totalReadyToShip = totalInstantCount + totalRegularCount;

    let platform = "Shopee";
    let status = "READY_TO_SHIP";
    console.log("Ready to ship count: ", totalReadyToShip);

    await mergeSheets(brand, platform, "", totalReadyToShip, status);

    await mergeSheets(brand, platform, "SPX", totalRegularCount, "");
    await mergeSheets(brand, platform, "Instant", totalInstantCount, "");
}

let brandCreds = {
    "Eileen Grace": {
        partner_id: process.env.PARTNER_ID,
        partner_key: process.env.PARTNER_KEY,
        shop_id: process.env.SHOP_ID,
    },
    "Mamaway": {
        partner_id: process.env.MOSS_PARTNER_ID,
        partner_key: process.env.MOSS_PARTNER_KEY,
        shop_id: process.env.MMW_SHOP_ID,
    },
    "SHRD": {
        partner_id: process.env.SHRD_PARTNER_ID,
        partner_key: process.env.SHRD_PARTNER_KEY,
        shop_id: process.env.SHRD_SHOP_ID,
    },
    "Miss Daisy": {
        partner_id: process.env.MD_PARTNER_ID,
        partner_key: process.env.MD_PARTNER_KEY,
        shop_id: process.env.MD_SHOP_ID,
    },
    "Polynia": {
        partner_id: process.env.POLY_PARTNER_ID,
        partner_key: process.env.POLY_PARTNER_KEY,
        shop_id: process.env.POLY_SHOP_ID,
    },
    "CHESS": {
        partner_id: process.env.CLEVIANT_PARTNER_ID,
        partner_key: process.env.CLEVIANT_PARTNER_KEY,
        shop_id: process.env.CHESS_SHOP_ID,
    },
    "Cléviant": {
        partner_id: process.env.CLEVIANT_PARTNER_ID,
        partner_key: process.env.CLEVIANT_PARTNER_KEY,
        shop_id: process.env.CLEVIANT_SHOP_ID,
    },
    "Mossèru": {
        partner_id: process.env.MOSS_PARTNER_ID,
        partner_key: process.env.MOSS_PARTNER_KEY,
        shop_id: process.env.MOSS_SHOP_ID,
    },
    "Evoke": {
        partner_id: process.env.SHRD_PARTNER_ID,
        partner_key: process.env.SHRD_PARTNER_KEY,
        shop_id: process.env.EVOKE_SHOP_ID,
    },
    "Dr Jou": {
        partner_id: process.env.DRJOU_PARTNER_ID,
        partner_key: process.env.DRJOU_PARTNER_KEY,
        shop_id: process.env.DRJOU_SHOP_ID,
    },
    "Mirae": {
        partner_id: process.env.DRJOU_PARTNER_ID,
        partner_key: process.env.DRJOU_PARTNER_KEY,
        shop_id: process.env.MIRAE_SHOP_ID,
    },
    "Swissvita": {
        partner_id: process.env.SV_PARTNER_ID,
        partner_key: process.env.SV_PARTNER_KEY,
        shop_id: process.env.SV_SHOP_ID,
    },
    "G-Belle": {
        partner_id: process.env.MD_PARTNER_ID,
        partner_key: process.env.MD_PARTNER_KEY,
        shop_id: process.env.GB_SHOP_ID,
    },
    "Past Nine": {
        partner_id: process.env.PN_PARTNER_ID,
        partner_key: process.env.PN_PARTNER_KEY,
        shop_id: process.env.PN_SHOP_ID,
    },
    "Nutri & Beyond": {
        partner_id: process.env.PN_PARTNER_ID,
        partner_key: process.env.PN_PARTNER_KEY,
        shop_id: process.env.NB_SHOP_ID,
    },
    "Ivy & Lily": {
        partner_id: process.env.PARTNER_ID,
        partner_key: process.env.PARTNER_KEY,
        shop_id: process.env.IL_SHOP_ID,
    },
    "Naruko": {
        partner_id: process.env.MOSS_PARTNER_ID,
        partner_key: process.env.MOSS_PARTNER_KEY,
        shop_id: process.env.NARUKO_SHOP_ID,
    },
    "Relove": {
        partner_id: process.env.SHRD_PARTNER_ID,
        partner_key: process.env.SHRD_PARTNER_KEY,
        shop_id: process.env.RELOVE_SHOP_ID,
    },
    "Joey & Roo": {
        partner_id: process.env.DRJOU_PARTNER_ID,
        partner_key: process.env.DRJOU_PARTNER_KEY,
        shop_id: process.env.JOEY_ROO_SHOP_ID,
    },
    "M2": {
        partner_id: process.env.PARTNER_ID,
        partner_key: process.env.PARTNER_KEY,
        shop_id: process.env.M2_SHOP_ID,
    },
    "Rocketindo Shop": {
        partner_id: process.env.DRJOU_PARTNER_ID,
        partner_key: process.env.DRJOU_PARTNER_KEY,
        shop_id: process.env.PINKROCKET_SHOP_ID,
    }
}

async function brandAccessToken(brand) {
    let brandAddress = {
        "Eileen Grace": "projects/231801348950/secrets/shopee-tokens/versions/latest",
        "Mamaway": "projects/231801348950/secrets/mmw-shopee-tokens/versions/latest",
        "SHRD": "projects/231801348950/secrets/shrd-shopee-tokens/versions/latest",
        "Miss Daisy": "projects/231801348950/secrets/md-shopee-tokens/versions/latest",
        "Polynia": "projects/231801348950/secrets/poly-shopee-tokens/versions/latest",
        "CHESS": "projects/231801348950/secrets/chess-shopee-tokens/versions/latest",
        "Cléviant": "projects/231801348950/secrets/clev-shopee-tokens/versions/latest",
        "Mossèru": "projects/231801348950/secrets/moss-shopee-tokens/versions/latest",
        "Evoke": "projects/231801348950/secrets/evoke-shopee-tokens/versions/latest",
        "Dr Jou": "projects/231801348950/secrets/drjou-shopee-tokens/versions/latest",
        "Mirae": "projects/231801348950/secrets/mirae-shopee-tokens/versions/latest",
        "Swissvita": "projects/231801348950/secrets/sv-shopee-tokens/versions/latest",
        "G-Belle": "projects/231801348950/secrets/gb-shopee-tokens/versions/latest",
        "Past Nine": "projects/231801348950/secrets/pn-shopee-tokens/versions/latest",
        "Nutri & Beyond": "projects/231801348950/secrets/nb-shopee-tokens/versions/latest",
        "Ivy & Lily": "projects/231801348950/secrets/il-shopee-tokens/versions/latest",
        "Naruko": "projects/231801348950/secrets/naruko-shopee-tokens/versions/latest",
        "Relove": "projects/231801348950/secrets/relove-shopee-tokens/versions/latest",
        "Joey & Roo": "projects/231801348950/secrets/joey-roo-shopee-tokens/versions/latest",
        "M2": "projects/231801348950/secrets/m2-shopee-tokens/versions/latest",
        "Rocketindo Shop": "projects/231801348950/secrets/rocketindoshop-shopee-tokens/versions/latest",
    }
    console.log("Brand address: ", brandAddress[brand])
    try {
        const [version] = await secretClient.accessSecretVersion({
            name: brandAddress[brand],
        });
        const data = version.payload.data.toString('UTF-8');
        const tokens = JSON.parse(data);
        console.log("Tokens loaded from Secret Manager: ", tokens);
        return tokens.accessToken;
    } catch (e) {
        console.log("Error loading tokens from Secret Manager: ", e);
    }
}

export async function warehouseShopee() {

    const brands = [
        "Eileen Grace", "Mamaway", "SHRD", "Miss Daisy", "Polynia",
        "CHESS", "Cléviant", "Mossèru", "Evoke", "Dr Jou",
        "Mirae", "Swissvita", "G-Belle", "Past Nine", "Nutri & Beyond",
        "Ivy & Lily", "Naruko", "Relove", "Joey & Roo", "M2", "Rocketindo Shop",
    ];

    const STAGGER_MS = 5000;

    const tasks = brands.map((brand, i) =>
        sleep(i * STAGGER_MS).then(async () => {
            const { partner_id, partner_key, shop_id } = brandCreds[brand];
            const access_token = await brandAccessToken(brand);
            await mainRealtime(brand, partner_id, partner_key, access_token, shop_id);
        })
    );

    await Promise.all(tasks);
}
// await warehouseShopee();