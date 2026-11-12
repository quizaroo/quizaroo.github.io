# Quizaroo

**Use it here: <https://quizaroo.github.io/>**

A simple, open-source flashcards app that runs in your browser. No tracking, no adverts, nothing to install, and no account unless you want your devices to sync. Works for any language.

- Home shows what you studied and opened recently; Your Library lists every set
- Create, edit, duplicate and delete sets. Tab moves from term to definition to the next term, and new rows appear as you type. You can also paste a whole list at once (term, Tab, definition)
- The eye button chooses a view mode, Dawn or Dusk, and a Lined or Plain style
- Press and hold to rearrange the mode tiles on a set, or the cards in the set editor. In the editor and Your Library, hold and let go to select items, then move or delete them together. Moving sets saves a Custom sort
- Each set has a trophy shelf: finish a round in any mode to win a reward
- Sets can have a description, a created date and a colour, and the app records when you last studied them
- Learning modes: view all vocab, learn from scratch, revise, flashcards, type the answer, multiple choice, true or false, unscramble, listen and type, test, spin the wheel, match pairs, memory and speed round
- Flashcards can keep score or just let you browse back and forth, and tapping a word in View all vocab opens it as a flashcard
- Opening the app takes you back to where you left off, even part way through a round; with sync on, your other devices pick up there too
- Leave a round part way and going back into that mode on that set carries on from the same card
- Stats shows your day streak, a calendar of the days you studied, weekly answers, accuracy and seconds per question, and accuracy for each set
- The app remembers how well you know each card and brings the hard ones back sooner, with a longer gap each time you get one right
- Switch between term first, definition first or mixed inside any mode, and swap all sides of a set
- Import and export single sets or everything as JSON
- Your sets are stored in your browser (localStorage). Your Library's Export all downloads everything to one JSON file, for a backup
- Your sets, progress, rewards and settings can sync across your devices, encrypted on the device first. See [below](#sync-between-your-devices)
- A browser with nothing saved starts with the demo sets from `demo-sets.json`. "Load demo sets" adds any that are missing and never changes your existing sets.

A bar tells you when a new version is ready, and Settings lets you check for updates and read what changed in every version. Once loaded, it works without a connection.

Add it to your phone's home screen from the browser's Share menu to use it like an app. On an iPhone or iPad this also keeps your sets safe, because Safari can delete a website's saved data after 7 days without use. The app reminds you, and Settings has the steps. The Home Screen app keeps its own copy, so sign in to Sync there or export and import to bring your sets across.

## Sync between your devices

**You don't need an account.** The app works fully without signing in, and you won't lose your data as long as you keep a backup: one button, Export all in Your Library, downloads everything to a single JSON file.

**This app is free.** If you'd like your phone and laptop to stay in step, sync is open to you too. Just sign up in the app, under Settings → Sync. It emails you a code to confirm your address.

- **Please email me to keep it.** To keep using sync after 24 hours, email <hazymat@gmail.com>. Otherwise your account may be deleted, though not within its first 24 hours unless the server has to be closed because of abuse. You won't lose anything if it is: your data stays on your device, and it just stops syncing.
- **Private by design.** Everything is encrypted on your device first, with a key made from your password. The server can't read your data, and nobody can reset your password, so save the recovery code it gives you.
- **Small limits for now.** Each account has a few MB, which is plenty for many sets, and only a few new accounts are taken each day. If today's have gone, try again tomorrow.

Prefer to run your own? The server is open source: see [server/README.md](server/README.md), then choose Use your own server in Settings → Sync.

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

Import also accepts a bare array of sets, or a single set object. If a set's `id` already exists and its cards differ, the app asks whether to merge, replace, keep both or skip. Identical sets are skipped. Optional fields on a set: `"description"`, `"created"` (`YYYY-MM-DD`), `"colour"` (`rose`, `coral`, `peach`, `butter`, `lime`, `mint`, `teal`, `sky`, `periwinkle`, `lavender`, `orchid` or `sand`), `"last_studied"` and `"last_opened"` (milliseconds since 1970), `"front"` (`definition` or `mixed`) for which side shows first, plus `"progress"`, `"learn_stages"`, `"card_ratings"`, `"tricky"`, `"active_ms"`, `"trophies"`, `"best_speed"` and `"daily_stats"` (one row a day, `"YYYY-MM-DD": [right, wrong, ms spent on timed answers, timed answers]`), which the app writes to record how well you know each card and feed the Stats page.

## Publishing a version

Merging to `main` deploys. For each release, add an entry to `WHATS_NEW` in `whatsnew.js`, set `VERSION` in `sw.js` to match, check each Show me, run `python3 tools/publish.py --now`, and commit.

MIT licensed. Reward pictures in `assets/rewards/` are from [Twemoji](https://github.com/jdecked/twemoji), © Twitter, Inc and other contributors, licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
