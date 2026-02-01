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
- Order confirmations
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
  "supplier": string (company name, retailer, or sender name),
  "orderDate": "YYYY-MM-DD" (date of purchase/transaction),
  "totalAmount": number (total amount paid),
  "items": [
    {
      "name": string (full product/item name as shown),
      "normalizedName": string (simplified lowercase name for matching, remove sizes/variants),
      "sku": string or null (part number, catalog number, item number if visible),
      "quantity": number (default to 1 if not specified),
      "unit": string (default to "ea" if not specified),
      "unitPrice": number or null,
      "totalPrice": number or null
    }
  ],
  "confidence": number between 0 and 1
}

RULES:
1. If you see a dollar amount and an item/product, it IS an order - set isOrder: true
2. Receipts ARE orders - extract the data
3. "Your order shipped" means there WAS an order - extract it
4. Payment confirmations ARE orders - extract them
5. Only set isOrder: false for newsletters, marketing emails, or emails with no purchase info

ITEM EXTRACTION RULES:
- For "normalizedName": Create a simplified, lowercase version of the item name by:
  * Removing size information (e.g., "Small", "Large", "XL", sizes like "8oz", "16oz")
  * Removing color/variant information (e.g., "Red", "Blue", "Black")
  * Removing quantity mentions from the name itself
  * Converting to lowercase and removing extra spaces
  * Example: "Nike Air Max 90 - Size 10 - Black" → "nike air max 90"
  
- For "sku": Extract the SKU/part number/catalog number if visible:
  * Look for patterns like "Item #", "Part #", "SKU:", "Catalog #", "Model #", "Product #"
  * Look for alphanumeric codes near the item (e.g., "91255A123", "ABC-123-XYZ")
  * SKU may appear in the same line as the item name or in a separate column/field
  * If no SKU is visible or identifiable, set to null
  * SKU should be extracted exactly as shown (preserve case and formatting)

If this email has NO purchase/transaction information at all, return:
{
  "isOrder": false,
  "supplier": null,
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
