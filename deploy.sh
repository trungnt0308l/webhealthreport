#!/usr/bin/env bash
set -e

echo ""
echo "=== Website Health Report — Deploy ==="
echo ""

# 1. Check wrangler is logged in
if ! wrangler whoami &>/dev/null; then
  echo "ERROR: You are not logged in to Cloudflare."
  echo "Run: wrangler login"
  echo "Then re-run this script."
  exit 1
fi

echo "✓ Logged in as $(wrangler whoami 2>&1 | grep -E 'You are logged in|email' | head -1 | sed 's/.*email: //')"
echo ""

# 2. Create D1 database (skip if already exists)
echo "→ Creating D1 database..."
DB_OUTPUT=$(wrangler d1 create webhealthreport 2>&1) || true
# wrangler d1 create outputs: database_id = "UUID"
DB_ID=$(echo "$DB_OUTPUT" | grep 'database_id' | sed 's/.*database_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/')

if [ -z "$DB_ID" ]; then
  # Already exists — parse UUID from list output
  echo "  Database may already exist. Looking up ID..."
  DB_ID=$(wrangler d1 list 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
fi

if [ -z "$DB_ID" ]; then
  echo "ERROR: Could not determine database ID."
  echo "Run: wrangler d1 create webhealthreport"
  echo "Copy the database_id and update wrangler.toml manually."
  exit 1
fi

echo "✓ Database ID: $DB_ID"
echo ""

# 3. Update wrangler.toml with database ID
if grep -q "DATABASE_ID_PLACEHOLDER" wrangler.toml; then
  sed -i.bak "s/DATABASE_ID_PLACEHOLDER/$DB_ID/" wrangler.toml
  rm -f wrangler.toml.bak
  echo "✓ Updated wrangler.toml with database_id"
else
  echo "  wrangler.toml already has a database_id set"
fi
echo ""

# 4. Apply schema
echo "→ Applying database schema..."
wrangler d1 execute webhealthreport --file=schema.sql --remote
echo "✓ Schema applied"
echo ""

# 5. Install npm deps if needed
if [ ! -d "node_modules" ]; then
  echo "→ Installing dependencies..."
  npm install
  echo "✓ Dependencies installed"
  echo ""
fi

# 6. Build frontend
echo "→ Building frontend..."
npm run build
echo "✓ Build complete"
echo ""

# 7. Deploy to Cloudflare Pages
echo "→ Deploying to Cloudflare Pages..."
wrangler pages deploy dist --project-name=webhealthreport --branch=production
echo ""
echo "=== Deploy complete! ==="
echo ""
echo "Your site is live at: https://webhealthreport.pages.dev"
echo "(It may take a minute for DNS to propagate on first deploy.)"
echo ""
