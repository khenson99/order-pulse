// Jobs API - Background email processing
import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getValidAccessToken } from './auth.js';
import { 
  jobManager,
  Job,
  ProcessedOrder,
} from '../services/jobManager.js';
import { 
  extractAsinsFromEmail, 
  getAmazonItemDetails 
} from '../services/amazon.js';

const router = Router();

// Extract text from PDF attachments
async function extractPdfText(gmail: any, messageId: string, attachmentId: string): Promise<string> {
  try {
    const attachment = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: messageId,
      id: attachmentId,
    });
    
    if (!attachment.data.data) {
      return '';
    }
    
    const buffer = Buffer.from(attachment.data.data, 'base64');
    
    // Dynamic import to handle ESM/CJS compatibility
    const pdfParseModule = await import('pdf-parse') as any;
    const pdfParse = pdfParseModule.default || pdfParseModule;
    const pdfData = await pdfParse(buffer);
    return pdfData.text;
  } catch (error) {
    console.error(`Failed to extract PDF text from attachment ${attachmentId}:`, error);
    return '';
  }
}

// Extract attachment info from email parts recursively
function findAttachments(parts: any[], attachments: Array<{ filename: string; attachmentId: string; mimeType: string }> = []): Array<{ filename: string; attachmentId: string; mimeType: string }> {
  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        attachmentId: part.body.attachmentId,
        mimeType: part.mimeType || '',
      });
    }
    if (part.parts) {
      findAttachments(part.parts, attachments);
    }
  }
  return attachments;
}

// Initialize Gemini AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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
  "orderDate": "${new Date().toISOString().split('T')[0]}",
  "totalAmount": 123.45,
  "items": [
    {"name": "ACTUAL product name from email", "quantity": 2, "unit": "ea", "unitPrice": 10.50, "partNumber": "ABC-123", "asin": null},
    {"name": "Amazon Product Name", "quantity": 1, "unit": "ea", "unitPrice": 25.00, "partNumber": null, "asin": "B08N5WRWNW"}
  ],
  "confidence": 0.9
}

ONLY set isOrder: false for pure marketing, password resets, or newsletters.
If it's an order but you can't find specific items, still mark isOrder: true with items: []

EMAIL:
`;

// Helper function to delay execution
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Recursively extract text from email parts
function extractTextFromParts(parts: any[]): string {
  let text = '';
  
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      const decoded = Buffer.from(part.body.data, 'base64').toString('utf-8');
      if (decoded.length > text.length) {
        text = decoded;
      }
    } else if (part.mimeType === 'text/html' && part.body?.data && text.length === 0) {
      // Only use HTML if we don't have plain text
      text = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.parts) {
      // Recursively check nested parts
      const nestedText = extractTextFromParts(part.parts);
      if (nestedText.length > text.length) {
        text = nestedText;
      }
    }
  }
  
  return text;
}

// Strip HTML tags for cleaner analysis - preserves table structure
function stripHtml(html: string): string {
  return html
    // Remove style and script tags entirely
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    // Convert table structure to readable format
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' | ')
    .replace(/<\/th>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<hr[^>]*>/gi, '\n---\n')
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&dollar;/g, '$')
    .replace(/&#36;/g, '$')
    // Clean up whitespace while preserving line structure
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Analyze a single email with retry logic
async function analyzeEmailWithRetry(
  model: any,
  email: { id: string; subject: string; sender: string; body: string },
  maxRetries: number = 3
): Promise<any> {
  // Clean the body - strip HTML if needed
  let cleanBody = email.body;
  if (cleanBody.includes('<html') || cleanBody.includes('<div') || cleanBody.includes('<table')) {
    cleanBody = stripHtml(cleanBody);
  }
  
  const emailContent = `
