# RaffleTime Production Architecture

## Overview

RaffleTime runs as three components:

1. **Smart Contracts** — deployed to Celo, hold all funds trustlessly
2. **House Agent** — Node.js process on a VPS, signs transactions with a hot wallet
3. **Frontend** — static site served via CDN (Vercel/Cloudflare Pages)

---

## Key Management

### Two-wallet separation

| Wallet | Purpose | Location | Holds |
|--------|---------|----------|-------|
| **Deployer/Owner** | Protocol admin (deploy contracts, register beneficiaries, suspend agents, authorize factories) | Local machine or hardware wallet | CELO for gas only |
| **Agent Hot Wallet** | Signs raffle lifecycle transactions (create, close, draw, distribute) | VPS `.env` file | Minimum cUSD for next few raffle deposits + CELO for gas |

The deployer key **never** touches the VPS. The hot wallet key **never** leaves the VPS.

### Why this is safe

The hot wallet can only:
- Create raffles (costs its own cUSD deposit)
- Call permissionless lifecycle functions (`closeRaffle`, `requestDraw`, `distributePrizes`)
- Claim its own creator deposit refunds

It **cannot**:
- Drain vault prize pools (no admin withdrawal exists)
- Redirect prizes (winners selected by VRF)
- Change beneficiaries (determined by participant votes)
- Modify protocol settings (requires deployer/owner key)

**Worst case if VPS is compromised:** attacker drains the hot wallet's cUSD balance and unclaimed deposits. Prize pools are untouched.

### Minimum balance principle

Only fund the hot wallet with enough cUSD for the next few raffle cycles. A single cycle needs roughly `calculateDeposit(targetPoolSize)` in cUSD (~$1 for a $100 target pool). Keep 5-10x that as a buffer, top up periodically from your local wallet.

### Future: multisig for protocol admin

For mainnet, move deployer/owner role to a Safe multisig so no single key controls protocol admin functions (suspend agents, authorize factories, change fee recipient, update vault implementation).

---

## Vault Security Model

RaffleVault contracts are the core trust layer. Funds flow is entirely governed by the on-chain state machine with no admin overrides.

### Fund outflows (the only ways money leaves a vault)

| Outflow | Recipient | Trigger | State required |
|---------|-----------|---------|----------------|
| Prize distribution | VRF-selected winners | `distributePrizes()` | PAYOUT |
| Beneficiary payment | Vote-winning charity | Same call | PAYOUT |
| Participant refunds | Each participant (own tickets only) | `claimRefund()` | INVALID |
| Creator deposit refund | Raffle creator via Factory | `claimDeposit()` | SETTLED or INVALID |

There is no `emergencyWithdraw`, no owner override, no admin backdoor.

### VRF: MockAnyrand vs production

**Testnet** uses MockAnyrand where anyone can call `fulfillCallback()` with arbitrary values. This is fine for testing but would let an attacker choose winners on mainnet.

**Mainnet** must use the real anyrand contract on Celo (drand beacon, tamper-proof randomness). This is a constructor argument swap in RaffleFactory — no code changes needed, just deploy with the real anyrand address instead of MockAnyrand.

---

## VPS Setup (Ubuntu on Vultr)

### 1. SSH hardening

```bash
# Create non-root user
adduser raffletime
usermod -aG sudo raffletime

# Copy SSH key to new user
mkdir -p /home/raffletime/.ssh
cp ~/.ssh/authorized_keys /home/raffletime/.ssh/
chown -R raffletime:raffletime /home/raffletime/.ssh

# Disable root login and password auth in /etc/ssh/sshd_config:
#   PermitRootLogin no
#   PasswordAuthentication no
#   PubkeyAuthentication yes
systemctl restart sshd
```

### 2. Firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh        # 22
ufw allow 80/tcp     # HTTP (certbot)
ufw allow 443/tcp    # HTTPS
ufw enable
```

Port 3000 (agent API) is NOT exposed — Nginx reverse-proxies to it.

### 3. Runtime dependencies

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
apt install -y nodejs nginx certbot python3-certbot-nginx
npm install -g pnpm
```

### 4. Private key storage

```bash
# As raffletime user
mkdir -p ~/agent
nano ~/agent/.env    # PRIVATE_KEY and contract addresses
chmod 600 ~/agent/.env
```

`chmod 600` = owner read/write only. No group, no world.

### 5. Systemd service

```ini
# /etc/systemd/system/raffletime-agent.service
[Unit]
Description=RaffleTime House Agent
After=network.target

[Service]
Type=simple
User=raffletime
WorkingDirectory=/home/raffletime/agent
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
EnvironmentFile=/home/raffletime/agent/.env

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable raffletime-agent
systemctl start raffletime-agent
journalctl -u raffletime-agent -f   # tail logs
```

Auto-restarts on crash, starts on boot.

### 6. Nginx reverse proxy + TLS

```nginx
# /etc/nginx/sites-available/raffletime
server {
    server_name agent.raffletime.io;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/raffletime /etc/nginx/sites-enabled/
certbot --nginx -d agent.raffletime.io
```

### 7. Frontend hosting

The frontend is static files — it does not belong on the VPS. Use:
- **Vercel** or **Cloudflare Pages** — free tier, global CDN, auto-deploys from git
- Point `raffletime.io` at the CDN, `agent.raffletime.io` at the VPS

---

## Deployment Sequence

### First time (testnet)

1. **Local:** `cast wallet new` — create hot wallet for the agent
2. **Local:** Fund hot wallet at https://faucet.celo.org/alfajores (CELO + cUSD)
3. **Local:** Deploy contracts with deployer key:
   ```bash
   cd packages/contracts
   PRIVATE_KEY=0xDEPLOYER_KEY forge script \
     script/DeployAlfajores.s.sol:DeployAlfajores \
     --rpc-url https://alfajores-forno.celo-testnet.org \
     --broadcast -vvvv
   ```
4. **Local:** Register beneficiary(s) via `cast send` using deployer key
5. **Local:** Fund hot wallet with cUSD for raffle deposits
6. **VPS:** Clone repo, `pnpm install`, `pnpm --filter @raffletime/agent build`
7. **VPS:** Create `.env` with hot wallet key + contract addresses
8. **VPS:** Start agent via systemd
9. **VPS/Vercel:** Deploy frontend with `VITE_*` contract address env vars

### Mainnet migration

Same sequence but:
- Replace MockAnyrand address with real anyrand contract on Celo mainnet
- Use `--rpc-url https://forno.celo.org` (mainnet RPC)
- Fund hot wallet with real cUSD (start small)
- Move deployer/owner to Safe multisig
- Set `CHAIN_ID=42220` in agent `.env`

---

## Monitoring

- `journalctl -u raffletime-agent -f` — live agent logs
- Agent health endpoint: `https://agent.raffletime.io/api/health`
- On-chain: watch `RaffleCreated`, `StateTransition` events via block explorer
- Set up UptimeRobot or similar on the health endpoint
- Monitor hot wallet balance — alert if it drops below 2x deposit cost
