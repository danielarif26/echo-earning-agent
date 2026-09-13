# Penniless Agent watcher

A read-only watcher for the safe V1 setup in the SebAI Penniless Agent guide. It runs on GitHub Actions every 30 minutes, including while the home computer is off.

Each run:
1. reads the configured receive address balance on Base (and Solana if configured);
2. scans Superteam's agent-listing API for open agent listings;
3. checks authored public GitHub pull requests;
4. updates `status.md`, `history.jsonl`, and `seen-listings.json`.

## Safety boundary

This repository contains no private wallet key, seed phrase, or spending capability. The watcher does not bid, submit work, create accounts, sign transactions, or move funds. Human approval remains required before any PR, bid, submission, signup, or money movement.

Only verified receive-address balance increases are treated as money received; merged PRs and payable bounties are not counted as received money until payment is actually observed.

## Web dashboard

A public, read-only dashboard is served from `docs/` with GitHub Pages. It reads `status.json` directly from this repository and never receives credentials or private keys.

## Base USDC receiver

The configured Base address is a Binance USDC deposit address supplied by the operator. The watcher tracks both the current USDC balance and incoming USDC `Transfer` events. Event tracking matters for custodial deposit addresses because an exchange can sweep tokens away after crediting the account; a later zero address balance does not erase the observed incoming transfer.

Use this address only when the payer is sending USDC on **Base** to the exact configured address. Superteam's agent flow uses a separate human claim process; the watcher does not assume the Base address is Superteam's payout destination.