Subject: ${email.subject}
From: ${email.sender}
Content:
${cleanBody.substring(0, 8000)}
`;

  // Debug: log what we're analyzing
  console.log(`🔍 Analyzing: "${email.subject}" from ${email.sender}`);
  console.log(`   Body length: ${cleanBody.length} chars (original: ${email.body.length})`);
  if (cleanBody.length < 50) {
    console.log(`   ⚠️ Very short body: "${cleanBody.substring(0, 100)}"`);
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await model.generateContent(EXTRACTION_PROMPT + emailContent);
      const response = result.response;
      const text = response.text();
      
      // Debug: log raw response
      console.log(`   Gemini response (${text.length} chars): ${text.substring(0, 200)}...`);
      
      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log(`   ❌ No JSON found in response`);
        // Fallback: check for order keywords in the original email
        const fallbackResult = keywordFallbackDetection(email, cleanBody);
        if (fallbackResult.isOrder) {
          console.log(`   🔄 Keyword fallback triggered: detected as order`);
          return fallbackResult;
        }
        return { emailId: email.id, isOrder: false, items: [], confidence: 0 };
      }
      
      let parsed = JSON.parse(jsonMatch[0]);
      
      // FALLBACK: If Gemini says not an order but we see clear signals, override
      if (!parsed.isOrder) {
        const fallbackResult = keywordFallbackDetection(email, cleanBody);
        if (fallbackResult.isOrder) {
          console.log(`   🔄 Keyword fallback OVERRIDE: Gemini said no order but keywords detected`);
          parsed = { ...parsed, ...fallbackResult };
        }
      }
      
      console.log(`   Result: isOrder=${parsed.isOrder}, items=${parsed.items?.length || 0}, supplier=${parsed.supplier}`);
      
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
        console.log(`   ⏳ Rate limited, waiting ${waitTime/1000}s...`);
        await delay(waitTime);
        continue;
      }
      
      console.error(`   ❌ Parse error for email ${email.id}:`, error.message || error);
      // Try keyword fallback on error too
      const fallbackResult = keywordFallbackDetection(email, cleanBody);
      if (fallbackResult.isOrder) {
        console.log(`   🔄 Error recovery: keyword fallback detected order`);
        return fallbackResult;
      }
      return { emailId: email.id, isOrder: false, items: [], confidence: 0 };
    }
  }
  
  return { emailId: email.id, isOrder: false, items: [], confidence: 0 };
}

// Keyword-based fallback detection when Gemini fails
function keywordFallbackDetection(
  email: { id: string; subject: string; sender: string },
  body: string
): { emailId: string; isOrder: boolean; supplier: string | null; items: any[]; confidence: number; orderDate: string } {
  const combined = `${email.subject} ${email.sender} ${body}`.toLowerCase();
  
  // Strong order signal keywords
  const orderKeywords = [
    'order confirmation', 'order #', 'order number', 'order placed',
    'invoice', 'receipt', 'payment received', 'payment confirmation',
    'your order', 'purchase', 'transaction', 'shipped', 'shipment',
    'tracking number', 'delivered', 'out for delivery',
    'qty', 'quantity', 'subtotal', 'total:', 'grand total', 'amount due'
  ];
  
  // Known supplier domains/names
  const knownSuppliers: Record<string, string> = {
    'amazon': 'Amazon',
    'costco': 'Costco',
    'walmart': 'Walmart',
    'target': 'Target',
    'uline': 'ULine',
    'grainger': 'Grainger',
    'fastenal': 'Fastenal',
    'mcmaster': 'McMaster-Carr',
    'msc': 'MSC Industrial',
    'homedepot': 'Home Depot',
    'lowes': 'Lowes',
    'sysco': 'Sysco',
    'usfoods': 'US Foods',
    'zoro': 'Zoro',
    'staples': 'Staples',
    'officedepot': 'Office Depot',
    'newegg': 'Newegg',
    'chewy': 'Chewy',
    'ebay': 'eBay',
    'fedex': 'FedEx',
    'ups': 'UPS',
    'usps': 'USPS'
  };
  
  // Check for keywords
  const hasOrderKeyword = orderKeywords.some(kw => combined.includes(kw));
  
  // Check for dollar amounts
  const hasDollarAmount = /\$\d+\.?\d*/i.test(combined);
  
  // Detect supplier
  let detectedSupplier: string | null = null;
  for (const [key, name] of Object.entries(knownSuppliers)) {
    if (combined.includes(key)) {
      detectedSupplier = name;
      break;
    }
  }
  
  // If we have strong signals, return as order
  if ((hasOrderKeyword && hasDollarAmount) || (detectedSupplier && hasDollarAmount)) {
    return {
      emailId: email.id,
      isOrder: true,
      supplier: detectedSupplier || extractSupplierFromSender(email.sender),
      items: [], // Items would need deeper parsing
      confidence: 0.6, // Lower confidence for fallback detection
      orderDate: new Date().toISOString().split('T')[0]
    };
  }
  
  return {
    emailId: email.id,
    isOrder: false,
    supplier: null,
    items: [],
    confidence: 0,
    orderDate: new Date().toISOString().split('T')[0]
  };
}

// Extract supplier name from email sender
function extractSupplierFromSender(sender: string): string {
  // Try to extract domain or name from sender
  const emailMatch = sender.match(/@([^.]+)/);
  if (emailMatch) {
    return emailMatch[1].charAt(0).toUpperCase() + emailMatch[1].slice(1);
  }
  // Try to extract name before email
  const nameMatch = sender.match(/^([^<]+)/);
  if (nameMatch) {
    return nameMatch[1].trim();
  }
  return 'Unknown Supplier';
}

// Run the actual processing in the background
async function processEmailsInBackground(
  jobId: string,
  userId: string,
  accessToken: string,
  supplierDomains?: string[]
) {
  const job = jobManager.getJob(jobId);
  if (!job) return;

  try {
    // Update job status
    jobManager.updateJob(jobId, { status: 'running' });
    jobManager.addJobLog(jobId, '📧 Fetching emails from Gmail...');
    jobManager.updateJobProgress(jobId, { currentTask: 'Fetching emails...' });

    // Fetch Gmail messages
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Calculate 6 months ago for date filter
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const afterDate = sixMonthsAgo.toISOString().split('T')[0].replace(/-/g, '/');

    // Build query - ONLY for selected suppliers, EXCLUDING Amazon (handled separately)
    // Remove any Amazon domains from the list since Amazon is processed separately
    const nonAmazonDomains = (supplierDomains || []).filter(d => 
      !d.toLowerCase().includes('amazon')
    );
    
    if (nonAmazonDomains.length === 0) {
      jobManager.addJobLog(jobId, '⚠️ No non-Amazon suppliers selected');
      jobManager.updateJob(jobId, { status: 'completed' });
      return;
    }
    
    // Build query ONLY for selected suppliers - no general query
    const fromClause = nonAmazonDomains.map(d => `from:${d}`).join(' OR ');
    const query = `(${fromClause}) subject:(order OR invoice OR receipt OR confirmation OR shipment OR purchase OR payment) after:${afterDate}`;
    
    jobManager.addJobLog(jobId, `🔍 Processing ${nonAmazonDomains.length} suppliers: ${nonAmazonDomains.slice(0, 5).join(', ')}${nonAmazonDomains.length > 5 ? '...' : ''}`);
    
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 200, // Reduced for faster processing
    });

    const messageIds = listResponse.data.messages || [];
    jobManager.addJobLog(jobId, `📬 Found ${messageIds.length} matching emails`);
    
    if (messageIds.length === 0) {
      jobManager.addJobLog(jobId, '⚠️ No order-related emails found in the last 6 months');
      jobManager.updateJob(jobId, { status: 'completed' });
      return;
    }

    // STEP 1: Fetch headers for ALL emails to sort by vendor
    jobManager.updateJobProgress(jobId, { 
      total: messageIds.length,
      currentTask: 'Fetching email headers to group by vendor...' 
    });
    
    interface EmailInfo {
      id: string;
      subject: string;
      sender: string;
      vendorDomain: string;
    }
    
    const emailInfos: EmailInfo[] = [];
    
    for (let i = 0; i < messageIds.length; i++) {
      const msg = messageIds[i];
      try {
        const metaMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject'],
        });
        
        const headers = metaMsg.data.payload?.headers || [];
        const sender = headers.find(h => h.name === 'From')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        
        // Extract domain from sender
        const domainMatch = sender.match(/@([a-zA-Z0-9.-]+)/);
        const vendorDomain = domainMatch ? domainMatch[1].toLowerCase() : 'unknown';
        
        emailInfos.push({ id: msg.id!, subject, sender, vendorDomain });
      } catch (error) {
        console.error(`Error fetching metadata for ${msg.id}:`, error);
      }
      
      if (i % 20 === 0) {
        jobManager.updateJobProgress(jobId, { 
          processed: i,
          currentTask: `Indexing emails ${i}/${messageIds.length}...` 
        });
      }
    }
    
    // STEP 2: Group and sort by vendor domain
    const emailsByVendor = new Map<string, EmailInfo[]>();
    for (const email of emailInfos) {
      const existing = emailsByVendor.get(email.vendorDomain) || [];
      existing.push(email);
      emailsByVendor.set(email.vendorDomain, existing);
    }
    
    // Sort vendors by email count (most emails first) and create ordered list
    const sortedVendors = Array.from(emailsByVendor.entries())
      .sort((a, b) => b[1].length - a[1].length);
    
    jobManager.addJobLog(jobId, `📊 Grouped into ${sortedVendors.length} vendors`);
    for (const [vendor, emails] of sortedVendors.slice(0, 5)) {
      jobManager.addJobLog(jobId, `   • ${vendor}: ${emails.length} emails`);
    }

    // Initialize Gemini model upfront
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // STEP 3: Process vendor by vendor
    let totalProcessed = 0;
    const totalEmails = emailInfos.length;
    
    for (const [vendorDomain, vendorEmails] of sortedVendors) {
      const vendorName = vendorDomain.split('.')[0].charAt(0).toUpperCase() + vendorDomain.split('.')[0].slice(1);
      jobManager.addJobLog(jobId, `\n🏢 Processing ${vendorName} (${vendorEmails.length} emails)...`);
      
      for (const emailInfo of vendorEmails) {
        try {
          // Fetch full email content
          const fullMsg = await gmail.users.messages.get({
            userId: 'me',
            id: emailInfo.id,
            format: 'full',
          });
          
          const headers = fullMsg.data.payload?.headers || [];
          const getHeader = (name: string) => 
            headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

          let body = '';
          const parts = fullMsg.data.payload?.parts || [];
          
          if (fullMsg.data.payload?.body?.data) {
            body = Buffer.from(fullMsg.data.payload.body.data, 'base64').toString('utf-8');
          } else if (parts.length > 0) {
            body = extractTextFromParts(parts);
          }
          
          if (!body || body.length < 20) {
            const snippet = fullMsg.data.snippet || '';
            body = snippet;
          }

          // Extract text from PDF attachments (invoices, order confirmations)
          const attachments = findAttachments(parts);
          const pdfAttachments = attachments.filter(a => 
            a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')
          );
          
          if (pdfAttachments.length > 0) {
            for (const pdfAttachment of pdfAttachments) {
              const pdfText = await extractPdfText(gmail, emailInfo.id, pdfAttachment.attachmentId);
              if (pdfText) {
                body += `\n\n--- PDF: ${pdfAttachment.filename} ---\n${pdfText.substring(0, 15000)}`;
              }
            }
          }

          const email = {
            id: emailInfo.id,
            subject: getHeader('Subject'),
            sender: getHeader('From'),
            body,
          };

          // Update current email being processed
          jobManager.setJobCurrentEmail(jobId, {
            id: email.id,
            subject: email.subject,
            sender: email.sender,
            snippet: email.body.substring(0, 100) + '...',
          });
          
          jobManager.updateJobProgress(jobId, { 
            processed: totalProcessed,
            currentTask: `${vendorName}: ${emailInfo.subject.substring(0, 40)}...`
          });

          // Analyze with AI
          const result = await analyzeEmailWithRetry(model, email);
          
          // Process result and LOG ITEMS FOUND
          if (result.isOrder && result.items?.length > 0) {
            const order: ProcessedOrder = {
              id: result.emailId || email.id,
              supplier: result.supplier || vendorName,
              orderDate: result.orderDate || new Date().toISOString().split('T')[0],
              totalAmount: result.totalAmount || 0,
              items: result.items.map((item: any, idx: number) => ({
                id: `${email.id}-${idx}`,
                name: item.name || 'Unknown Item',
                quantity: item.quantity || 1,
                unit: item.unit || 'ea',
                unitPrice: item.unitPrice || 0,
              })),
              confidence: result.confidence || 0.8,
            };
            
            jobManager.addJobOrder(jobId, order);
            
            // Log each item found for real-time visibility
            for (const item of result.items.slice(0, 3)) {
              const price = item.unitPrice ? `$${item.unitPrice.toFixed(2)}` : '';
              const qty = item.quantity > 1 ? `x${item.quantity}` : '';
              jobManager.addJobLog(jobId, `   📦 ${item.name?.substring(0, 50) || 'Item'} ${qty} ${price}`);
            }
            if (result.items.length > 3) {
              jobManager.addJobLog(jobId, `   ... and ${result.items.length - 3} more items`);
            }
          }
          
          totalProcessed++;
          
          // Small delay between requests to avoid rate limits
          await delay(100);
          
        } catch (error: any) {
          console.error(`Failed to process email ${emailInfo.id}:`, error);
          // Log rate limit errors specifically
          if (error.message?.includes('429') || error.message?.includes('quota')) {
            jobManager.addJobLog(jobId, `   ⚠️ Rate limited - waiting...`);
            await delay(2000);
          }
        }
      }
      
      // Log vendor completion
      const currentJob = jobManager.getJob(jobId);
      const ordersFound = currentJob?.progress.success || 0;
      jobManager.addJobLog(jobId, `   ✓ ${vendorName} complete (${ordersFound} total orders)`);
    }

    // Complete
    const finalJob = jobManager.getJob(jobId);
    jobManager.updateJob(jobId, { status: 'completed' });
    jobManager.setJobCurrentEmail(jobId, null);
    jobManager.updateJobProgress(jobId, { 
      processed: totalProcessed,
      currentTask: '✅ Complete' 
    });
    jobManager.addJobLog(jobId, `🎉 Complete: ${finalJob?.progress.success || 0} orders from ${totalProcessed} emails across ${sortedVendors.length} vendors`);

  } catch (error: any) {
    console.error('Background job error:', error);
    jobManager.updateJob(jobId, { 
      status: 'failed', 
      error: error.message || 'Unknown error' 
    });
    jobManager.addJobLog(jobId, `❌ Error: ${error.message}`);
  }
}

// Helper to process analysis result
function processAnalysisResult(
  jobId: string, 
  email: { id: string; subject: string; sender: string; body: string },
  result: any
) {
  const job = jobManager.getJob(jobId);
  if (!job) return;

  if (result.isOrder) {
    // Use only the items that were actually extracted - NO placeholders
    const items = result.items || [];
    
    // Log if no items were found (for debugging)
    if (items.length === 0) {
      console.log(`   ⚠️ No items extracted for order from ${result.supplier}`);
    }
    
    const order: ProcessedOrder = {
      id: result.emailId,
      supplier: result.supplier || extractSupplierFromSender(email.sender),
      orderDate: result.orderDate || new Date().toISOString().split('T')[0],
      totalAmount: result.totalAmount || 0,
      items: items.map((item: any, idx: number) => ({
        id: `${result.emailId}-${idx}`,
        name: item.name || 'Unknown Item',
        quantity: item.quantity || 1,
        unit: item.unit || 'ea',
        unitPrice: item.unitPrice || 0,
      })),
      confidence: result.confidence || 0.5,
    };
    
    jobManager.addJobOrder(jobId, order);
    jobManager.updateJobProgress(jobId, { success: job.progress.success + 1 });
    jobManager.addJobLog(jobId, `✅ Order: ${order.supplier} - $${order.totalAmount.toFixed(2)} (${order.items.length} items)`);
  } else {
    jobManager.updateJobProgress(jobId, { failed: job.progress.failed + 1 });
  }
}

// Middleware to require authentication
function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Start a new processing job
router.post('/start', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const accessToken = await getValidAccessToken(userId);
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Token expired, please re-authenticate' });
    }

    // Get supplier domains from request body (optional)
    const { supplierDomains } = req.body as { supplierDomains?: string[] };
    
    // Validate supplier domains if provided
    const validDomains = supplierDomains?.filter(d => 
      typeof d === 'string' && d.length > 0 && d.includes('.')
    );

    // Create job
    const job = jobManager.createJob(userId);
    
    if (validDomains && validDomains.length > 0) {
      jobManager.addJobLog(job.id, `🚀 Job created for ${validDomains.length} selected suppliers`);
    } else {
      jobManager.addJobLog(job.id, '🚀 Job created, processing all suppliers...');
    }

    // Start processing in background (don't await)
    processEmailsInBackground(job.id, userId, accessToken, validDomains);

    // Return immediately with job ID
    res.json({ 
      jobId: job.id,
      status: 'started',
      message: validDomains?.length 
        ? `Processing ${validDomains.length} suppliers in background`
        : 'Processing all suppliers in background'
    });
  } catch (error: any) {
    console.error('Failed to start job:', error);
    res.status(500).json({ error: 'Failed to start processing job' });
  }
});

// Amazon-first processing: immediately start processing Amazon emails
// This runs BEFORE supplier discovery and extracts ASINs + enriches via PA API
router.post('/start-amazon', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const accessToken = await getValidAccessToken(userId);
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Token expired, please re-authenticate' });
    }

    // Create job specifically for Amazon
    const job = jobManager.createJob(userId);
    jobManager.addJobLog(job.id, '🛒 Starting Amazon-first processing...');

    // Start Amazon processing in background
    processAmazonEmailsInBackground(job.id, userId, accessToken);

    res.json({ 
      jobId: job.id,
      status: 'started',
      message: 'Amazon processing started - ASIN extraction and enrichment'
    });
  } catch (error: any) {
    console.error('Failed to start Amazon job:', error);
    res.status(500).json({ error: 'Failed to start Amazon processing' });
  }
});

// Background processor specifically for Amazon emails with ASIN extraction
// NO AI - just extract ASINs and call Product Advertising API
async function processAmazonEmailsInBackground(
  jobId: string,
  userId: string,
  accessToken: string
) {
  const job = jobManager.getJob(jobId);
  if (!job) return;

  try {
    jobManager.updateJob(jobId, { status: 'running' });
    jobManager.addJobLog(jobId, '📧 Fetching Amazon order emails...');
    jobManager.updateJobProgress(jobId, { currentTask: 'Fetching Amazon emails...' });

    // Set up Gmail client
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Calculate 6 months ago
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const afterDate = sixMonthsAgo.toISOString().split('T')[0].replace(/-/g, '/');

    // Amazon-specific query - look for order/shipment emails from Amazon
    const query = `from:amazon.com subject:(order OR shipment OR shipped OR delivery) after:${afterDate}`;
    
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50, // Limit for faster processing
    });

    const messageIds = listResponse.data.messages || [];
    jobManager.addJobLog(jobId, `📬 Found ${messageIds.length} Amazon emails`);
    
    if (messageIds.length === 0) {
      jobManager.addJobLog(jobId, '⚠️ No Amazon order emails found');
      jobManager.updateJob(jobId, { status: 'completed' });
      return;
    }

    jobManager.updateJobProgress(jobId, { 
      total: messageIds.length,
      processed: 0,
      currentTask: 'Extracting ASINs from Amazon emails...' 
    });

    // Collect all ASINs from emails with their email context
    const allAsins: Set<string> = new Set();
    const asinEmailContext: Map<string, { subject: string; date: string; emailId: string }> = new Map();

    for (let i = 0; i < messageIds.length; i++) {
      const msg = messageIds[i];
      
      try {
        const fullMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full',
        });

        const headers = fullMsg.data.payload?.headers || [];
        const getHeader = (name: string) => 
          headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
        
        const subject = getHeader('subject');
        const date = getHeader('date');
        
        // Get email body
        let body = '';
        const payload = fullMsg.data.payload;
        
        if (payload?.body?.data) {
          body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        } else if (payload?.parts) {
          for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              body = Buffer.from(part.body.data, 'base64').toString('utf-8');
              break;
            } else if (part.mimeType === 'text/html' && part.body?.data) {
              body = Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
          }
        }

        // Extract ASINs from this email
        const asins = extractAsinsFromEmail(body, subject);
        
        if (asins.length > 0) {
          asins.forEach(asin => {
            allAsins.add(asin);
            // Keep track of which email each ASIN came from
            if (!asinEmailContext.has(asin)) {
              asinEmailContext.set(asin, { subject, date, emailId: msg.id! });
            }
          });
          jobManager.addJobLog(jobId, `📦 Found ${asins.length} ASINs in: ${subject.substring(0, 50)}...`);
        }

        // Update progress
        jobManager.updateJobProgress(jobId, {
          processed: i + 1,
          currentTask: `Scanning email ${i + 1}/${messageIds.length}... Found ${allAsins.size} ASINs`
        });

      } catch (error) {
        console.error(`Error processing Amazon email ${msg.id}:`, error);
      }
    }

    jobManager.addJobLog(jobId, `🎯 Total unique ASINs found: ${allAsins.size}`);

    // Now enrich with Amazon Product Advertising API - NO AI NEEDED
    if (allAsins.size > 0) {
      jobManager.updateJobProgress(jobId, {
        currentTask: `Calling Amazon Product Advertising API for ${allAsins.size} items...`
      });
      jobManager.addJobLog(jobId, '🛒 Calling Amazon Product Advertising API...');

      const asinArray = Array.from(allAsins);
      const enrichedData = await getAmazonItemDetails(asinArray.slice(0, 50)); // Limit to 50

      jobManager.addJobLog(jobId, `✅ Got ${enrichedData.size} products from Amazon API`);

      // Create orders directly from the enriched data - NO AI
      // Group items into a single "Amazon Products" order
      if (enrichedData.size > 0) {
        const items: ProcessedOrder['items'] = [];
        
        for (const [asin, data] of enrichedData) {
          const emailContext = asinEmailContext.get(asin);
          
          items.push({
            id: `amazon-item-${asin}`,
            name: data.ItemName || `Amazon Product ${asin}`,
            quantity: 1,
            unit: 'each',
            unitPrice: parseFloat(data.Price?.replace(/[^0-9.]/g, '') || '0'),
            asin: asin,
            amazonEnriched: {
              ASIN: data.ASIN,
              ItemName: data.ItemName,
              Price: data.Price,
              ImageURL: data.ImageURL,
              AmazonURL: data.AmazonURL,
              UnitCount: data.UnitCount,
              UPC: data.UPC,
            },
          });
          
          // Log each item found
          jobManager.addJobLog(jobId, `  🛍️ ${data.ItemName?.substring(0, 60) || asin}... $${data.Price || 'N/A'}`);
        }

        // Create a single order with all Amazon items
        const order: ProcessedOrder = {
          id: `amazon-${Date.now()}`,
          supplier: 'Amazon',
          orderDate: new Date().toISOString().split('T')[0],
          totalAmount: items.reduce((sum, item) => sum + (item.unitPrice || 0), 0),
          items: items,
          confidence: 1.0, // Direct from API, no AI guessing
        };

        jobManager.addJobOrder(jobId, order);
        jobManager.updateJobProgress(jobId, { success: items.length });
        jobManager.addJobLog(jobId, `🎉 Amazon complete: ${items.length} products enriched from Product Advertising API`);
      } else {
        jobManager.addJobLog(jobId, '⚠️ No products returned from Amazon API (check API credentials)');
      }
    } else {
      jobManager.addJobLog(jobId, '⚠️ No ASINs found in Amazon emails');
    }

    jobManager.updateJob(jobId, { status: 'completed' });
    
  } catch (error: any) {
    console.error('Amazon processing error:', error);
    jobManager.addJobLog(jobId, `❌ Error: ${error.message}`);
    jobManager.updateJob(jobId, { status: 'failed', error: error.message });
  }
}

// Get job status (for polling)
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const jobId = req.query.jobId as string;
  
  let job: Job | undefined;
  
  if (jobId) {
    job = jobManager.getJob(jobId);
  } else {
    // Get latest job for user
    job = jobManager.getJobForUser(userId);
  }
  
  if (!job) {
    return res.json({ 
      hasJob: false,
      message: 'No active job found'
    });
  }

  res.json({
    hasJob: true,
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    currentEmail: job.currentEmail,
    orders: job.orders,
    logs: job.logs.slice(0, 20), // Last 20 logs
    error: job.error,
  });
});

// Get full job results
router.get('/:jobId', requireAuth, async (req: Request, res: Response) => {
  const job = jobManager.getJob(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Verify job belongs to user
  if (job.userId !== req.session.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json(job);
});

export { router as jobsRouter };
