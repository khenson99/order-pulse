import { GoogleGenerativeAI } from '@google/generative-ai';

export interface EmailExtractionInput {
  id: string;
  subject: string;
  sender: string;
  body: string;
  date?: string;
}

export interface ExtractedItem {
  name?: string;
  normalizedName?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number | null;
  totalPrice?: number | null;
  partNumber?: string | null;
  sku?: string | null;
  asin?: string | null;
  [key: string]: unknown;
}

export interface EmailExtractionResult {
  emailId: string;
  isOrder: boolean;
  supplier: string | null;
  orderDate: string;
  totalAmount: number;
  items: ExtractedItem[];
  confidence: number;
  [key: string]: unknown;
}

const EXTRACTION_PROMPT = `You are an order extraction AI. Extract purchase data from emails.

CRITICAL: EXTRACT ACTUAL ITEM NAMES FROM THE EMAIL BODY
DO NOT use placeholders, generic descriptions, or the email subject as item names.
Look for REAL product names, SKUs, and part numbers in the email content.

ITEM EXTRACTION RULES:
1. Find the EXACT product name/description as written in the email
2. Include part numbers/SKUs when present (e.g., "S-1234 Industrial Tape" or "McMaster #91251A540")
3. Extract ALL items - emails often contain multiple line items
4. Look for item tables, order summaries, and line-by-line breakdowns
5. If you cannot find specific item names, set items to an EMPTY array []

AMAZON-SPECIFIC RULES:
- For Amazon orders, ALWAYS extract the ASIN (10-character code starting with B0 or 10 digits)
- Find ASINs in product URLs like amazon.com/dp/B08N5WRWNW or amazon.com/gp/product/B08N5WRWNW
- Also look for ASINs in image URLs or product links
- Set the "asin" field for each Amazon item

WHERE TO FIND ITEMS:
- Order confirmation tables
- Invoice line items
- "Items in your order" sections
- Shipping manifests
- Product name + quantity + price patterns

SUPPLIER RECOGNITION (these are ALWAYS orders):
- Industrial: McMaster-Carr, Grainger, Fastenal, ULine, MSC, Global Industrial, Zoro, Motion
- Electronics: DigiKey, Mouser, Newark, Allied, AutomationDirect, Misumi, RS Components
- General: Amazon, Costco, Home Depot, Lowes
- Shipping: FedEx, UPS, DHL invoices

Return JSON:
{
  "isOrder": true,
  "supplier": "Exact Company Name",
  "orderDate": "YYYY-MM-DD",
  "totalAmount": 123.45,
  "items": [
    {"name": "ACTUAL product name from email", "quantity": 2, "unit": "ea", "unitPrice": 10.50, "partNumber": "ABC-123", "asin": null},
    {"name": "Amazon Product Name", "quantity": 1, "unit": "ea", "unitPrice": 25.00, "partNumber": null, "asin": "B08N5WRWNW"}
  ],
  "confidence": 0.9
}

ONLY set isOrder: false for pure marketing, password resets, or newsletters.
If it's an order but you can't find specific items, still mark isOrder: true with items: []

If you cannot find an order date in the email body, use the email Date header (provided below).

EMAIL:
`;

