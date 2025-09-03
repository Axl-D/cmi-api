const express = require("express");
const crypto = require("crypto");
const cmi = require("cmi-payment-nodejs");
const { createClient } = require("redis");
require("dotenv").config(); // Add this line at the top

// Create Redis client using REDIS_URL
const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: 10000, // 10 seconds
    commandTimeout: 5000, // 5 seconds
  },
});

// Connect to Redis
redis.on("error", (err) => console.log("Redis Client Error", err));
redis.connect().then(() => console.log("Connected to Redis"));

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

// Redis storage for transaction data (replaces in-memory Map)

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
      //   guest_id,
      //   donated_to,
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
      //   customData: JSON.stringify({
      //     guest_id: guest_id,
      //     donated_to: donated_to,
      //   }),
    });

    // Store transaction with custom data in Redis
    const transactionData = {
      id: transactionId,
      amount: parseFloat(amount),
      email,
      phone,
      name,
      description: description || "Payment",
      status: "pending",
      createdAt: new Date().toISOString(),

      // Store custom data
      //   guest_id: guest_id,
      //   donated_to: donated_to,
    };

    try {
      // Store in Redis with 1 hour expiration (3600 seconds)
      await redis.setEx(`transaction:${transactionId}`, 3600, JSON.stringify(transactionData));
      console.log("Transaction stored in Redis:", transactionId);
    } catch (redisError) {
      console.error("Failed to store transaction in Redis:", redisError);
      // Continue with payment creation even if Redis storage fails
    }

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
      //   customData: JSON.stringify({
      //     guest_id: guest_id,
      //     donated_to: donated_to,
      //   }),
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

// CMI Callback endpoint
app.post("/api/payments/callback", async (req, res) => {
  try {
    const formData = req.body;
    console.log("CMI Callback received:", formData);

    // Get transaction ID
    const transactionId = formData.ReturnOid || formData.oid;

    if (!transactionId) {
      return res.status(400).send("Missing transaction ID");
    }

    // Retrieve transaction from Redis
    let transaction = null;
    try {
      const storedData = await redis.get(`transaction:${transactionId}`);
      if (storedData) {
        transaction = JSON.parse(storedData);
        console.log("Transaction retrieved from Redis:", transactionId);
      } else {
        console.error("Transaction not found in Redis:", transactionId);
        return res.status(404).send("Transaction not found");
      }
    } catch (redisError) {
      console.error("Failed to retrieve transaction from Redis:", redisError);
      return res.status(500).send("Database error");
    }

    // Verify hash (this is the critical security step)
    const isHashValid = verifyCMIHash(formData);

    if (isHashValid) {
      if (formData.ProcReturnCode === "00") {
        // Payment successful - UPDATE TRANSACTION
        transaction.status = "completed";
        transaction.completedAt = new Date().toISOString();
        transaction.cmiResponse = formData;

        // Update transaction in Redis
        try {
          await redis.setEx(`transaction:${transactionId}`, 3600, JSON.stringify(transaction));
        } catch (redisError) {
          console.error("Failed to update transaction in Redis:", redisError);
        }

        console.log("Payment successful:", transactionId);

        // NOTIFY BUBBLE.IO
        try {
          await notifyBubbleIO(transaction, "success");
          console.log("Bubble.io notified of successful payment");
        } catch (bubbleError) {
          console.error("Failed to notify Bubble.io:", bubbleError);
          // Don't fail the payment - log the error but still confirm to CMI
        }

        res.send("ACTION=POSTAUTH");
      } else {
        // Payment failed - UPDATE TRANSACTION
        transaction.status = "failed";
        transaction.failedAt = new Date().toISOString();
        transaction.cmiResponse = formData;

        // Update transaction in Redis
        try {
          await redis.setEx(`transaction:${transactionId}`, 3600, JSON.stringify(transaction));
        } catch (redisError) {
          console.error("Failed to update transaction in Redis:", redisError);
        }

        console.log("Payment failed:", transactionId);

        // NOTIFY BUBBLE.IO
        try {
          await notifyBubbleIO(transaction, "failed");
          console.log("Bubble.io notified of failed payment");
        } catch (bubbleError) {
          console.error("Failed to notify Bubble.io:", bubbleError);
        }

        res.send("APPROVED");
      }
    } else {
      // Hash verification failed - SECURITY BREACH
      transaction.status = "failed";
      transaction.failedAt = new Date().toISOString();
      transaction.cmiResponse = formData;

      // Update transaction in Redis
      try {
        await redis.setEx(`transaction:${transactionId}`, 3600, JSON.stringify(transaction));
      } catch (redisError) {
        console.error("Failed to update transaction in Redis:", redisError);
      }

      console.log("Hash verification failed - SECURITY ALERT:", transactionId);

      // NOTIFY BUBBLE.IO OF SECURITY ISSUE
      try {
        await notifyBubbleIO(transaction, "security_failed");
        console.log("Bubble.io notified of security failure");
      } catch (bubbleError) {
        console.error("Failed to notify Bubble.io:", bubbleError);
      }

      res.send("FAILED");
    }
  } catch (error) {
    console.error("Callback error:", error);
    res.status(500).send("Internal server error");
  }
});

