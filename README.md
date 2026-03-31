# clashmate

A Clash of Clans Discord bot adapted from [clashperk](https://github.com/clashperk/clashperk).

**What's different from clashperk:**
- ✅ All commands free — no Patreon gating
- ✅ Single-process — no sharding or Redis required
- ✅ MongoDB Atlas only — no Elasticsearch, ClickHouse, or Redis
- ✅ English only — no i18n overhead
- ✅ No Sentry, PostHog, or Mixpanel

**Commands included:** clan/war stats, player stats, CWL, rosters & lineup, legend league, reminders & scheduled posts.

---

## Prerequisites

- Node.js 20+
- A [Discord bot](https://discord.com/developers/applications) with these intents enabled: `Guilds`, `GuildMembers`, `GuildWebhooks`, `GuildMessages`
- [MongoDB Atlas](https://www.mongodb.com/atlas) free tier cluster
- [Clash of Clans API](https://developer.clashofclans.com) key(s) with your **MonkeyBytes static IP** whitelisted

---

## Setup

### 1. Clone & install
```bash
git clone https://github.com/yourname/clashmate.git
cd clashmate
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your tokens, MongoDB URI, and CoC API keys
```

### 3. Register slash commands
```bash
npm run deploy
```
This registers all slash commands with Discord. Run once, or again whenever you add commands.

### 4. Build & start
```bash
npm run build
npm start
```

---

## MonkeyBytes Deployment

### Docker (recommended)
```bash
# Build image
docker build -t clashmate .

# Run with your .env file
docker compose up -d

# View logs
docker compose logs -f
```

### Manual (PM2)
```bash
npm install -g pm2
npm run build
pm2 start dist/src/index.js --name clashmate
pm2 save
pm2 startup
```

### Health check
The bot exposes a health check endpoint at `http://localhost:8070` (configurable via `PORT` env var). Returns `200` when ready, `503` while starting.

---

## Clash of Clans API Keys

Your MonkeyBytes server has a **static IP**. Add it to each API key you create at [developer.clashofclans.com](https://developer.clashofclans.com).

For higher throughput, create multiple keys (max 10 per account) and add all of them comma-separated in `CLASH_OF_CLANS_API_KEYS`.

---

## MongoDB Atlas

1. Create a free M0 cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a database user with read/write access
3. Whitelist `0.0.0.0/0` or your MonkeyBytes static IP
4. Copy the connection string into `MONGODB_URL` in your `.env`

The bot will automatically create all required collections and indexes on first start.

---

## License

MIT — based on [clashperk](https://github.com/clashperk/clashperk) (MIT).
