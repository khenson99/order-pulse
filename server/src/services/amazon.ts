// Amazon Product Advertising API Integration
// Uses the official Amazon PAAPI 5.0 SDK

import amazonPaapi from 'amazon-paapi';

interface AmazonItemResponse {
  ASIN: string;
  ItemName?: string;
  Price?: string;
  ImageURL?: string;
  AmazonURL?: string;
  Quantity?: string;
  Units?: string;
  UnitCount?: number;
  UnitPrice?: number;
  UPC?: string;
}

// API Configuration - loaded from environment variables
const AMAZON_API_CONFIG = {
  accessKey: process.env.AMAZON_ACCESS_KEY || '',
  secretKey: process.env.AMAZON_SECRET_KEY || '',
  partnerTag: process.env.AMAZON_PARTNER_TAG || 'arda06-20',
  partnerType: 'Associates' as const,
  marketplace: 'www.amazon.com' as const,
};

// ASIN pattern: B followed by 9 alphanumeric, or 10 digits
const ASIN_PATTERN = /\b(B0[A-Z0-9]{8}|[0-9]{10})\b/gi;

// Extract ASINs from email content
export function extractAsinsFromEmail(emailBody: string, emailSubject: string): string[] {
  const text = `${emailSubject} ${emailBody}`;
  
  // Decode HTML entities and URL encoding that might hide ASINs
  const decodedText = text
    .replace(/&#x2F;/g, '/')
    .replace(/&#47;/g, '/')
    .replace(/%2F/gi, '/')
    .replace(/&amp;/g, '&')
    .replace(/&#x3D;/g, '=')
    .replace(/%3D/gi, '=');
  
  const allMatches: string[] = [];
  
  // Pattern 1: Extract from Amazon product URLs (most reliable)
  // Handles various URL formats including encoded ones
  const urlPatterns = [
    /amazon\.com[^"'\s]*?\/dp\/([A-Z0-9]{10})/gi,
    /amazon\.com[^"'\s]*?\/gp\/product\/([A-Z0-9]{10})/gi,
    /amazon\.com[^"'\s]*?\/gp\/aw\/d\/([A-Z0-9]{10})/gi,  // Mobile URLs
    /amazon\.com[^"'\s]*?ASIN[=\/]([A-Z0-9]{10})/gi,
    /a\.co\/d\/([A-Za-z0-9]+)/gi,  // Short URLs (may need expansion)
  ];
  
  for (const pattern of urlPatterns) {
    const matches = [...decodedText.matchAll(pattern)].map(m => m[1].toUpperCase());
    allMatches.push(...matches);
  }
  
  // Pattern 2: Extract B0-prefixed ASINs from anywhere in text
  // These are very reliable as they have a distinctive pattern
  const b0Pattern = /\b(B0[A-Z0-9]{8})\b/gi;
  const b0Matches = [...decodedText.matchAll(b0Pattern)].map(m => m[1].toUpperCase());
  allMatches.push(...b0Matches);
  
  // Pattern 3: Look for ASINs in href attributes specifically
  const hrefPattern = /href\s*=\s*["'][^"']*?\/([A-Z0-9]{10})[^"']*?["']/gi;
  const hrefMatches = [...decodedText.matchAll(hrefPattern)]
    .map(m => m[1].toUpperCase())
    .filter(asin => asin.startsWith('B0') || /^[0-9]{10}$/.test(asin) === false);
  allMatches.push(...hrefMatches);
  
  // Deduplicate
  const uniqueMatches = [...new Set(allMatches)];
  
  // Filter out false positives
  const asins = uniqueMatches.filter(asin => {
    // Must be exactly 10 characters
    if (asin.length !== 10) return false;
    
    // If all digits, it's likely a timestamp or phone number - reject
    if (/^[0-9]{10}$/.test(asin)) return false;
    
    // Must contain at least one letter (real ASINs almost always do)
    if (!/[A-Z]/.test(asin)) return false;
    
    return true;
  });
  
  console.log(`📦 Extracted ${asins.length} ASINs from email:`, asins.slice(0, 5), asins.length > 5 ? `... (${asins.length} total)` : '');
  
  return asins;
}

// Extract ASINs from Amazon product URLs
export function extractAsinFromUrl(url: string): string | null {
  // Patterns for Amazon product URLs
  const patterns = [
    /amazon\.com\/dp\/([A-Z0-9]{10})/i,
    /amazon\.com\/gp\/product\/([A-Z0-9]{10})/i,
    /amazon\.com\/.*\/dp\/([A-Z0-9]{10})/i,
    /amzn\.to\/([A-Z0-9]+)/i,  // Short links (would need redirect follow)
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

// Fetch item details from Amazon API using official PAAPI 5.0
export async function getAmazonItemDetails(asins: string[]): Promise<Map<string, AmazonItemResponse>> {
  const results = new Map<string, AmazonItemResponse>();
  
  if (asins.length === 0) {
    return results;
  }
  
  // Check if credentials are configured
  if (!AMAZON_API_CONFIG.accessKey || !AMAZON_API_CONFIG.secretKey) {
    console.warn('⚠️ Amazon API credentials not configured');
    return results;
  }
  
  try {
    console.log(`🛒 Fetching Amazon data for ${asins.length} ASINs:`, asins);
    
    // Amazon PAAPI allows max 10 items per request
    const batchSize = 10;
    
    for (let i = 0; i < asins.length; i += batchSize) {
      const batch = asins.slice(i, i + batchSize);
      
      try {
        const commonParameters = {
          AccessKey: AMAZON_API_CONFIG.accessKey,
          SecretKey: AMAZON_API_CONFIG.secretKey,
          PartnerTag: AMAZON_API_CONFIG.partnerTag,
          PartnerType: AMAZON_API_CONFIG.partnerType,
          Marketplace: AMAZON_API_CONFIG.marketplace,
        };
        
        const requestParameters = {
          ItemIds: batch,
          ItemIdType: 'ASIN' as const,
          Condition: 'New' as const,
          Resources: [
            'ItemInfo.Title',
            'ItemInfo.ProductInfo',
            'ItemInfo.ExternalIds',
            'Images.Primary.Large',
            'Offers.Listings.Price',
          ],
        };
        
        const response = await amazonPaapi.GetItems(commonParameters, requestParameters);
        
        if (response.ItemsResult?.Items) {
          for (const item of response.ItemsResult.Items) {
            const itemData: AmazonItemResponse = {
              ASIN: item.ASIN,
              ItemName: item.ItemInfo?.Title?.DisplayValue,
              Price: item.Offers?.Listings?.[0]?.Price?.DisplayAmount,
              ImageURL: item.Images?.Primary?.Large?.URL,
              AmazonURL: item.DetailPageURL,
              UnitCount: item.ItemInfo?.ProductInfo?.UnitCount?.DisplayValue,
            };
            
            // Extract UPC from ExternalIds
            const upcs = item.ItemInfo?.ExternalIds?.UPCs?.DisplayValues;
            if (upcs && upcs.length > 0) {
              itemData.UPC = upcs[0];
            }
            
            results.set(item.ASIN, itemData);
            console.log(`  ✓ ${item.ASIN}: ${itemData.ItemName?.substring(0, 50)}...`);
          }
        }
        
        // Rate limit: wait between batches
        if (i + batchSize < asins.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (batchError: any) {
        console.error(`Error fetching batch starting at ${i}:`, batchError?.message || batchError);
      }
    }
    
    console.log(`✅ Got Amazon data for ${results.size}/${asins.length} items`);
  } catch (error) {
    console.error('Amazon API fetch error:', error);
  }
  
  return results;
}

// Enrich a single item with Amazon data
export async function enrichItemWithAmazon(asin: string): Promise<AmazonItemResponse | null> {
  const results = await getAmazonItemDetails([asin]);
  return results.get(asin) || null;
}

// Batch enrich multiple items
export async function batchEnrichItems(asins: string[]): Promise<Map<string, AmazonItemResponse>> {
  // API may have rate limits, so batch in groups of 10
  const batchSize = 10;
  const allResults = new Map<string, AmazonItemResponse>();
  
  for (let i = 0; i < asins.length; i += batchSize) {
    const batch = asins.slice(i, i + batchSize);
    const results = await getAmazonItemDetails(batch);
    
    for (const [asin, data] of results) {
      allResults.set(asin, data);
    }
    
    // Rate limit: wait 1 second between batches
    if (i + batchSize < asins.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return allResults;
}

export const amazonService = {
  extractAsinsFromEmail,
  extractAsinFromUrl,
  getAmazonItemDetails,
  enrichItemWithAmazon,
  batchEnrichItems,
};
