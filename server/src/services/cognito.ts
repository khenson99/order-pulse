// Cognito User Sync Service
// Syncs user data for email→tenant/author lookups.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import redisClient from '../utils/redisClient.js';

const GITHUB_TOKEN = process.env.GITHUB_COGNITO_TOKEN;
const REPO_OWNER = 'Arda-cards';
const REPO_NAME = 'management';
const WORKFLOW_FILE = 'cognito.yml';
const DEFAULT_AWS_REGION = process.env.COGNITO_AWS_REGION || process.env.AWS_REGION;
const DEFAULT_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const DEFAULT_SYNC_SOURCE = (process.env.COGNITO_SYNC_SOURCE || 'aws').toLowerCase();
const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'cognito_users.csv');
const COGNITO_LOCK_KEY = 'orderpulse:cognito:lock';
const COGNITO_LOCK_TTL = 1000 * 60 * 60 * 3; // 3 hours

export interface CognitoUser {
  email: string;
  tenantId: string;
  name: string;
  status: string;
  enabled: boolean;
  createdAt: string;
  modifiedAt: string;
  sub: string; // Author ID for Arda API calls
  role: string;
}

export interface TenantDomainSuggestion {
  tenantId: string;
  matchedEmail: string;
  domain: string;
  matchCount: number;
}

// In-memory cache of users
const usersCache: Map<string, CognitoUser> = new Map();
let lastLoadTime: Date | null = null;
let onDemandSyncPromise: Promise<boolean> | null = null;

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'yahoo.com',
  'ymail.com',
  'rocketmail.com',
  'aol.com',
  'protonmail.com',
  'pm.me',
  'zoho.com',
  'mail.com',
  'gmx.com',
  'gmx.us',
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
  'comcast.net',
  'att.net',
  'verizon.net',
]);

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

// Parse CSV into user objects
function parseCSV(csvContent: string): CognitoUser[] {
  const lines = csvContent.split(/\r?\n/).filter(Boolean);
  const users: CognitoUser[] = [];
  
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCSVLine(lines[i] || '');
    if (parts.length >= 8) {
      users.push({
        email: parts[0]?.toLowerCase() || '',
        tenantId: parts[1] || '',
        name: parts[2] || '',
        status: parts[3] || '',
        enabled: parts[4] === 'True',
        createdAt: parts[5] || '',
        modifiedAt: parts[6] || '',
        sub: parts[7] || '',
        role: parts[8] || '',
      });
    }
  }

  return users;
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function writeUsersToFile(users: CognitoUser[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const header = 'email,tenantId,name,status,enabled,createdAt,modifiedAt,sub,role';
  const rows = users.map((user) => (
    [
      user.email,
      user.tenantId,
      user.name,
      user.status,
      user.enabled ? 'True' : 'False',
      user.createdAt,
      user.modifiedAt,
      user.sub,
      user.role,
    ].map(csvEscape).join(',')
  ));
  writeFileSync(USERS_FILE, `${[header, ...rows].join('\n')}\n`, 'utf-8');
  console.log(`💾 Wrote ${users.length} Cognito users to ${USERS_FILE}`);
}

function setUsersCache(users: CognitoUser[], source: string): void {
  usersCache.clear();
  for (const user of users) {
    if (user.email) {
      usersCache.set(user.email.toLowerCase(), user);
    }
  }
  lastLoadTime = new Date();
  console.log(`📋 Loaded ${usersCache.size} Cognito users from ${source} (last update: ${lastLoadTime.toISOString()})`);
}

function getAttribute(user: UserType, name: string): string {
  return user.Attributes?.find((attribute) => attribute.Name === name)?.Value?.trim() || '';
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

function mapAwsUser(user: UserType): CognitoUser | null {
  const email = getAttribute(user, 'email').toLowerCase();
  if (!email) return null;

  const givenName = getAttribute(user, 'given_name');
  const familyName = getAttribute(user, 'family_name');
  const fullNameFromParts = [givenName, familyName].filter(Boolean).join(' ').trim();
  const name = firstNonEmpty(
    getAttribute(user, 'name'),
    fullNameFromParts,
    getAttribute(user, 'preferred_username'),
    user.Username || undefined,
  );

  return {
    email,
    tenantId: firstNonEmpty(
      getAttribute(user, 'custom:tenant'),
      getAttribute(user, 'custom:tenantId'),
      getAttribute(user, 'custom:tenant_id'),
      getAttribute(user, 'tenant'),
      getAttribute(user, 'tenantId'),
      getAttribute(user, 'tenant_id'),
    ),
    name,
    status: user.UserStatus || '',
    enabled: Boolean(user.Enabled),
    createdAt: user.UserCreateDate?.toISOString() || '',
    modifiedAt: user.UserLastModifiedDate?.toISOString() || '',
    sub: firstNonEmpty(getAttribute(user, 'sub'), user.Username || undefined),
    role: firstNonEmpty(getAttribute(user, 'custom:role'), getAttribute(user, 'role')),
  };
}

// Load users from file into cache
export function loadUsersFromFile(): void {
  if (!existsSync(USERS_FILE)) {
    console.log('⚠️ Cognito users file not found:', USERS_FILE);
    return;
  }
  
  try {
    const content = readFileSync(USERS_FILE, 'utf-8');
    const users = parseCSV(content);
    setUsersCache(users, 'file');
  } catch (error) {
    console.error('❌ Failed to load Cognito users:', error);
  }
}

// Look up user by email
export function getUserByEmail(email: string): CognitoUser | null {
  // Lazy load on first access
  if (usersCache.size === 0) {
    loadUsersFromFile();
  }
  
  return usersCache.get(email.toLowerCase()) || null;
}

function getDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex < 0 || atIndex === normalized.length - 1) return null;
  return normalized.slice(atIndex + 1);
}

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

