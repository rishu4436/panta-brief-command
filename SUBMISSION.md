# Brief Command — Submission Checklist

## Required links

- [x] **Repository:** <https://github.com/rishu4436/panta-brief-command>
- [ ] **Live demo:** not deployed yet. Current run target is local only: <http://localhost:3000>. Replace this line with the real public URL after deployment; do not submit localhost as the demo URL.
- [x] **Superteam Earn listing:** <https://superteam.fun/earn/listing/panta-api-side-track>
- [ ] **Official Colosseum project:** create/update the Crypto World’s Fair entry and select/identify the Panta API Sidetrack.

## Judge assets

- [x] Demo script: [`DEMO.md`](./DEMO.md)
- [ ] Final demo video recorded and uploaded.
- [ ] Verify the final video duration/format against both forms.
- [ ] Re-capture and commit a final screenshot set from the deployed build. Current local candidates:
  - `screenshots/judge/landing-immersive-hero.png`
  - `screenshots/judge/landing-immersive-path.png`
  - `screenshots/judge/desk-cold-catalog.png`
  - `screenshots/judge/desk-cold-tape.png`
  - `screenshots/judge/market.png`
  - `screenshots/judge/execute.png`
  - `screenshots/judge/book.png`
  - `screenshots/judge/wallet-modal-p5.png`

> The `screenshots/` directory is currently local/untracked. Select fresh captures and commit only the final set before relying on these paths in a submission.

## Security and transaction claims

- [x] `PANTA_API_KEY` is server-only and `.env.local` is ignored; only placeholder values belong in `.env.example`.
- [x] No API key or wallet secret is committed to the repository.
- [x] Wallet is never custodied: Phantom/Solflare signs locally; Brief Command does not receive private keys or seed phrases.
- [x] Do not claim a completed trade unless a real signature was broadcast and attributed.

## Final dual-submit pass

- [ ] Deploy and smoke-test `/`, `/desk`, one `/markets/[marketId]`, `/execute`, and `/book` on the public URL.
- [ ] Confirm a titled/priced demo market shortly before recording; keep empty states as fallback truth.
- [ ] If demonstrating a live fill, fund a dedicated low-value demo wallet and verify the attributed activity row.
- [ ] Submit to **Colosseum Crypto World’s Fair / Panta API Sidetrack**.
- [ ] Submit separately to **Superteam Earn / Panta API Side Track**.
- [ ] Register every team member on Colosseum and save confirmation/receipt links for both submissions.

**Deadline:** 13 Oct 2026, 06:59 UTC (**12:29 PM IST**). Aim to finish deployment, video, and both forms before the final day.
