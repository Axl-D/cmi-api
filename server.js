const express = require("express");
const crypto = require("crypto");
const cmi = require("cmi-payment-nodejs");
require("dotenv").config(); // Add this line at the top

const app = express();
const port = process.env.PORT || 3000;

// Add CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CMI Configuration
const CMI_CONFIG = {
  storekey: process.env.CMI_STORE_KEY,
  clientid: process.env.CMI_CLIENT_ID,
  shopurl: process.env.SHOP_URL || "http://localhost:3000",
  okUrl: process.env.OK_URL || "http://localhost:3000/success",
  failUrl: process.env.FAIL_URL || "http://localhost:3000/failure",
  callbackURL: process.env.CALLBACK_URL || "http://localhost:3000/api/payments/callback",
};

// Debug: Log the configuration (remove this in production)
console.log("CMI Config:", {
  storekey: CMI_CONFIG.storekey ? "***SET***" : "NOT SET",
  clientid: CMI_CONFIG.clientid ? "***SET***" : "NOT SET",
  shopurl: CMI_CONFIG.shopurl,
  okUrl: CMI_CONFIG.okUrl,
  failUrl: CMI_CONFIG.failUrl,
  callbackURL: CMI_CONFIG.callbackURL,
});

// Create payment endpoint
app.post("/api/payments/create", async (req, res) => {
  try {
    const {
      amount,
      email,
      phone,
      name,
      description,
      // Custom data fields
      guest_id,
      donated_to,
    } = req.body;

    // Validate required fields
    if (!amount || !email || !phone || !name) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Generate unique transaction ID
    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create CMI client
    const CmiClient = new cmi.default({
      storekey: CMI_CONFIG.storekey,
      clientid: CMI_CONFIG.clientid,
      oid: transactionId,
      shopurl: CMI_CONFIG.shopurl,
      okUrl: CMI_CONFIG.okUrl,
      failUrl: CMI_CONFIG.failUrl,
      email: email,
      BillToName: name,
      amount: amount.toString(),
      callbackURL: CMI_CONFIG.callbackURL,
      tel: phone,

      // Pass custom data to CMI (if supported)
      customData: JSON.stringify({
        guest_id: guest_id,
        donated_to: donated_to,
      }),
    });

    // DEBUG: Log what we're sending to CMI
    console.log("=== PAYMENT CREATION DEBUG ===");
    console.log("Transaction ID:", transactionId);
    console.log("Data being sent to CMI:");
    console.log({
      storekey: CMI_CONFIG.storekey,
      clientid: CMI_CONFIG.clientid,
      oid: transactionId,
      shopurl: CMI_CONFIG.shopurl,
      okUrl: CMI_CONFIG.okUrl,
      failUrl: CMI_CONFIG.failUrl,
      email: email,
      BillToName: name,
      amount: amount.toString(),
      callbackURL: CMI_CONFIG.callbackURL,
      tel: phone,
      customData: JSON.stringify({
        guest_id: guest_id,
        donated_to: donated_to,
      }),
    });
    console.log("==============================");

    // Generate payment form
    const paymentForm = CmiClient.redirect_post();

    res.json({
      success: true,
      transactionId,
      paymentForm,
    });
  } catch (error) {
    console.error("Payment creation error:", error);
    res.status(500).json({ error: "Payment creation failed" });
  }
});

// CMI Callback endpoint - NO TRANSACTION STORAGE NEEDED
app.post("/api/payments/callback", async (req, res) => {
  try {
    const formData = req.body;

    // Get transaction ID
    const transactionId = formData.ReturnOid || formData.oid;

    if (!transactionId) {
      return res.status(400).send("Missing transaction ID");
    }

    // DEBUG: Compare what we sent vs what we received
    console.log("=== CALLBACK COMPARISON DEBUG ===");
    console.log("Transaction ID:", transactionId);
    console.log("Fields received from CMI:");
    console.log("Total fields:", Object.keys(formData).length);
    console.log("Field names:", Object.keys(formData).sort());
    console.log("=================================");

    // Verify hash (this is the critical security step)
    const isHashValid = verifyCMIHash(formData);

    if (isHashValid) {
      if (formData.ProcReturnCode === "00") {
        console.log("Payment successful:", transactionId);

        // NOTIFY BUBBLE.IO with data from CMI callback
        try {
          await notifyBubbleIOFromCMI(formData, "success");
          console.log("Bubble.io notified of successful payment");
        } catch (bubbleError) {
          console.error("Failed to notify Bubble.io:", bubbleError);
        }

        res.send("ACTION=POSTAUTH");
      } else {
        console.log("Payment failed:", transactionId);

        try {
          await notifyBubbleIOFromCMI(formData, "failed");
          console.log("Bubble.io notified of failed payment");
        } catch (bubbleError) {
          console.error("Failed to notify Bubble.io:", bubbleError);
        }

        res.send("APPROVED");
      }
    } else {
      console.log("Hash verification failed:", transactionId);
      res.send("FAILED");
    }
  } catch (error) {
    console.error("Callback error:", error);
    res.status(500).send("Internal server error");
  }
});

