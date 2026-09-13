# Local setup for danielarif26

This fork is configured as the safe V1 watcher described in the SebAI Penniless Agent setup guide.

## Active now

- Read-only watcher runs on GitHub Actions every 30 minutes.
- Superteam listing scan is active through the encrypted `SUPERTEAM_API_KEY` repository secret.
- Base USDC balance monitoring is active through the public `EVM_WALLET` repository variable.
- Solana monitoring is optional and remains unset until a public `SOL_WALLET` address is supplied.
- Authored public GitHub PRs are read using the repository owner's GitHub identity.
- No private key, seed phrase, spending permission, bid, submission, signup credential, or wallet secret belongs in this repository.

The Superteam API key and claim code are also retained locally in macOS Keychain, not in repository files.

Never put a private key, mnemonic, wallet seed, or `.env` in this repo.
