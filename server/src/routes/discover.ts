import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { getValidAccessToken } from './auth.js';

const router = Router();

// Health check for this router (no auth required)
router.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    router: 'discover',
    timestamp: new Date().toISOString() 
  });
});

// Middleware to require authentication
async function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Known supplier patterns for categorization
const SUPPLIER_PATTERNS: Record<string, { category: string; keywords: string[] }> = {
  // Industrial
  'mcmaster.com': { category: 'industrial', keywords: ['mcmaster', 'carr'] },
  'mcmaster-carr.com': { category: 'industrial', keywords: ['mcmaster', 'carr'] },
  'grainger.com': { category: 'industrial', keywords: ['grainger'] },
  'uline.com': { category: 'industrial', keywords: ['uline'] },
  'fastenal.com': { category: 'industrial', keywords: ['fastenal'] },
  'mscdirect.com': { category: 'industrial', keywords: ['msc', 'industrial'] },
  'globalindustrial.com': { category: 'industrial', keywords: ['global', 'industrial'] },
  'zoro.com': { category: 'industrial', keywords: ['zoro'] },
  'automationdirect.com': { category: 'industrial', keywords: ['automation'] },
  'misumi.com': { category: 'industrial', keywords: ['misumi'] },
  'misumiusa.com': { category: 'industrial', keywords: ['misumi'] },
  'applied.com': { category: 'industrial', keywords: ['applied'] },
  'motion.com': { category: 'industrial', keywords: ['motion'] },
  
  // Electronics
  'digikey.com': { category: 'electronics', keywords: ['digikey'] },
  'mouser.com': { category: 'electronics', keywords: ['mouser'] },
  'newark.com': { category: 'electronics', keywords: ['newark'] },
  'alliedelec.com': { category: 'electronics', keywords: ['allied'] },
  'newegg.com': { category: 'electronics', keywords: ['newegg'] },
  'bhphotovideo.com': { category: 'electronics', keywords: ['b&h', 'photo'] },
  'adorama.com': { category: 'electronics', keywords: ['adorama'] },
  'monoprice.com': { category: 'electronics', keywords: ['monoprice'] },
  'sweetwater.com': { category: 'electronics', keywords: ['sweetwater'] },
  
  // Retail
  'amazon.com': { category: 'retail', keywords: ['amazon'] },
  'costco.com': { category: 'retail', keywords: ['costco'] },
  'walmart.com': { category: 'retail', keywords: ['walmart'] },
  'target.com': { category: 'retail', keywords: ['target'] },
  'homedepot.com': { category: 'retail', keywords: ['home depot'] },
  'lowes.com': { category: 'retail', keywords: ['lowes'] },
  'bestbuy.com': { category: 'retail', keywords: ['best buy'] },
  'samsclub.com': { category: 'retail', keywords: ['sams', 'club'] },
  
  // Office
  'staples.com': { category: 'office', keywords: ['staples'] },
  'officedepot.com': { category: 'office', keywords: ['office depot'] },
  
  // Food
  'sysco.com': { category: 'food', keywords: ['sysco'] },
  'usfoods.com': { category: 'food', keywords: ['us foods'] },
  'webstaurantstore.com': { category: 'food', keywords: ['webstaurant'] },
};

// Domains to EXCLUDE (SaaS, financial, tech, etc.)
const EXCLUDED_DOMAINS = new Set([
  'google.com', 'googleapis.com', 'gmail.com',
  'cursor.com', 'cursor.sh',
  'mercury.com', 'stripe.com', 'paypal.com', 'venmo.com',
  'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'capitalone.com', 'americanexpress.com',
  'vercel.com', 'heroku.com', 'netlify.com', 'railway.app',
  'github.com', 'gitlab.com', 'bitbucket.org',
  'digitalocean.com', 'aws.amazon.com', 'cloud.google.com', 'azure.microsoft.com',
  'slack.com', 'zoom.us', 'dropbox.com', 'notion.so', 'figma.com', 'canva.com',
  'adobe.com', 'atlassian.com', 'atlassian.net', 'asana.com', 'monday.com',
  'hubspot.com', 'salesforce.com', 'zendesk.com', 'intercom.com',
  'twilio.com', 'sendgrid.com', 'mailchimp.com', 'klaviyo.com',
  'shopify.com', 'squarespace.com', 'wix.com', 'godaddy.com', 'namecheap.com', 'cloudflare.com',
  'linkedin.com', 'twitter.com', 'facebook.com', 'instagram.com',
  'youtube.com', 'spotify.com', 'netflix.com', 'hulu.com',
  'uber.com', 'lyft.com', 'doordash.com', 'grubhub.com', 'postmates.com',
  'apple.com', 'microsoft.com',
]);

// Order-related keywords for scoring
const ORDER_KEYWORDS = [
  'order', 'invoice', 'receipt', 'shipped', 'shipping', 'delivered', 'delivery',
  'confirmation', 'purchase', 'transaction', 'payment', 'thank you for your order',
];

interface SupplierData {
  domain: string;
  displayName: string;
  emails: { subject: string; date: string }[];
  score: number;
  category: string;
}

