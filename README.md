# Know the Verse

Know the Verse is a small, mobile-friendly game for memorizing song lyrics **you paste yourself**. Lessons follow the song: line order, next line, then a timed final run.

It is a static site. There is no account and no server. Lyrics stay in your browser.

## How to use it

1. Open a concert and tap a row that says **Needs lyrics**.
2. **Find lyrics** opens a web search for that title and artist in a new tab. Know the Verse does not download the page.
3. **Paste** reads the clipboard, drops navigation, ads, and credits, and keeps the longest lyric-like block. **Looks right** saves it to that setlist slot and opens the first lesson. If the clipboard is blocked, a paste box appears.
4. **Next song needing lyrics** moves to the next empty slot.
5. **Add song** on the home screen is the same paste flow when the song is not on a setlist. A first line like `Title - Artist` can name it.
6. You get five hearts, instant feedback, XP, and a score. A line counts as mastered after two correct answers.
7. Finish at least one lesson a day to keep a streak.
8. Edit or delete a song from its page. Deleting removes the words from this device. Scores can remain, without the words.

The only song included with the app is an original placeholder, **Banana Flashlight** by **The Placeholder Parade**. You can delete it and restore it from the Me tab.

### Games

The main path follows the song:

- **Line order** — put a few lines back in order (about four or five at a time). The line above the group stays visible as a dimmed anchor.
- **Next line** — choose the line that comes next.
- **Final run** — a timed pass through the whole song.

**Tricky lines** is a short warm-up: fill the blank, word order, and first letters.

Fill the blank, word order, first letters, and next line show the previous line above the question and the next line below it, in a quieter style. The first line has no previous line, and the last line has no next line. When a section label was in the paste, the question also shows it and the position, such as `Chorus · line 12 of 40`. Line order shows only the line above the group, not the lines in the shuffle.

Line order and word order check each tap immediately. An identical line can stand in for another with the same words. A wrong tap flashes and costs a heart, and the right one moves into the answer.

### Players, scores, and backup

The Me tab can hold more than one player on this device. Songs are shared on the device. XP, streaks, mastery, and scores belong to the active player.

The Board lists scores saved on this device. **Share my score** makes a card and a short text blurb with the song or concert name, the score, and the streak. The card does not include lyrics.

**Export progress** downloads a JSON file of scores, mastery counts, streaks, and XP. It is keyed by song title and artist and does not contain lyrics. **Import progress** merges a file like that and ignores any lyric text inside it. If both copies have a score, the higher one is kept.

## Concerts

A concert is a setlist folder. The list lives in [`concerts.json`](concerts.json) so it can be edited in the repo. Each entry is a **title and artist only**. Do not put lyrics in that file.

```json
{
  "title": "Song Title",
  "artist": "Artist Name"
}
```

The app ships with one concert, **LANY Soft World Tour**, labeled **Standard Asia Tour setlist**. Its running order is titles and artists in `concerts.json`, plus a link to the source setlist. Reload the site after editing the file.

On the concert page, each slot says **Needs lyrics** until someone pastes a song that matches that title and artist. Matching ignores case, punctuation, and a parenthetical tag, so `ILYSB` links to `ILYSB (Stripped)` and `Cause You Have To` links to `'Cause You Have To`. Extra words still count, so `Good` does not link to `Good Girls`. Pasting uses the same Add song box, with the setlist title and artist filled in. The page shows:

- songs mastered out of the setlist length
- your concert score, the sum of your best score on each linked song
- a leaderboard of players on this device
- how many of those players have a score

An empty setlist stays empty until `concerts.json` has songs. Nothing is fetched to fill it.

## Lyrics stay on this device

- The app does not upload lyrics, and it does not fetch them from lyric sites.
- Pasted lyrics are stored in `localStorage` in this browser only.
- Export files, share cards, the leaderboard, and `concerts.json` are limited to names, titles, artists, and scores.
- You are responsible for the lyrics you paste. Do not commit copyrighted lyrics to this repository. The sample song is original and is the only song that should ship with the app.

## Run it locally

ES modules and `concerts.json` need a local web server. Opening the HTML file directly will not work.

```bash
npm test
npm start
```

`npm start` serves the folder at [http://localhost:5173](http://localhost:5173). Any static server works:

```bash
python3 -m http.server 5173
```

## GitHub Pages

The site is the repository root. [`.nojekyll`](.nojekyll) is included so Pages serves every file.

1. Push the branch you want to publish. Pages usually tracks `main`.
2. Open the repository **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Choose branch `main` and folder **`/ (root)`**.
5. Save. The site will be at `https://<github-user>.github.io/lyric-trainer/`.

`concerts.json` is loaded from that same site. Editing it and pushing updates the setlist. Still do not put lyrics in it.

## A shared leaderboard later

Version 1 only knows about players on this device. Participant totals and a cross-device board need a backend, which this version does not include.

The score shape is already fixed so a Supabase table can be attached later. A remote row is only:

| column | meaning |
| --- | --- |
| `player_name` | display name |
| `concert` | concert id, such as `lany-soft-world-tour` |
| `song_title` | title only |
| `artist` | artist only |
| `score` | number |

There is no lyrics column. `createSupabaseProvider` in [`js/scores.js`](js/scores.js) speaks that shape, and `createScoreProvider` is the switch. Version 1 always returns the on-device provider. To connect Supabase later, return `createSupabaseProvider({ url, anonKey })` from that function and supply the URL and anon key at runtime. Do not commit keys. The concert page already reads `songScores` and `participantCount` from the provider, and it labels the current source **On this device**.
