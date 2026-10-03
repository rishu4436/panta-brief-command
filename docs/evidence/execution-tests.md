# End-to-end execution test log

A template for recording real mainnet test trades made through Brief Command.
Fill in one block per attempt, **including failed and abandoned attempts**.
Copy values from the app's execution log, the wallet, Solscan and Panta's
responses; do not round, estimate or fill in anything that wasn't observed.
Leave a field as `—` when it wasn't captured.

> Times in IST. Amounts in USDC as shown in the quote. Never paste private
> keys, seed phrases or API keys here. Wallet addresses only for wallets the
> tester owns and agreed to publish.

## Environment

| Field | Value |
| --- | --- |
| App URL | https://briefcommand.vercel.app |
| Commit / deployment | |
| Wallet app + version | |
| Browser + OS | |
| RPC (dedicated or public fallback) | |
| Tester | |

## Attempt template

Copy this block for each attempt.

```text
### Attempt N — <date> <time> IST

Market id:                 
Market title (as shown):   
Phase / lifecycle shown:   (Primary · open / …)
Side / amount (USDC):      
Slippage (bps):            

1. Quote
   quoteId:                
   shares / avgPrice / fee:
   Quote received at:      
2. Build + pre-sign check
   Result:                 (passed / blocked: <reason shown>)
3. Wallet
   Approved / rejected:    
   Wallet prompt matched review screen? (fee payer, programs, amount): yes / no — notes:
4. Broadcast + confirm
   Signature:              
   Solscan link:           https://solscan.io/tx/<signature>
   Confirmed at:           
5. Panta submit / verify
   orderId:                
   Verify status sequence: (e.g. submitted → confirmed)
   Time to final status:   
6. Attribution
   POST /trades/ status:   (processed / pending / failed)
   Seen in Activity ledger: yes / no — time:
7. Book
   Position visible:       yes / no — shares shown:

Outcome:        success / failed at step _ / abandoned at step _
Error text (verbatim, if any):
Screenshot paths:
Notes:
```

## Summary table

Update after each attempt; every row must link to an attempt block above.

| # | Date (IST) | Market | Side | USDC | Furthest step reached | Outcome | Signature |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |

## Checks to run at least once

- [ ] Rejecting the signature in the wallet shows "Declined in wallet · nothing sent" and no transaction is broadcast.
- [ ] Letting a quote expire blocks signing ("Quote expired").
- [ ] A secondary-phase market cannot be bought from the ticket.
- [ ] A verified trade appears in Book → Activity with the attribution state Panta reports.
- [ ] A claim (if a position resolves) builds, signs and appears in Activity.