// Function to notify Bubble.io with custom data
async function notifyBubbleIO(transaction, status) {
  const bubbleData = {
    transactionId: transaction.id,
    amount: transaction.amount,
    email: transaction.email,
    name: transaction.name,
    phone: transaction.phone,
    description: transaction.description,
    status: status, // "success", "failed", or "security_failed"
    completedAt: transaction.completedAt,
    failedAt: transaction.failedAt,
    cmiResponse: transaction.cmiResponse,

    // Include custom data in Bubble.io notification
    // guest_id: transaction.guest_id,
    // donated_to: transaction.donated_to,
  };

  // Call your Bubble.io endpoint
  const response = await fetch(process.env.BUBBLE_ENDPOINT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.BUBBLE_API_KEY}`, // If you need API key
      "User-Agent": "CMI-Payment-Integration/1.0",
    },
    body: JSON.stringify(bubbleData),
    timeout: 10000, // 10 second timeout
  });

  if (!response.ok) {
    throw new Error(`Bubble.io API returned ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  console.log("Bubble.io response:", result);
  return result;
}

// Hash verification function with comprehensive logging
function verifyCMIHash(formData) {
  try {
    const storeKey = CMI_CONFIG.storekey;
    const postParams = [];

    console.log("=== HASH VERIFICATION DEBUG ===");
    console.log("Store key from env:", storeKey ? "SET" : "NOT SET");
    console.log("Store key value:", storeKey);
    console.log("CMI Config:", CMI_CONFIG);

    // Get all POST parameters
    for (const key in formData) {
      if (formData.hasOwnProperty(key)) {
        postParams.push(key);
      }
    }

    // Sort parameters
    postParams.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    let hashval = "";

    console.log("Total fields received:", postParams.length);
    console.log("Sorted parameters:", postParams);

    postParams.forEach((param) => {
      // Remove trailing newlines and decode URI components
      const paramValue = decodeURIComponent(formData[param].replace(/\n$/, "").replace(/\r$/, ""));

      const escapedParamValue = paramValue.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
      const lowerParam = param.toLowerCase();

      if (lowerParam !== "hash" && lowerParam !== "encoding") {
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
    console.log("Hash string length:", hashval.length);

    // Generate hash
    const calculatedHashValue = crypto.createHash("sha512").update(hashval).digest("hex");
    const actualHash = Buffer.from(calculatedHashValue, "hex").toString("base64");

    const retrievedHash = formData.HASH;

    console.log("Calculated hash:", actualHash);
    console.log("Retrieved hash:", retrievedHash);
    console.log("Hash match:", retrievedHash === actualHash);
    console.log("Hash lengths - Calculated:", actualHash.length, "Retrieved:", retrievedHash.length);
    console.log("================================");

    return retrievedHash === actualHash;
  } catch (error) {
    console.error("Hash verification error:", error);
    return false;
  }
}

// Get transaction status
app.get("/api/payments/status/:transactionId", async (req, res) => {
  try {
    const { transactionId } = req.params;

    // Retrieve transaction from Redis
    const storedData = await redis.get(`transaction:${transactionId}`);
    if (!storedData) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    const transaction = JSON.parse(storedData);

    res.json({
      transactionId: transaction.id,
      status: transaction.status,
      amount: transaction.amount,
      createdAt: transaction.createdAt,
      completedAt: transaction.completedAt,
      failedAt: transaction.failedAt,
    });
  } catch (error) {
    console.error("Error retrieving transaction status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

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
