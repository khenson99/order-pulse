import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { getValidAccessToken } from './auth.js';
import { getUserById } from '../services/userStore.js';

const router = Router();

// Middleware to require authentication
async function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const user = await getUserById(userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!user.googleId) {
      return res.json({ connected: false, gmailEmail: null });
    }

    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(403).json({ error: 'Gmail authentication required', code: 'GMAIL_AUTH_REQUIRED' });
    }

    return res.json({
      connected: true,
      gmailEmail: user.googleEmail ?? user.email ?? null,
    });
  } catch (error) {
    console.error('Gmail status error:', error);
    return res.status(500).json({ error: 'Failed to check Gmail status' });
  }
});

// Fetch Gmail messages
router.get('/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const accessToken = await getValidAccessToken(req.session.userId!);
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Token expired, please re-authenticate' });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });



    // Search parameters - focus on PHYSICAL products: industrial, office supplies, food, retail
    // Excludes: SaaS, financial institutions, tech companies
    const defaultQuery = `(
      from:(
        @mcmaster.com OR @mcmaster-carr.com OR
        @uline.com OR
        @grainger.com OR
        @fastenal.com OR
        @delcity.net OR @delcity.com OR
        @mscdirect.com OR
        @globalindustrial.com OR
        @zoro.com OR
        @applied.com OR
        @motion.com OR
        @digikey.com OR
        @mouser.com OR
        @newark.com OR
        @element14.com OR
        @alliedelec.com OR
        @automationdirect.com OR
        @misumiusa.com OR @misumi.com OR
        @rs-online.com OR @rsonline.com OR @rsdelivers.com OR
        @amazon.com OR @amazon.business OR
        @costco.com OR
        @homedepot.com OR
        @lowes.com OR
        @staples.com OR
        @officedepot.com OR @officedepot.com OR
        @webstaurantstore.com OR
        @sysco.com OR
        @usfoods.com OR
        @samsclub.com OR
        @walmart.com OR
        @target.com OR
        @bestbuy.com OR
        @newegg.com OR
        @bhphotovideo.com OR
        @adorama.com OR
        @monoprice.com OR
        @cableorganizer.com OR
        @crutchfield.com OR
        @sweetwater.com
      )
      subject:(invoice OR receipt OR "order confirmation" OR "order acknowledgment" OR "thank you for your order" OR "order number" OR "shipped")
    ) OR (
      from:(@ups.com OR @fedex.com OR @dhl.com OR @usps.com) (invoice OR charges OR receipt OR "delivery")
    )
    -from:(@google.com OR @cursor.com OR @cursor.sh OR @mercury.com OR @stripe.com OR @paypal.com OR @venmo.com OR @chase.com OR @bankofamerica.com OR @wellsfargo.com OR @citi.com OR @capitalone.com OR @amex.com OR @vercel.com OR @heroku.com OR @netlify.com OR @github.com OR @gitlab.com OR @digitalocean.com OR @aws.amazon.com OR @cloud.google.com OR @azure.com OR @slack.com OR @zoom.com OR @dropbox.com OR @notion.so OR @figma.com OR @canva.com OR @adobe.com OR @atlassian.com OR @jira.com OR @asana.com OR @monday.com OR @hubspot.com OR @salesforce.com OR @zendesk.com OR @intercom.com OR @twilio.com OR @sendgrid.com OR @mailchimp.com OR @klaviyo.com OR @shopify.com OR @squarespace.com OR @wix.com OR @godaddy.com OR @namecheap.com OR @cloudflare.com)`;
    const baseQuery = req.query.q as string || defaultQuery;
    const query = `${baseQuery} newer_than:6m`;
    const maxResults = parseInt(req.query.maxResults as string) || 500; // Increased default

    console.log(`📧 Searching Gmail with query: "${query}" (max: ${maxResults})`);

    // List messages matching query
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messages = listResponse.data.messages || [];
    console.log(`📬 Found ${messages.length} messages matching query`);


    // Fetch full message details
    const fullMessages = await Promise.all(
      messages.map(async (msg) => {
        const fullMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full',
        });
        
        const headers = fullMsg.data.payload?.headers || [];
        const getHeader = (name: string) => 
          headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        // Extract body
        let body = '';
        const parts = fullMsg.data.payload?.parts || [];
        
        if (fullMsg.data.payload?.body?.data) {
          body = Buffer.from(fullMsg.data.payload.body.data, 'base64').toString('utf-8');
        } else {
          for (const part of parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              body = Buffer.from(part.body.data, 'base64').toString('utf-8');
              break;
            } else if (part.mimeType === 'text/html' && part.body?.data) {
              body = Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
          }
        }

        return {
          id: msg.id,
          subject: getHeader('Subject'),
          sender: getHeader('From'),
          date: getHeader('Date'),
          snippet: fullMsg.data.snippet || '',
          body,
        };
      })
    );

    res.json({ 
      messages: fullMessages,
      total: listResponse.data.resultSizeEstimate || messages.length,
    });
  } catch (error: any) {
    console.error('Gmail fetch error:', error);
    
    if (error.code === 401) {
      return res.status(401).json({ error: 'Token expired, please re-authenticate' });
    }
    
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// Send email
router.post('/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const { to, subject, body } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
    }

    const accessToken = await getValidAccessToken(req.session.userId!);
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Token expired, please re-authenticate' });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Create email
    const emailLines = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      body,
    ];
    const email = emailLines.join('\r\n');
    const encodedEmail = Buffer.from(email).toString('base64url');

    // Send email
    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail,
      },
    });

    res.json({ success: true, messageId: result.data.id });
  } catch (error: any) {
    console.error('Gmail send error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

export { router as gmailRouter };
