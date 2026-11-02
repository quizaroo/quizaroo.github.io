# Open Flashcards

**Use it here: <https://hazymat.github.io/open-flashcards/>**

A simple, open-source flashcards app that runs entirely in your browser. No account, no tracking, no adverts, nothing to install. Works for any language.

- Home shows what you studied and opened recently; Your Library lists every set
- Create, edit, duplicate and delete sets. Tab moves from term to definition to the next term, and new rows appear as you type. You can also paste a whole list at once (term, Tab, definition)
- Sets can have a description, a created date and a colour, and the app records when you last studied them
- Learning modes: view all vocab, learn from scratch, revise, flashcards, type the answer, multiple choice, true or false, unscramble, listen and type, test, spin the wheel, match pairs, memory and speed round
- The app remembers how well you know each card and brings the hard ones back sooner, with a longer gap each time you get one right
- Switch between term first, definition first or mixed inside any mode, and swap all sides of a set
- Import and export single sets or everything as JSON
- Your sets are stored in your browser (localStorage). Export regularly if you want a backup.
- A browser with nothing saved starts with the demo sets from `demo-sets.json`. "Load demo sets" adds any that are missing and never changes your existing sets.

Add it to your phone's home screen from the browser's Share menu to use it like an app.

## File format

```json
{
  "format": "open-flashcards",
  "version": 1,
  "sets": [
    {"id": "abc123", "title": "Кольори", "cards": [{"term": "білий", "definition": "white"}]}
  ]
}
```

Import also accepts a bare array of sets, or a single set object. If a set's `id` already exists and its cards differ, the app asks whether to merge, replace, keep both or skip. Identical sets are skipped. Optional fields on a set: `"description"`, `"created"` (`YYYY-MM-DD`), `"colour"` (`rose`, `coral`, `peach`, `butter`, `lime`, `mint`, `teal`, `sky`, `periwinkle`, `lavender`, `orchid` or `sand`), `"last_studied"` and `"last_opened"` (milliseconds since 1970), `"front"` (`definition` or `mixed`) for which side shows first, plus `"progress"` and `"best_speed"`, which the app writes to record how well you know each card.

MIT licensed.