export function createGeminiExtractionModel(apiKey?: string) {
  const genAI = new GoogleGenerativeAI(apiKey || process.env.GEMINI_API_KEY || '');
  return genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function parseEmailDate(dateHeader?: string): string | null {
  if (!dateHeader) return null;
  const parsed = new Date(dateHeader);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
}

export function normalizeOrderDate(orderDate?: string, fallbackDate?: string): string {
  const candidates = [orderDate, fallbackDate];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }
  return new Date().toISOString().split('T')[0];
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' | ')
    .replace(/<\/th>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<hr[^>]*>/gi, '\n---\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&dollar;/g, '$')
    .replace(/&#36;/g, '$')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractItemsFromBody(body: string): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const seenNames = new Set<string>();

  const priceLinePattern = /([A-Z][^$\n]{5,60})\s*\$(\d+\.?\d*)/gi;
  let match: RegExpExecArray | null;
  while ((match = priceLinePattern.exec(body)) !== null) {
    const name = match[1].trim();
    const price = parseFloat(match[2]);
    if (
      !name.toLowerCase().includes('total') &&
      !name.toLowerCase().includes('subtotal') &&
      !name.toLowerCase().includes('shipping') &&
      !name.toLowerCase().includes('tax') &&
      !seenNames.has(name.toLowerCase())
    ) {
      seenNames.add(name.toLowerCase());
      items.push({
        name,
        normalizedName: name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(),
        quantity: 1,
        unit: 'ea',
        unitPrice: price,
        totalPrice: price,
      });
    }
  }

  const itemNumberPattern = /Item\s*#?\s*:?\s*(\d+)[^$]*\$(\d+\.?\d*)/gi;
  while ((match = itemNumberPattern.exec(body)) !== null) {
    const sku = match[1];
    const price = parseFloat(match[2]);
    const beforeMatch = body.substring(Math.max(0, match.index - 100), match.index);
    const lines = beforeMatch.split('\n').filter(line => line.trim().length > 10);
    const productName = lines[lines.length - 1]?.trim() || `Item ${sku}`;

    if (!seenNames.has(productName.toLowerCase()) && price > 0) {
      seenNames.add(productName.toLowerCase());
      items.push({
        name: productName,
        normalizedName: productName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(),
        sku,
        quantity: 1,
        unit: 'ea',
        unitPrice: price,
        totalPrice: price,
      });
    }
  }

  const qtyPattern = /([A-Za-z][^|\n]{5,60})\s*(?:Qty|Quantity)\s*:?\s*(\d+)\s*[|\s]*\$?(\d+\.?\d*)?/gi;
  while ((match = qtyPattern.exec(body)) !== null) {
    const name = match[1].trim();
    const qty = parseInt(match[2], 10);
    const price = match[3] ? parseFloat(match[3]) : 0;

    if (!seenNames.has(name.toLowerCase()) && qty > 0) {
      seenNames.add(name.toLowerCase());
      items.push({
        name,
        normalizedName: name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(),
        quantity: qty,
        unit: 'ea',
        unitPrice: price || null,
        totalPrice: price ? price * qty : null,
      });
    }
  }

  return items.slice(0, 20);
}

function extractSupplierFromSender(sender: string): string {
  const emailMatch = sender.match(/@([^.]+)/);
  if (emailMatch) {
    return emailMatch[1].charAt(0).toUpperCase() + emailMatch[1].slice(1);
  }
  const nameMatch = sender.match(/^([^<]+)/);
  if (nameMatch) {
    return nameMatch[1].trim();
  }
  return 'Unknown Supplier';
}

function keywordFallbackDetection(
  email: Pick<EmailExtractionInput, 'id' | 'subject' | 'sender' | 'date'>,
  body: string
): EmailExtractionResult {
  const combined = `${email.subject} ${email.sender} ${body}`.toLowerCase();
  const emailDate = parseEmailDate(email.date) || new Date().toISOString().split('T')[0];

  const orderKeywords = [
    'order confirmation', 'order #', 'order number', 'order placed',
    'invoice', 'receipt', 'payment received', 'payment confirmation',
    'your order', 'purchase', 'transaction', 'shipped', 'shipment',
    'tracking number', 'delivered', 'out for delivery',
    'qty', 'quantity', 'subtotal', 'total:', 'grand total', 'amount due',
  ];

  const knownSuppliers: Record<string, string> = {
    amazon: 'Amazon',
    costco: 'Costco',
    walmart: 'Walmart',
    target: 'Target',
    uline: 'Uline',
    grainger: 'Grainger',
    fastenal: 'Fastenal',
    mcmaster: 'McMaster-Carr',
    msc: 'MSC Industrial',
    homedepot: 'Home Depot',
    lowes: 'Lowes',
    sysco: 'Sysco',
    usfoods: 'US Foods',
    zoro: 'Zoro',
    staples: 'Staples',
    officedepot: 'Office Depot',
    newegg: 'Newegg',
    chewy: 'Chewy',
    ebay: 'eBay',
    fedex: 'FedEx',
    ups: 'UPS',
    usps: 'USPS',
  };

  const hasOrderKeyword = orderKeywords.some(keyword => combined.includes(keyword));
  const hasDollarAmount = /\$\d+\.?\d*/i.test(combined);

  let detectedSupplier: string | null = null;
  for (const [key, name] of Object.entries(knownSuppliers)) {
    if (combined.includes(key)) {
      detectedSupplier = name;
      break;
    }
  }

  if ((hasOrderKeyword && hasDollarAmount) || (detectedSupplier && hasDollarAmount)) {
    const extractedItems = extractItemsFromBody(body);
    const totalAmount = extractedItems.reduce(
      (sum, item) => sum + (typeof item.totalPrice === 'number' ? item.totalPrice : (item.unitPrice || 0)),
      0
    );
    return {
      emailId: email.id,
      isOrder: true,
      supplier: detectedSupplier || extractSupplierFromSender(email.sender),
      items: extractedItems,
      confidence: extractedItems.length > 0 ? 0.7 : 0.5,
      orderDate: emailDate,
      totalAmount,
    };
  }

  return {
    emailId: email.id,
    isOrder: false,
    supplier: null,
    items: [],
    confidence: 0,
    orderDate: emailDate,
    totalAmount: 0,
  };
}

export async function analyzeEmailWithRetry(
  model: {
    generateContent: (prompt: string) => Promise<{ response: { text: () => string } }>;
  },
  email: EmailExtractionInput,
  maxRetries: number = 3
): Promise<EmailExtractionResult> {
  let cleanBody = email.body;
  if (cleanBody.includes('<html') || cleanBody.includes('<div') || cleanBody.includes('<table')) {
    cleanBody = stripHtml(cleanBody);
  }

  const emailContent = `
Subject: ${email.subject}
From: ${email.sender}
Date: ${email.date || 'Unknown'}
Content:
${cleanBody.substring(0, 8000)}
`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await model.generateContent(EXTRACTION_PROMPT + emailContent);
      const response = result.response;
      const text = response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        const fallbackResult = keywordFallbackDetection(email, cleanBody);
        if (fallbackResult.isOrder) {
          return fallbackResult;
        }
        return {
          emailId: email.id,
          isOrder: false,
          supplier: null,
          orderDate: normalizeOrderDate(undefined, email.date),
          totalAmount: 0,
          items: [],
          confidence: 0,
        };
      }

      let parsed = JSON.parse(jsonMatch[0]) as Partial<EmailExtractionResult>;

      if (!parsed.isOrder) {
        const fallbackResult = keywordFallbackDetection(email, cleanBody);
        if (fallbackResult.isOrder) {
          parsed = { ...parsed, ...fallbackResult };
        }
      }

      if (parsed.isOrder && (!Array.isArray(parsed.items) || parsed.items.length === 0)) {
        const extractedItems = extractItemsFromBody(cleanBody);
        if (extractedItems.length > 0) {
          parsed.items = extractedItems;
          parsed.totalAmount = extractedItems.reduce(
            (sum, item) => sum + (typeof item.totalPrice === 'number' ? item.totalPrice : (item.unitPrice || 0)),
            0
          );
        }
      }

      return {
        emailId: email.id,
        isOrder: Boolean(parsed.isOrder),
        supplier: parsed.supplier || null,
        orderDate: normalizeOrderDate(parsed.orderDate, email.date),
        totalAmount: typeof parsed.totalAmount === 'number' ? parsed.totalAmount : 0,
        items: Array.isArray(parsed.items) ? parsed.items : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
        ...parsed,
      };
    } catch (error: any) {
      const isRateLimit = error.status === 429 || error.status === 403;
      const isLastAttempt = attempt === maxRetries - 1;

      if (isRateLimit && !isLastAttempt) {
        const waitTime = Math.pow(2, attempt + 1) * 1000;
        await delay(waitTime);
        continue;
      }

      const fallbackResult = keywordFallbackDetection(email, cleanBody);
      if (fallbackResult.isOrder) {
        return fallbackResult;
      }

      return {
        emailId: email.id,
        isOrder: false,
        supplier: null,
        orderDate: normalizeOrderDate(undefined, email.date),
        totalAmount: 0,
        items: [],
        confidence: 0,
      };
    }
  }

  return {
    emailId: email.id,
    isOrder: false,
    supplier: null,
    orderDate: normalizeOrderDate(undefined, email.date),
    totalAmount: 0,
    items: [],
    confidence: 0,
  };
}
