# Local setup for danielarif26

This fork is configured as the safe V1 watcher described in the SebAI Penniless Agent setup guide.

## Already configured

- Read-only watcher runs on GitHub Actions every 30 minutes.
- Superteam listing scan is supported but stays off until `SUPERTEAM_API_KEY` is added as a repository secret.
- Base and Solana balance monitoring stays off until the PUBLIC receive-only addresses are added as repository variables `EVM_WALLET` and/or `SOL_WALLET`.
- Authored GitHub PRs are read using the repository owner's GitHub identity.
- No private key, seed phrase, spending permission, bid, submission, signup, or account credential belongs in this repository.

## Human-only activation inputs

1. Optional: approve/register a Superteam agent and add the returned API key as `SUPERTEAM_API_KEY`.
2. Optional: add PUBLIC receive-only wallet addresses as `EVM_WALLET` and/or `SOL_WALLET`.

Never put a private key, mnemonic, wallet seed, or `.env` in this repo.
