import crypto from 'crypto';
import axios from 'axios';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
const secretClient = new SecretManagerServiceClient();

const brandsInternalApp = {
    "Eileen Grace": 1,
    "Mamaway": 1,
    "SHRD": 1,
    "Miss Daisy": 1,
    "CHESS": 1,
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

const tiktokSecrets = {
    "Eileen Grace": "projects/231801348950/secrets/eg-tiktok-tokens",
    "Mamaway": "projects/231801348950/secrets/mamaway-tiktok-tokens",
    "SHRD": "projects/231801348950/secrets/shrd-tiktok-tokens",
    "Miss Daisy": "projects/231801348950/secrets/md-tiktok-tokens",
    "Polynia": "projects/231801348950/secrets/polynia-tiktok-tokens",
    "CHESS": "projects/231801348950/secrets/chess-tiktok-tokens",
    "Cléviant": "projects/231801348950/secrets/cleviant-tiktok-tokens",
    "Mossèru": "projects/231801348950/secrets/mosseru-tiktok-tokens",
    "Evoke": "projects/231801348950/secrets/evoke-tiktok-tokens",
    "Dr Jou": "projects/231801348950/secrets/drjou-tiktok-tokens",
    "Mirae": "projects/231801348950/secrets/mirae-tiktok-tokens",
    "Swissvita": "projects/231801348950/secrets/swissvita-tiktok-tokens",
    "G-Belle": "projects/231801348950/secrets/gbelle-tiktok-tokens",
    "Past Nine": "projects/231801348950/secrets/pn-tiktok-tokens",
    "Nutri & Beyond": "projects/231801348950/secrets/nb-tiktok-tokens",
    "Ivy & Lily": "projects/231801348950/secrets/il-tiktok-tokens",
    "Naruko": "projects/231801348950/secrets/naruko-tiktok-tokens",
    "Relove": "projects/231801348950/secrets/relove-tiktok-tokens",
    "Joey & Roo": "projects/231801348950/secrets/joey-roo-tiktok-tokens",
    "Rocketindo Shop": "projects/231801348950/secrets/rocketindo-shop-tiktok-tokens",
    "M2": "projects/231801348950/secrets/m2-tiktok-tokens"
}

export async function loadTokens(brand) {
    const secretName = tiktokSecrets[brand] + "/versions/latest";
    try {
        const [version] = await secretClient.accessSecretVersion({
            name: secretName
        });
        const data = version.payload.data.toString('UTF-8');
        const tokens = JSON.parse(data);
        console.log("[TIKTOK-SECRETS] Tokens loaded: ", tokens);
        return tokens;
    } catch (e) {
        console.log("[TIKTOK-SECRETS] Error loading tokens for brand: ", brand);
        console.log(e);
    }
}

export async function saveTokens(brand, tokens) {
    const parent = tiktokSecrets[brand];
    const payload = Buffer.from(JSON.stringify(tokens, null, 2), 'UTF-8');

    try {
        const [newTokens] = await secretClient.addSecretVersion({
            parent: parent,
            payload: {
                data: payload,
            }
        });

        console.log("Saved Tiktok Tokens to Secret Manager on brand: ", brand);

        const [prevTokens] = await secretClient.listSecretVersions({
            parent: parent
        });
        
        for(const prevToken of prevTokens) {
            if(prevToken.name !== newTokens.name && prevToken.state !== 'DESTROYED') {
                try {
                    await secretClient.destroySecretVersion({
                        name: prevToken.name
                    })
                } catch (destroyError) {
                    console.error(`[TIKTOK-SECRETS] Failed to destroy version ${version.name}:`, destroyError);
                }
            }
        }
    } catch (e) {
        console.log("[TIKTOK-SECRETS] Error saving tokens to Secret Manager: ", e);
    }
}

// Tokens are exclusive per shop
// Refresh token itself contains identity of the corresponding shop
// Such is why it does not need shop_cipher or any other parameters. 

export async function refreshTokens(brand, refreshToken) {
    let appKey;
    let appSecret;

    if(brandsInternalApp[brand] === 1) {
        appKey = "6j6u4kmpdda19"
        appSecret = "c4680b9ff6797160adb92104a77e2e1aa085c733"
    } else if(brandsInternalApp[brand] === 2) {
        appKey = "6j7inu4s9dkfq"
        appSecret = "3493907831adc26d58c74262f709b48a2205a2d0"
    } else {
        appKey = "6jbrll2ed26dp";
        appSecret = "04679ae180556cdc79b11a3e7cbd8da33f0d6e92"
    }

    const refreshUrl = "https://auth.tiktok-shops.com/api/v2/token/refresh";
    const queryParams = "?" + "app_key=" + appKey + "&" + "app_secret=" + appSecret + "&" + "refresh_token=" + refreshToken + "&" + "grant_type=refresh_token";
    const completeUrl = refreshUrl + queryParams;

    console.log("[TIKTOK-SECRETS] DEBUG url: ", completeUrl);

    try {   
        const response = await axios.get(completeUrl);

        let newAccessToken = response?.data?.data?.access_token;
        let newRefreshToken = response?.data?.data?.refresh_token;

        if(newAccessToken && newRefreshToken) {
            await saveTokens(brand, {
                accessToken: newAccessToken, 
                refreshToken: newRefreshToken
            });
        } else {
            console.log("[TIKTOK-SECRETS] New tokens dont exist");
        }
    } catch (e) {
        console.log("[TIKTOK-SECRETS] Error refreshing tokens: ", e);
    }
}

export async function getShopCipher(brand, accessToken) {
    try {
        let appKey;
        let appSecret;

        if(brandsInternalApp[brand] === 1) {
            appKey = "6j6u4kmpdda19"
            appSecret = "c4680b9ff6797160adb92104a77e2e1aa085c733"
        } else if(brandsInternalApp[brand] === 2) {
            appKey = "6j7inu4s9dkfq"
            appSecret = "3493907831adc26d58c74262f709b48a2205a2d0"
        } else {
            appKey = "6jbrll2ed26dp";
            appSecret = "04679ae180556cdc79b11a3e7cbd8da33f0d6e92"
        }
        
        const timestamp = Math.floor(Date.now() / 1000);
        const queryParams = "app_key" + appKey + "timestamp" + timestamp;
        const path = "/authorization/202309/shops" // If fail, append "/"
        const result = appSecret + path + queryParams + appSecret;
        const sign = crypto.createHmac('sha256', appSecret).update(result).digest('hex');

        const baseUrl = "https://open-api.tiktokglobalshop.com" + path + "?"
        const completeUrl = baseUrl + "app_key=" + appKey + "&" + "sign=" + sign + "&" + "timestamp=" + timestamp; 
        
        console.log("Hitting get shop cipher for brand: ", brand);
        console.log("Complete url: ", completeUrl);

        const headers = {
            'content-type': 'application/json',
            'x-tts-access-token': accessToken,
        }
        const params = {
            app_key: appKey,
            sign: sign,
            timestamp: timestamp
        }

        const response = await axios.get(completeUrl, {
            headers: headers
        });
        // console.log("[TIKTOK-FINANCE] Raw response: ", response.data.data);

        let authorizedShops = response.data.data.shops;
        let shopCipher = "";
        for(const shop of authorizedShops) {
            console.log("Shop name: ", shop.name);
            if(shop.name.toLowerCase().includes(brand.toLowerCase())) {
                shopCipher = shop.cipher;
            } 
        }

        return shopCipher;

    } catch (e) {
        console.log("Error get shop cipher on brand: ", brand)
        console.log(e);
    }
}