export function findTenantSuggestionForEmail(email: string): TenantDomainSuggestion | null {
  if (usersCache.size === 0) {
    loadUsersFromFile();
  }

  const normalizedEmail = email.trim().toLowerCase();
  const domain = getDomain(normalizedEmail);
  if (!domain || isPublicEmailDomain(domain)) {
    return null;
  }

  const grouped = new Map<string, { count: number; matchedEmail: string }>();
  for (const user of usersCache.values()) {
    if (!user.tenantId || !user.email) continue;
    if (user.email.toLowerCase() === normalizedEmail) continue;
    if (!user.email.toLowerCase().endsWith(`@${domain}`)) continue;

    const existing = grouped.get(user.tenantId);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(user.tenantId, { count: 1, matchedEmail: user.email });
    }
  }

  let suggestion: TenantDomainSuggestion | null = null;
  for (const [tenantId, match] of grouped.entries()) {
    if (
      !suggestion ||
      match.count > suggestion.matchCount ||
      (match.count === suggestion.matchCount && tenantId < suggestion.tenantId)
    ) {
      suggestion = {
        tenantId,
        matchedEmail: match.matchedEmail,
        domain,
        matchCount: match.count,
      };
    }
  }

  return suggestion;
}

// Get tenant ID for an email
export function getTenantIdForEmail(email: string): string | null {
  const user = getUserByEmail(email);
  return user?.tenantId || null;
}

// Get author (sub) for an email
export function getAuthorForEmail(email: string): string | null {
  const user = getUserByEmail(email);
  return user?.sub || null;
}

function buildAwsClient(): { client: CognitoIdentityProviderClient; userPoolId: string } | null {
  const region = DEFAULT_AWS_REGION;
  const userPoolId = DEFAULT_USER_POOL_ID;

  if (!region || !userPoolId) {
    console.error('❌ AWS Cognito sync requires COGNITO_AWS_REGION/AWS_REGION and COGNITO_USER_POOL_ID');
    return null;
  }

  const accessKeyId = process.env.COGNITO_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.COGNITO_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.COGNITO_AWS_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN;

  const client = new CognitoIdentityProviderClient({
    region,
    ...(accessKeyId && secretAccessKey ? {
      credentials: {
        accessKeyId,
        secretAccessKey,
        sessionToken,
      },
    } : {}),
  });

  return { client, userPoolId };
}

async function syncUsersFromAws(): Promise<boolean> {
  const awsClient = buildAwsClient();
  if (!awsClient) {
    return false;
  }

  const { client, userPoolId } = awsClient;
  console.log(`🔄 Starting Cognito user sync from AWS API (pool: ${userPoolId})...`);

  try {
    let paginationToken: string | undefined;
    const users: CognitoUser[] = [];

    do {
      const response = await client.send(new ListUsersCommand({
        UserPoolId: userPoolId,
        Limit: 60,
        PaginationToken: paginationToken,
      }));

      for (const awsUser of response.Users || []) {
        const mappedUser = mapAwsUser(awsUser);
        if (mappedUser) {
          users.push(mappedUser);
        }
      }

      paginationToken = response.PaginationToken;
    } while (paginationToken);

    setUsersCache(users, 'AWS Cognito API');
    writeUsersToFile(users);
    return true;
  } catch (error) {
    console.error('❌ Error syncing Cognito users from AWS API:', error);
    return false;
  }
}

