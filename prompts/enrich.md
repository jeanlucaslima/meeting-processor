You are given the full transcript of a meeting on stdin. Every line starts with the time it was said, as [HH:MM:SS].

Meeting: {title}
Recorded: {recorded_at}
Duration: {duration}
Detected language: {language}

Write meeting notes in Markdown, in the same language as the transcript. Output only the notes, no preamble. Use this structure:

# {title}

## TL;DR
2–4 sentences: what the meeting was about and what came out of it.

## Participants
People who spoke or were mentioned, with their apparent role. Say "unknown" rather than guessing.

## Key points
Bulleted, grouped by topic, each with the timestamp where it was discussed, e.g. `[00:12:30]`.

## Decisions
What was agreed, with timestamp. Write "None recorded." if there were none.

## Action items
A checklist: `- [ ] Owner — task (due date if stated) [timestamp]`. Use "Unassigned" when no owner was named.

## Open questions & risks
Unresolved issues, disagreements, blockers.

## Glossary
Names, products, acronyms or jargon a newcomer would need, only if any appear.

Cite the exact line's timestamp for every point, decision and action item, as `[HH:MM:SS]`. Never round to the minute.

Rules: be faithful to the transcript, do not invent facts, owners or dates. Transcription errors are likely on names and jargon; correct them only when the right spelling is obvious from context.
