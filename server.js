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

// In-memory storage for demo (use a database in production)
const transactions = new Map();

// Create payment endpoint
app.post("/api/payments/create", async (req, res) => {
  try {
    const { amount, email, phone, name, description } = req.body;

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
    });

    // Store transaction
    transactions.set(transactionId, {
      id: transactionId,
      amount: parseFloat(amount),
      email,
      phone,
      name,
      description: description || "Payment",
      status: "pending",
      createdAt: new Date(),
    });

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

    // Find transaction
    const transaction = transactions.get(transactionId);
    if (!transaction) {
      console.error("Transaction not found:", transactionId);
      return res.status(404).send("Transaction not found");
    }

    // Verify hash (this is the critical security step)
    const isHashValid = verifyCMIHash(formData);

    if (isHashValid) {
      if (formData.ProcReturnCode === "00") {
        // Payment successful - UPDATE TRANSACTION
        transaction.status = "completed";
        transaction.completedAt = new Date();
        transaction.cmiResponse = formData;

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
        transaction.failedAt = new Date();
        transaction.cmiResponse = formData;

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
      transaction.failedAt = new Date();
      transaction.cmiResponse = formData;

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

// Function to notify Bubble.io
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

// Hash verification function (based on your code)
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

    postParams.forEach((param) => {
      const paramValue = decodeURIComponent(formData[param].replace(/\n$/, ""));

      const escapedParamValue = paramValue.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
      const lowerParam = param.toLowerCase();

      if (lowerParam !== "hash" && lowerParam !== "encoding") {
        hashval += escapedParamValue + "|";
      }
    });

    // Escape store key and append
    const escapedStoreKey = storeKey?.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
    hashval += escapedStoreKey;

    // Generate hash
    const calculatedHashValue = crypto.createHash("sha512").update(hashval).digest("hex");
    const actualHash = Buffer.from(calculatedHashValue, "hex").toString("base64");

    const retrievedHash = formData.HASH;

    return retrievedHash === actualHash;
  } catch (error) {
    console.error("Hash verification error:", error);
    return false;
  }
}

// Get transaction status
app.get("/api/payments/status/:transactionId", (req, res) => {
  const { transactionId } = req.params;
  const transaction = transactions.get(transactionId);

  if (!transaction) {
    return res.status(404).json({ error: "Transaction not found" });
  }

  res.json({
    transactionId: transaction.id,
    status: transaction.status,
    amount: transaction.amount,
    createdAt: transaction.createdAt,
    completedAt: transaction.completedAt,
    failedAt: transaction.failedAt,
  });
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
