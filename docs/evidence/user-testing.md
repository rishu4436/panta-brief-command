# User walkthrough protocol

How to run and record a moderated walkthrough of Brief Command with an early
user. The goal is honest evidence of time saved and of whether the AI brief
is useful and accurate. Report what happened, including negative results.
**Do not invent, merge or "clean up" participant answers.**

## Before the session

- [ ] Participant has read and agreed to the consent note below (written or recorded "yes").
- [ ] Decide whether the participant will trade real USDC. If not, stop at the review screen (step 4 of the task script).
- [ ] Note the build: deployment URL + commit.
- [ ] Recording ready (screen + audio) only if consented; otherwise written notes only.
- [ ] Participant's own wallet; the moderator never handles their keys or seed phrase.
- [ ] Usage stats: tell the participant the footer toggle exists. Ask them to leave "include my wallet" off unless they agree to link their wallet to the session.

## Consent note (read aloud or share)

> We're testing Brief Command, a prediction-market desk built on the Panta API.
> We'll ask you to do a few tasks and think aloud. With your permission we'll
> record your screen and voice; the recording is used only to improve the
> product and is deleted within 90 days, or sooner if you ask. The app stores anonymous usage
> events (a random browser id, page and action names), and any brief ratings
> you submit. It stores no IP address and no wallet address unless you switch
> that on. Market data and AI analysis can be wrong. Nothing here is
> financial advice. Any trade you make is your own decision, with your own
> wallet and funds, and you can lose the amount you trade. You can stop at
> any time without giving a reason. Do you agree to take part, and to the
> recording?

Record: participant code (P1, P2…; no names in notes), date/time IST, consent
to session (y/n), consent to recording (y/n), consent to quotes being used
publicly (y/n, anonymised).

## Warm-up questions (2 min)

1. How do you usually research a prediction market before trading? Which tools or sites do you use?
2. Roughly how long does that take for one market? (Write down their estimate verbatim.)
3. Have you used Panta before?

## Task script

Time each task from "go" to the participant saying "done" (or giving up).
Don't help unless they're stuck for more than 2 minutes; note any help given.

| # | Task (read verbatim) | Success criteria | Time | Help? | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | "Find a market that is open right now and that you'd consider looking into." | Opens a market detail page for an open market | | | |
| 2 | "Using the brief, tell me what the recent trading flow says about this market." | States flow direction / print vs size concentration correctly | | | |
| 3 | "Is there anything in the brief that worries you or seems wrong?" | Any answer; note specifics | | | |
| 4 | "Get a quote for a small amount on the side you prefer, and stop at the review screen." | Reaches the review screen with a valid quote | | | |
| 5 | (Only if they agreed to trade) "Go ahead and place it, then find it afterwards." | Trade verified; finds it in Book → Activity | | | |
| 6 | "Rate the brief using the Useful? / Accurate? buttons." | Feedback sent | | | |

## Debrief questions

Write answers verbatim where possible.

1. **Time saved:** Compared with how you usually research a market, did this take more or less time? About how much? (Their estimate, not ours.)
2. **Usefulness (1–5):** How useful was the brief for deciding whether to look closer? Why?
3. **Accuracy (1–5):** Did anything in the brief look wrong or misleading, e.g. numbers, the flow read, or concentration? What exactly?
4. Did you understand the evidence labels (Observed / Derived / Interpretation / Unknown)?
5. Was it clear which markets you can buy here and which trade on panta.market?
6. Did anything about signing or the review screen make you hesitate?
7. Would you use this again for your next trade? What would have to change?
8. Anything you expected to see that wasn't there?

## Recording checklist (after each session)

- [ ] Session sheet filled: participant code, date/time IST, build, consent flags, task table, debrief answers.
- [ ] Recording file saved as `P<n>-<YYYY-MM-DD>.<ext>` in the private evidence folder (not in this repo).
- [ ] Timestamps noted for notable moments (confusion, errors, quotes).
- [ ] Any trade attempt logged in `docs/evidence/execution-tests.md`.
- [ ] If they shared their wallet for usage stats, note it on the sheet. Otherwise do not write their wallet address anywhere.
- [ ] Deletion date for the recording set (≤ 90 days).

## Reporting

- Report per participant and in total: task success, times, debrief scores, and verbatim quotes (only with public-use consent).
- Pull app-side numbers from the admin export (`GET /api/admin/export?kind=summary`, Bearer `ADMIN_EXPORT_SECRET`). These cover all visitors, not just participants, so label them that way.
- State the sample size plainly (e.g. "3 participants") and don't generalise beyond it.
