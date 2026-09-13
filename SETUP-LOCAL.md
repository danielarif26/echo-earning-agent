# Local setup for danielarif26

This fork is configured as the safe V1 watcher described in the SebAI Penniless Agent setup guide.

## Active now

- Read-only watcher runs on GitHub Actions every 30 minutes.
- Superteam listing scan is active through the encrypted `SUPERTEAM_API_KEY` repository secret.
- Base USDC monitoring is active through the public `EVM_WALLET` repository variable. It checks current balance and incoming USDC transfer events so exchange sweeps cannot hide a receipt.
- Solana monitoring is optional and remains unset until a public `SOL_WALLET` address is supplied.
- Authored public GitHub PRs are read using the repository owner's GitHub identity.
- No private key, seed phrase, spending permission, bid, submission, signup credential, or wallet secret belongs in this repository.

The Superteam API key and claim code are also retained locally in macOS Keychain, not in repository files.

Never put a private key, mnemonic, wallet seed, or `.env` in this repo.

## Payout compatibility

- Direct USDC transfer on Base to the configured address: monitored.
- Superteam: human claim flow controls payout; do not assume this address is used unless the claim/payout screen explicitly asks for a Base USDC address.
- Anything requiring the receiver to sign with a private wallet key (for example SIWX/x402 spending/authentication): not supported by this Binance deposit address and not enabled in this safe V1 watcher.