// Function to notify Bubble.io using CMI data
async function notifyBubbleIOFromCMI(formData, status) {
  // Parse custom data from CMI response
  let customData = {};
  try {
    if (formData.customData) {
      // Decode HTML entities and parse JSON
      const decodedCustomData = formData.customData.replace(/&#34;/g, '"').replace(/&#39;/g, "'");
      customData = JSON.parse(decodedCustomData);
    }
  } catch (error) {
    console.error("Error parsing custom data:", error);
  }

  const bubbleData = {
    transactionId: formData.ReturnOid || formData.oid,
    amount: parseFloat(formData.amount),
    email: formData.email,
    name: formData.BillToName,
    phone: formData.tel,
    status: status,
    completedAt: new Date().toISOString(),
    cmiResponse: formData,

    // Custom data from CMI
    guest_id: customData.guest_id,
    donated_to: customData.donated_to,
  };

  const response = await fetch(process.env.BUBBLE_ENDPOINT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.BUBBLE_API_KEY}`,
      "User-Agent": "CMI-Payment-Integration/1.0",
    },
    body: JSON.stringify(bubbleData),
    timeout: 10000,
  });

  if (!response.ok) {
    throw new Error(`Bubble.io API returned ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

// Hash verification function with debugging
function verifyCMIHash(formData) {
  try {
    const storeKey = CMI_CONFIG.storekey;
    const postParams = [];

    // Get all POST parameters
    for (const key in formData) {
      if (formData.hasOwnProperty(key)) {
        postParams.push(key);
      }
    }

    // Sort parameters
    postParams.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    let hashval = "";

    console.log("=== HASH VERIFICATION DEBUG ===");
    console.log("Store key:", storeKey ? "SET" : "NOT SET");
    console.log("Sorted parameters:", postParams);

    postParams.forEach((param) => {
      const paramValue = decodeURIComponent(formData[param].replace(/\n$/, ""));
      const escapedParamValue = paramValue.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
      const lowerParam = param.toLowerCase();

      // ✅ EXCLUDE customData from hash calculation
      if (lowerParam !== "hash" && lowerParam !== "encoding" && lowerParam !== "customdata") {
        hashval += escapedParamValue + "|";
        console.log(`Adding to hash: ${param} = ${escapedParamValue}`);
      } else {
        console.log(`EXCLUDED from hash: ${param} = ${escapedParamValue}`);
      }
    });

    // Escape store key and append
    const escapedStoreKey = storeKey?.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
    hashval += escapedStoreKey;
    console.log("Final hash string:", hashval);

    // Generate hash
    const calculatedHashValue = crypto.createHash("sha512").update(hashval).digest("hex");
    const actualHash = Buffer.from(calculatedHashValue, "hex").toString("base64");

    const retrievedHash = formData.HASH;

    console.log("Calculated hash:", actualHash);
    console.log("Retrieved hash:", retrievedHash);
    console.log("Hash match:", retrievedHash === actualHash);
    console.log("================================");

    return retrievedHash === actualHash;
  } catch (error) {
    console.error("Hash verification error:", error);
    return false;
  }
}

// Success page
app.get("/success", (req, res) => {
  const { oid } = req.query;
  res.send(`
        <html>
            <head><title>Payment Successful</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: green;">✅ Payment Successful!</h1>
                <p>Transaction ID: ${oid}</p>
                <p>Thank you for your payment.</p>
            </body>
        </html>
    `);
});

// Failure page
app.get("/failure", (req, res) => {
  const { oid } = req.query;
  res.send(`
        <html>
            <head><title>Payment Failed</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: red;">❌ Payment Failed</h1>
                <p>Transaction ID: ${oid}</p>
                <p>Please try again or contact support.</p>
            </body>
        </html>
    `);
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`CMI Payment API running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
});
