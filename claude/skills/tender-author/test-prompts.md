# tender-author smoke prompts

Run these in Claude Code with a Tender project open. The skill should
handle each according to the design's principles (edit-first, single
clarifying question only when ambiguous, file paths cited).

For each prompt, judge:

1. Did Claude make the right kind of change to the right file?
2. Did Claude run `tender lint` after the edit?
3. Was the report concise and honest (no pleasantries, no diff dump)?
4. Did Claude avoid out-of-scope work (running build, picking fonts, drafting prose)?

## Component creation

1. "Make a callout component for warnings, with a red left border and a quoted icon."
2. "I need an inline component for stage directions — italics, gray."
3. "Add a block component called 'aside' that floats right with a colored background."

## Iterative tweaks

4. "Make the row's left column narrower."
5. "My callouts feel cramped. More padding."
6. "The margin label is too far from the body text. Tighten it."

## Content structuring

7. (With a prose-only content.md open) "Wrap each speaker paragraph as a row block. The speakers are 'Facilitator A' and 'Facilitator B'."
8. "Add a page break before each H2 heading."

## Diagnosis

9. (After deliberately introducing `<callout-warning>` instead of `<callout>` in content.md) "Run lint and tell me what's wrong."
10. (After deliberately writing `attrs:` in a .tender file) "My component isn't working — why?"

## Out-of-scope

11. "Choose a serif font for me."
    Expected: skill defers; mentions it doesn't pick fonts but will wire one up if the user names a file under `assets/fonts/`.

12. "Write me an introduction paragraph."
    Expected: skill defers; mentions it doesn't draft prose, only structures and styles existing content.
