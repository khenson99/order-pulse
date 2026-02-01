import { Router, Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

// Initialize Gemini AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Middleware to require authentication
function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

const EXTRACTION_PROMPT = `You are an AI assistant that extracts structured order/purchase data from emails.

IMPORTANT: The following types of emails ALL contain order information that should be extracted:
- Order confirmations (e.g., "Order Confirmation", "Thank you for your order")
- Purchase receipts
- Payment confirmations
- Invoices
- Shipping notifications
- Delivery confirmations
- Transaction receipts
- E-receipts from any retailer

Analyze the email and extract purchase/order information. Even if it says "receipt" or "transaction", it IS an order that should be extracted.

Return a JSON object with this structure:
{
  "isOrder": boolean (TRUE for ANY email showing a purchase, receipt, payment, or transaction),
  "supplier": string (company name - e.g., "Costco", "Amazon", "McMaster-Carr", NOT the full domain),
  "orderNumber": string or null (order/confirmation number if visible),
  "orderDate": "YYYY-MM-DD" (date of purchase/transaction),
  "totalAmount": number (the TOTAL/final amount paid, including tax and shipping),
  "items": [
    {
      "name": string (full product/item name as shown),
      "normalizedName": string (simplified lowercase name for matching),
      "sku": string or null (item number, part number, catalog number),
      "quantity": number (look for "Quantity X" or "Qty: X" patterns),
      "unit": string (default to "ea"),
      "unitPrice": number or null (price per single item),
      "totalPrice": number or null (quantity × unitPrice if calculable)
    }
  ],
  "confidence": number between 0 and 1
}

RETAILER-SPECIFIC PATTERNS:

**Costco emails:**
- Subject often says "Order from Costco" 
- Item format: Product name, then "Item # XXXXXXX", then "$XX.XX", then "Quantity X"
- Look for "Total" at the bottom for totalAmount
- Order number is in "Order Number XXXXXXXXXX"

**Amazon / Amazon Business emails:**
- Order number format: "111-XXXXXXX-XXXXXXX" (e.g., "111-0528889-9155413")
- Look for "Order #" followed by the number
- Item format: Product name, then "Qty: X"
- "Sold by [seller name]" indicates the seller, NOT part of the item name
- IMPORTANT: Sections titled "Buy it again", "Recommended for you", "Customers also bought" show OTHER products - DO NOT extract these as order items
- Shipping confirmations ("We have shipped your items") may not have prices - set unitPrice to null
- Item names may be truncated with "..." - extract what's visible
- For shipping date, use "Expected Delivery" date if no order date is shown

**McMaster-Carr emails:**
- SKUs are alphanumeric like "91255A123"
- Format: Part number, description, quantity, unit price

**Industrial suppliers (Grainger, Uline, Fastenal, MSC, Digikey, Mouser):**
- Usually have clear part numbers/SKUs
- Often show unit price and extended price separately

**SaaS / Subscription receipts (Stripe, PayPal, digital services):**
- Receipts from companies like "Lovable Labs", "GetEmails", "Vercel", "Heroku", "AWS", etc.
- The subject line often says "Your receipt from [Company] #[number]" - the NUMBER is the order number, NOT the item name
- Look INSIDE the email body for the actual product/service name (e.g., "Pro Plan", "Monthly Subscription", "API Credits", "Usage-based billing")
- The company name in "Your receipt from [Company]" is the SUPPLIER
- If there's a line like "Amount: $X.XX" or "Total: $X.XX", that's the total
- For subscription services, the item name might be: plan name, subscription tier, credits, or usage description
- If no specific product is listed, use the company name + "Subscription" or "Service" as the item name (e.g., "Lovable Labs Subscription")

CRITICAL - DO NOT USE EMAIL SUBJECT AS ITEM NAME:
- "Your receipt from Lovable Labs Incorporated #2091-4979" → supplier: "Lovable Labs", orderNumber: "2091-4979", then find actual item in body
- "Your receipt from GetEmails, LLC #2486-6774" → supplier: "GetEmails", orderNumber: "2486-6774", then find actual item in body
- The receipt header/subject is NOT the product name - look for the product/service description in the body

ITEM EXTRACTION RULES:

1. For "name": Extract the FULL product name as shown in the email BODY (e.g., "Mr. Clean Magic Eraser, Extra Durable, 15-count")
   - NEVER use the email subject line as the item name
   - NEVER use receipt headers like "Your receipt from [Company] #[number]" as the item name
   - Look for actual product descriptions, plan names, or service descriptions
   - For SaaS: "Pro Plan", "Monthly Subscription", "1000 API Credits", "Standard Tier"
   - If truly no product name in body, use "[Company] Service" or "[Company] Subscription"

2. For "normalizedName": Create a simplified version for matching:
   - Convert to lowercase
   - Remove pack sizes like "15-count", "4-pack", "32 fl oz"
   - Remove color/variant info
   - Example: "Mr. Clean Magic Eraser, Extra Durable, 15-count" → "mr clean magic eraser extra durable"
   - Example: "Lysol Advanced Toilet Bowl Cleaner, 32 fl oz, 4-count" → "lysol advanced toilet bowl cleaner"

3. For "sku": Extract the item/part number:
   - Look for "Item #", "Item#", "Part #", "SKU:", "Catalog #"
   - Costco uses "Item # 1732381" format
   - McMaster uses "91255A123" format
   - Extract JUST the number/code, not the label
   - Example: "Item # 1732381" → "1732381"

4. For "quantity": 
   - Look for "Quantity X", "Qty: X", "Qty X", or "× X"
   - Default to 1 if not specified

5. For "unitPrice":
   - This is the price for ONE item
   - Usually shown as "$XX.XX" near the item
   - If only total shown with quantity, divide to get unit price

6. For "totalPrice":
   - This is quantity × unitPrice for this line item
   - May be labeled "Extended", "Subtotal", or just shown after quantity

EXAMPLE - Costco email with items:
"Mr. Clean Magic Eraser, Extra Durable, 15-count
Item # 1732381
$19.99
Quantity 2"

Should extract as:
{
  "name": "Mr. Clean Magic Eraser, Extra Durable, 15-count",
  "normalizedName": "mr clean magic eraser extra durable",
  "sku": "1732381",
  "quantity": 2,
  "unit": "ea",
  "unitPrice": 19.99,
  "totalPrice": 39.98
}

CRITICAL RULES:
1. Extract ALL items that were ACTUALLY ORDERED. Do not stop at the first item.
2. DO NOT include items from "Buy it again", "Recommended for you", "Customers also bought", or similar suggestion sections - these are NOT part of the order.
3. Shipping confirmations ARE orders - extract them even if price is not shown (set unitPrice to null).
4. Look for "Qty:" or "Quantity" to identify actual order items.
5. If item names are truncated with "...", extract what's visible.

If this email has NO purchase/transaction information at all, return:
{
  "isOrder": false,
  "supplier": null,
  "orderNumber": null,
  "orderDate": null,
  "totalAmount": null,
  "items": [],
  "confidence": 0
}

Only return valid JSON, no other text.

EMAIL CONTENT:
`;

// Helper function to delay execution
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Analyze a single email with retry logic
async function analyzeEmailWithRetry(
  model: any,
  email: { id: string; subject: string; sender: string; body: string },
  maxRetries: number = 3
): Promise<any> {
  const emailContent = `
Subject: ${email.subject}
From: ${email.sender}
Content:
${email.body.substring(0, 8000)}
`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await model.generateContent(EXTRACTION_PROMPT + emailContent);
      const response = result.response;
      const text = response.text();
      
      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { emailId: email.id, isOrder: false, items: [], confidence: 0 };
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        emailId: email.id,
        ...parsed,
      };
    } catch (error: any) {
      const isRateLimit = error.status === 429 || error.status === 403;
      const isLastAttempt = attempt === maxRetries - 1;
      
      if (isRateLimit && !isLastAttempt) {
        // Exponential backoff: 2s, 4s, 8s...
        const waitTime = Math.pow(2, attempt + 1) * 1000;
        console.log(`⏳ Rate limited, waiting ${waitTime/1000}s before retry...`);
        await delay(waitTime);
        continue;
      }
      
      console.error(`Parse error for email ${email.id}:`, error.message || error);
      return { emailId: email.id, isOrder: false, items: [], confidence: 0 };
    }
  }
  
  return { emailId: email.id, isOrder: false, items: [], confidence: 0 };
}

// Analyze email with Gemini AI
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Missing emails array' });
    }

    console.log(`🧠 Analyzing ${emails.length} emails with Gemini AI...`);
    
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    // Process emails sequentially to avoid rate limits
    const results: any[] = [];
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      const result = await analyzeEmailWithRetry(model, email);
      results.push(result);
      
      // Small delay between requests to avoid rate limiting
      if (i < emails.length - 1) {
        await delay(100); // 100ms between requests
      }
    }

    console.log(`✅ Analyzed ${results.length} emails`);
    res.json({ results });
  } catch (error: any) {
    console.error('Gemini analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze emails' });
  }
});

export { router as analysisRouter };