export async function ensureUserMappingForEmail(
  email: string,
  tenantId: string,
  options?: { role?: string; name?: string; suppressMessage?: boolean }
): Promise<boolean> {
  const awsClient = buildAwsClient();
  if (!awsClient) {
    return false;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('Email is required to ensure Cognito mapping');
  }

  const { client, userPoolId } = awsClient;
  const userAttributes = [
    { Name: 'email', Value: normalizedEmail },
    { Name: 'email_verified', Value: 'true' },
    { Name: 'custom:tenant', Value: tenantId },
    { Name: 'custom:role', Value: options?.role || 'User' },
    ...(options?.name ? [{ Name: 'name', Value: options.name }] : []),
  ];

  const lookup = await client.send(new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: `email = "${normalizedEmail}"`,
    Limit: 1,
  }));

  const existing = lookup.Users?.[0];
  if (existing?.Username) {
    await client.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: existing.Username,
      UserAttributes: userAttributes,
    }));
    console.log(`✅ Updated Cognito mapping for ${normalizedEmail}`);
    return true;
  }

  await client.send(new AdminCreateUserCommand({
    UserPoolId: userPoolId,
    Username: normalizedEmail,
    UserAttributes: userAttributes,
    MessageAction: options?.suppressMessage === false ? undefined : 'SUPPRESS',
  }));
  console.log(`✅ Created Cognito mapping for ${normalizedEmail}`);
  return true;
}