function extractDomain(email: string): string | null {
  const match = email.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (!match) return null;
  
  let domain = match[1].toLowerCase();
  
  // Normalize subdomains
  const parts = domain.split('.');
  if (parts.length > 2) {
    // Keep last two parts for most domains, but handle special cases
    const tld = parts.slice(-2).join('.');
    if (['co.uk', 'com.au', 'co.jp'].includes(tld)) {
      domain = parts.slice(-3).join('.');
    } else {
      domain = parts.slice(-2).join('.');
    }
  }
  
  return domain;
}

function extractDisplayName(fromHeader: string): string {
  // Extract name from "Name <email>" format
  const match = fromHeader.match(/^"?([^"<]+)"?\s*</);
  if (match) {
    return match[1].trim();
  }
  
  // Extract from email domain
  const domain = extractDomain(fromHeader);
  if (domain) {
    const name = domain.split('.')[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  
  return fromHeader;
}

function categorizeSupplier(domain: string): string {
  // Check known patterns
  for (const [pattern, info] of Object.entries(SUPPLIER_PATTERNS)) {
    if (domain.includes(pattern.split('.')[0])) {
      return info.category;
    }
  }
  return 'unknown';
}

function scoreSupplier(data: SupplierData): number {
  let score = 0;
  
  // Base score from email count (max 30 points)
  score += Math.min(data.emails.length * 5, 30);
  
  // Known supplier bonus (30 points)
  if (data.category !== 'unknown') {
    score += 30;
  }
  
  // Keyword matches in subjects (max 40 points)
  let keywordMatches = 0;
  for (const email of data.emails) {
    const subjectLower = email.subject.toLowerCase();
    for (const keyword of ORDER_KEYWORDS) {
      if (subjectLower.includes(keyword)) {
        keywordMatches++;
        break; // Only count once per email
      }
    }
  }
  score += Math.min(keywordMatches * 10, 40);
  
  return Math.min(score, 100);
}

// Discover suppliers from email headers
router.get('/discover-suppliers', requireAuth, async (req: Request, res: Response) => {
  try {
    console.log(`🔍 Discover request from user: ${req.session.userId}`);
    
    const accessToken = await getValidAccessToken(req.session.userId!);
    
    if (!accessToken) {
      console.error(`❌ No access token for user ${req.session.userId}`);
      return res.status(401).json({ 
        error: 'Session expired. Please log out and log back in.',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    console.log(`✅ Got access token for discover`);


    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Broad query to find potential order emails
    const query = `subject:(order OR invoice OR receipt OR shipped OR confirmation OR "thank you") newer_than:6m`;
    
    console.log(`🔍 Discovering suppliers with query: "${query}"`);

    // List messages matching query (headers only for efficiency)
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 500,
    });

    const messages = listResponse.data.messages || [];
    console.log(`📬 Found ${messages.length} potential order emails`);

    // Fetch headers only (not full body)
    const supplierMap = new Map<string, SupplierData>();

    for (const msg of messages) {
      try {
        const fullMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });

        const headers = fullMsg.data.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        const from = getHeader('From');
        const subject = getHeader('Subject');
        const date = getHeader('Date');

        const domain = extractDomain(from);
        if (!domain || EXCLUDED_DOMAINS.has(domain)) {
          continue;
        }

        if (!supplierMap.has(domain)) {
          supplierMap.set(domain, {
            domain,
            displayName: extractDisplayName(from),
            emails: [],
            score: 0,
            category: categorizeSupplier(domain),
          });
        }

        supplierMap.get(domain)!.emails.push({ subject, date });
      } catch (err) {
        // Skip individual message errors
        console.error(`Error fetching message ${msg.id}:`, err);
      }
    }

    // Calculate scores and build response
    const suppliers = Array.from(supplierMap.values())
      .map(data => {
        data.score = scoreSupplier(data);
        return {
          domain: data.domain,
          displayName: data.displayName,
          emailCount: data.emails.length,
          score: data.score,
          category: data.category as 'industrial' | 'retail' | 'office' | 'food' | 'electronics' | 'unknown',
          sampleSubjects: data.emails.slice(0, 3).map(e => e.subject),
          isRecommended: data.score >= 50 || data.category !== 'unknown',
        };
      })
      .filter(s => s.emailCount >= 1) // At least 1 email
      .sort((a, b) => b.score - a.score) // Sort by score
      .slice(0, 20); // Top 20

    console.log(`✅ Discovered ${suppliers.length} potential suppliers`);
    
    res.json({ suppliers });
  } catch (error: any) {
    console.error('Discover suppliers error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      stack: error.stack?.split('\n').slice(0, 5),
    });
    
    // Handle specific Gmail API errors
    if (error.code === 401 || error.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired, please re-authenticate' });
    }
    if (error.code === 403) {
      return res.status(403).json({ error: 'Gmail access denied. Please grant email permissions.' });
    }
    
    res.status(500).json({ 
      error: 'Failed to discover suppliers',
      details: error.message || 'Unknown error'
    });
  }
});

export { router as discoverRouter };
