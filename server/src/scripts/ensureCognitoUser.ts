import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';

type Args = {
  email: string;
  tenantId: string;
  role: string;
  name?: string;
  suppressMessage: boolean;
};

const USAGE = `
Usage: tsx src/scripts/ensureCognitoUser.ts --email <email> --tenant <tenantId> [--role <role>] [--name <name>] [--send-invite]

Required:
  --email    User email address (used for lookup)
  --tenant   Tenant ID to assign (custom:tenant)

Optional:
  --role     Cognito role to set (default: User)
  --name     Display name to set (name attribute)
  --send-invite  Send the Cognito invite email (default: suppressed)
`;

function parseArgs(argv: string[]): Args {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === '--send-invite') {
      args.sendInvite = true;
      continue;
    }
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${token}`);
    }
    args[key] = value;
    i += 1;
  }

  const email = String(args.email || '').trim();
  const tenantId = String(args.tenant || '').trim();
  if (!email || !tenantId) {
    throw new Error('Missing required --email or --tenant');
  }

  return {
    email,
    tenantId,
    role: String(args.role || 'User'),
    name: args.name ? String(args.name) : undefined,
    suppressMessage: !args.sendInvite,
  };
}

function buildClient(): { client: CognitoIdentityProviderClient; userPoolId: string } {
  const region = process.env.COGNITO_AWS_REGION || process.env.AWS_REGION;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;

  if (!region || !userPoolId) {
    throw new Error('COGNITO_AWS_REGION/AWS_REGION and COGNITO_USER_POOL_ID are required');
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

async function findUserByEmail(client: CognitoIdentityProviderClient, userPoolId: string, email: string) {
  const response = await client.send(new ListUsersCommand({
    UserPoolId: userPoolId,
    Filter: `email = "${email}"`,
    Limit: 1,
  }));

  const user = response.Users?.[0];
  return user ? { username: user.Username || email, attributes: user.Attributes || [] } : null;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const { client, userPoolId } = buildClient();

  const existing = await findUserByEmail(client, userPoolId, args.email);
  const attributes = [
    { Name: 'email', Value: args.email },
    { Name: 'email_verified', Value: 'true' },
    { Name: 'custom:tenant', Value: args.tenantId },
    { Name: 'custom:role', Value: args.role },
  ];

  if (args.name) {
    attributes.push({ Name: 'name', Value: args.name });
  }

  if (existing) {
    await client.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: existing.username,
      UserAttributes: attributes,
    }));
    console.log(`✅ Updated Cognito user ${args.email} (username: ${existing.username})`);
    return;
  }

  await client.send(new AdminCreateUserCommand({
    UserPoolId: userPoolId,
    Username: args.email,
    UserAttributes: attributes,
    MessageAction: args.suppressMessage ? 'SUPPRESS' : undefined,
  }));

  console.log(`✅ Created Cognito user ${args.email}`);
}

run().catch((error) => {
  console.error('❌ Failed to ensure Cognito user:', error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  console.log(USAGE.trim());
  process.exit(1);
});
