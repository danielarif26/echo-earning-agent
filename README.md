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