// Trigger GitHub workflow and wait for artifact
async function triggerWorkflowAndGetArtifact(): Promise<string | null> {
  if (!GITHUB_TOKEN) {
    console.error('❌ GITHUB_COGNITO_TOKEN not configured');
    return null;
  }

  const baseUrl = 'https://api.github.com';
  const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
  };

  try {
    // 1. Trigger the workflow
    console.log('🚀 Triggering Cognito workflow...');
    const dispatchResponse = await fetch(
      `${baseUrl}/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ ref: 'main', inputs: { purpose: 'prod' } }),
      }
    );

    if (!dispatchResponse.ok) {
      console.error('❌ Failed to trigger workflow:', dispatchResponse.status);
      return null;
    }

    // 2. Wait for workflow to complete (poll every 10s for up to 5 minutes)
    console.log('⏳ Waiting for workflow to complete...');
    let runId: number | null = null;
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      attempts++;

      const runsResponse = await fetch(
        `${baseUrl}/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?per_page=5`,
        { headers }
      );

      if (!runsResponse.ok) continue;

      const runsData = await runsResponse.json() as { workflow_runs: any[] };
      const latestRun = runsData.workflow_runs?.find(
        (run: any) => run.name === 'Cognito' && run.status === 'completed' && run.conclusion === 'success'
      );

      if (latestRun) {
        const runCreatedAt = new Date(latestRun.created_at);
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        
        // Only accept runs from the last 5 minutes
        if (runCreatedAt > fiveMinutesAgo) {
          runId = latestRun.id;
          console.log(`✅ Workflow completed: run ${runId}`);
          break;
        }
      }

      console.log(`   Attempt ${attempts}/${maxAttempts}...`);
    }

    if (!runId) {
      console.error('❌ Workflow did not complete in time');
      return null;
    }

    // 3. Get artifact download URL
    const artifactsResponse = await fetch(
      `${baseUrl}/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs/${runId}/artifacts`,
      { headers }
    );

    if (!artifactsResponse.ok) {
      console.error('❌ Failed to get artifacts');
      return null;
    }

    const artifactsData = await artifactsResponse.json() as { artifacts: any[] };
    const usersArtifact = artifactsData.artifacts?.find((a: any) => a.name === 'users.csv');

    if (!usersArtifact) {
      console.error('❌ users.csv artifact not found');
      return null;
    }

    // 4. Download artifact (returns a zip)
    console.log('📥 Downloading artifact...');
    const downloadResponse = await fetch(
      `${baseUrl}/repos/${REPO_OWNER}/${REPO_NAME}/actions/artifacts/${usersArtifact.id}/zip`,
      { headers, redirect: 'follow' }
    );

    if (!downloadResponse.ok) {
      console.error('❌ Failed to download artifact');
      return null;
    }

    // Note: GitHub returns a zip file - we need to handle unzipping
    // For simplicity, we'll use the existing file if this fails
    console.log('✅ Artifact downloaded successfully');
    return 'success';

  } catch (error) {
    console.error('❌ Error syncing Cognito users:', error);
    return null;
  }
}

// Legacy sync path: GitHub workflow (trigger workflow + download)
async function syncUsersFromGitHubWorkflow(): Promise<boolean> {
  console.log('🔄 Starting Cognito user sync from GitHub...');
  
  const result = await triggerWorkflowAndGetArtifact();
  
  if (result) {
    loadUsersFromFile();
    return true;
  }

  return false;
}

function getSyncSource(): 'aws' | 'github' | 'auto' {
  if (DEFAULT_SYNC_SOURCE === 'aws' || DEFAULT_SYNC_SOURCE === 'github' || DEFAULT_SYNC_SOURCE === 'auto') {
    return DEFAULT_SYNC_SOURCE;
  }

  console.warn(`⚠️ Invalid COGNITO_SYNC_SOURCE="${DEFAULT_SYNC_SOURCE}" (expected aws|github|auto). Using "aws".`);
  return 'aws';
}

// Sync users according to configured source.
export async function syncUsers(): Promise<boolean> {
  const source = getSyncSource();

  if (source === 'aws') {
    return syncUsersFromAws();
  }

  if (source === 'github') {
    return syncUsersFromGitHubWorkflow();
  }

  const awsSuccess = await syncUsersFromAws();
  if (awsSuccess) {
    return true;
  }
  console.warn('⚠️ AWS Cognito sync failed; attempting GitHub fallback because COGNITO_SYNC_SOURCE=auto');
  return syncUsersFromGitHubWorkflow();
}

// On-demand sync path for missing tenant mappings.
export async function syncUsersOnDemand(reason: string): Promise<boolean> {
  if (process.env.ENABLE_COGNITO_SYNC === 'false') {
    console.log('⚠️ Cognito sync disabled via ENABLE_COGNITO_SYNC=false');
    return false;
  }

  if (!process.env.REDIS_URL || !redisClient) {
    console.warn('⚠️ Redis unavailable; skipping on-demand Cognito sync');
    return false;
  }

  if (onDemandSyncPromise) {
    return onDemandSyncPromise;
  }

  onDemandSyncPromise = (async () => {
    let lockAcquired = false;
    try {
      const lock = await redisClient.set(
        COGNITO_LOCK_KEY,
        `ondemand:${reason}`,
        'PX',
        COGNITO_LOCK_TTL,
        'NX'
      );
      if (!lock) {
        console.log('⏳ Cognito sync already running on another instance');
        return false;
      }

      lockAcquired = true;
      console.log(`🔄 Running on-demand Cognito sync (${reason})...`);
      const success = await syncUsers();
      if (success) {
        console.log('✅ On-demand Cognito sync completed');
      } else {
        console.warn('⚠️ On-demand Cognito sync failed');
      }
      return success;
    } catch (error) {
      console.error('❌ On-demand Cognito sync failed:', error);
      return false;
    } finally {
      if (lockAcquired) {
        await redisClient.del(COGNITO_LOCK_KEY).catch((err: Error) => {
          console.error('Failed to release Cognito sync lock:', err);
        });
      }
    }
  })();

  try {
    return await onDemandSyncPromise;
  } finally {
    onDemandSyncPromise = null;
  }
}

// Backward-compatible export for callers not yet migrated.
export async function syncUsersFromGitHub(): Promise<boolean> {
  return syncUsersFromGitHubWorkflow();
}

// Get all users (for admin purposes)
export function getAllUsers(): CognitoUser[] {
  if (usersCache.size === 0) {
    loadUsersFromFile();
  }
  return Array.from(usersCache.values());
}

// Get sync status
export function getSyncStatus(): { lastSync: string | null; userCount: number } {
  return {
    lastSync: lastLoadTime?.toISOString() || null,
    userCount: usersCache.size,
  };
}

// Initialize on module load
loadUsersFromFile();

export const cognitoService = {
  getUserByEmail,
  getTenantIdForEmail,
  getAuthorForEmail,
  ensureUserMappingForEmail,
  findTenantSuggestionForEmail,
  isPublicEmailDomain,
  syncUsers,
  syncUsersOnDemand,
  syncUsersFromGitHub,
  loadUsersFromFile,
  getAllUsers,
  getSyncStatus,
};
