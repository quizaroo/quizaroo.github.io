# Open Flashcards

**Use it here: <https://hazymat.github.io/open-flashcards/>**

A simple, open-source flashcards app that runs entirely in your browser. No account, no tracking, no adverts, nothing to install. Works for any language.

- Home shows what you studied and opened recently; Your Library lists every set
- Create, edit, duplicate and delete sets. Tab moves from term to definition to the next term, and new rows appear as you type. You can also paste a whole list at once (term, Tab, definition)
- Sets can have a description, a created date and a colour, and the app records when you last studied them
- Study by tapping to flip and swiping: **right = know**, **left = still learning**, then re-study the ones you missed
- Switch which side shows first while studying, shuffle on/off, swap all sides of a set
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

Import also accepts a bare array of sets, or a single set object. If a set's `id` already exists and its cards differ, the app asks whether to merge, replace, keep both or skip. Identical sets are skipped. Optional fields on a set: `"description"`, `"created"` (`YYYY-MM-DD`), `"colour"` (`rose`, `coral`, `peach`, `butter`, `lime`, `mint`, `teal`, `sky`, `periwinkle`, `lavender`, `orchid` or `sand`), `"last_studied"` and `"last_opened"` (milliseconds since 1970), and `"front": "definition"` to show the definition first.

MIT licensed.
