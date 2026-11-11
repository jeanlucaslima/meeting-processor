# Mobile relaunch planning

## TL;DR
Product planning meeting for the mobile app relaunch, covering three topics: onboarding redesign, payment provider, and launch date. The team agreed to ship a three-screen onboarding flow. The choice between Stripe and Adyen was deferred until Daniel prepares a 12-month cost comparison. March 15th stays a target launch date, to be confirmed after the payment decision.

## Participants
- **Daniel**: role unknown; asked to prepare the payment provider cost comparison
- **Unnamed speaker (meeting lead)**: role unknown; opened the meeting and ran the agenda
- **Unnamed speaker (design)**: apparently responsible for onboarding designs; tested the three-screen prototype and committed to final designs
- **Marketing**: mentioned, not present as a speaker; wants a March 15th launch

## Key points

**Onboarding redesign**
- The current onboarding flow has seven screens and loses about 40% of users before they finish. [00:00:12]
- A shorter three-screen version was tested last week. [00:00:18]
- Completion rose from 60% to 82% in the prototype. [00:00:22]

**Payment provider**
- The choice is between Stripe and Adyen. [00:00:44]
- Adyen has lower fees for Brazil, but integration would take about three more weeks. [00:00:46]
- Stripe could be integrated in one week. [00:00:52]
- One participant is concerned about Stripe's long-term fees. [00:00:54]
- Brazil is expected to be the biggest market next year. [00:00:57]
- The group felt the decision could not be made in this meeting. [00:01:00]

**Launch date**
- Marketing wants a March 15th launch. [00:01:16]
- March 15th is risky if Adyen is chosen, because almost no buffer would remain for testing. [00:01:18] [00:01:21]
- The launch date depends on the payment decision. [00:01:24]

## Decisions
- Ship the three-screen onboarding flow. [00:00:31]
- Defer the payment provider decision until a cost comparison is available. [00:01:00]
- Do not commit to March 15th yet. Keep it as a target and confirm it after the payment decision. [00:01:27] [00:01:31]

## Action items
- [ ] Unassigned (unnamed speaker, apparently design): finish the final onboarding designs and share them with engineering (by Thursday) [00:00:35]
- [ ] Daniel: prepare a 12-month cost comparison of Stripe vs. Adyen, including engineering time (by next Monday) [00:01:03] [00:01:09]
- [ ] Unassigned (unnamed speaker): tell marketing that March 15th is a target, pending the payment decision (today) [00:01:35]

## Open questions & risks
- Stripe or Adyen: Stripe is faster to integrate (1 week), but Adyen has lower fees in Brazil, the expected biggest market. [00:00:46] [00:00:57]
- If Adyen is chosen, the March 15th launch leaves almost no buffer for testing. [00:01:18] [00:01:21]
- The launch date is blocked on the payment provider decision. [00:01:24]

## Glossary
- **Stripe**: payment provider; integration estimated at one week.
- **Adyen**: payment provider (transcribed as "Adin" / "a Dian"); lower fees for Brazil, longer integration.
- **Onboarding**: the first-run flow new users go through in the mobile app.
