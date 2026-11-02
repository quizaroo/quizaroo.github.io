# Open Flashcards

**Use it here: <https://hazymat.github.io/open-flashcards/>**

A simple, open-source flashcards app that runs entirely in your browser. No account, no tracking, no adverts, nothing to install. Works for any language.

- Create, edit, duplicate and delete sets; paste a whole list at once (term, Tab, definition)
- Study by tapping to flip and swiping: **right = know**, **left = still learning**, then re-study the ones you missed
- Choose which side shows first (globally or per set), shuffle on/off, swap all sides of a set
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

Import also accepts a bare array of sets, or a single set object. If a set's `id` already exists and its cards differ, the app asks whether to merge, replace, keep both or skip. Identical sets are skipped. An optional `"front": "definition"` on a set makes the definition show first.

MIT licensed.
