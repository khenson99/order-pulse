import { pool } from '../db/index.js'
import redisClient from '../utils/redisClient.js'

export interface StoredUser {
  id: string
  googleId: string
  email: string
  name: string
  picture: string
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

interface StoredUserRow {
  id: string
  google_id: string
  email: string
  name: string
  picture: string
  access_token: string
  refresh_token: string
  expires_at: string | Date
}

const CACHE_KEY = (id: string) => `auth:user:${id}`

// Ensure the users table exists (idempotent) so we have durable storage for auth users
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT DEFAULT '' NOT NULL,
      picture TEXT DEFAULT '' NOT NULL,
      access_token TEXT DEFAULT '' NOT NULL,
      refresh_token TEXT DEFAULT '' NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
  `)
}

// Run table creation once on module load
void ensureTable()

async function cacheUser(user: StoredUser) {
  if (!redisClient) return
  await redisClient.set(CACHE_KEY(user.id), JSON.stringify(user))
}

export async function saveUser(user: StoredUser): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, google_id, email, name, picture, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (id) DO UPDATE SET
       google_id = EXCLUDED.google_id,
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       picture = EXCLUDED.picture,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at,
       updated_at = now()
    `,
    [
      user.id,
      user.googleId,
      user.email,
      user.name,
      user.picture,
      user.accessToken,
      user.refreshToken,
      user.expiresAt,
    ]
  )
  await cacheUser(user)
}

export async function deleteUser(userId: string): Promise<void> {
  await pool.query('DELETE FROM users WHERE id = $1', [userId])
  if (redisClient) {
    await redisClient.del(CACHE_KEY(userId))
  }
}

export async function getUserById(userId: string): Promise<StoredUser | null> {
  // Redis cache first
  if (redisClient) {
    const cached = await redisClient.get(CACHE_KEY(userId))
    if (cached) {
      const parsed = JSON.parse(cached) as StoredUser
      parsed.expiresAt = new Date(parsed.expiresAt)
      return parsed
    }
  }

  const result = await pool.query<StoredUserRow>('SELECT * FROM users WHERE id = $1', [userId])
  if (result.rowCount === 0) return null

  const row = result.rows[0]
  const user: StoredUser = {
    id: row.id,
    googleId: row.google_id,
    email: row.email,
    name: row.name,
    picture: row.picture,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: new Date(row.expires_at),
  }

  await cacheUser(user)
  return user
}

export async function getUserEmail(userId: string): Promise<string | null> {
  const user = await getUserById(userId)
  return user?.email || null
}
