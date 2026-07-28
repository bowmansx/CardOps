# Strategy — how this folder works

A standing product strategy that keeps itself current, instead of a document
written once and quietly going stale.

**This is the one folder under `spec/` besides `OUTBOX.md` that the loop
writes to.** Everything else in your vault stays yours alone.

## The four files

| File | Who writes it | What it's for |
|---|---|---|
| [[BRIEF]] | **You** | Your input. Read at the START of every run. Anything you put here steers the next update — a new belief, a competitor you saw, a market you want considered, a direction you've changed your mind about. |
| [[STRATEGY]] | Me | The current strategy. **The source of truth**, and what the published page is rendered from. |
| [[CHANGES]] | Me | What I changed each run, and why. Newest first. Skim this to see whether a run did anything. |
| `journal/` | Me | One dated file per substantive update — the full document as it stood. This is how you see what the strategy USED to say. |

## The published page

<https://claude.ai/code/artifact/73cd1984-c3e3-44b6-be27-b3ec2e4a6baf>

Same URL forever. Print it, send it to your CPA, open it on a phone.

**Never edit that page.** It is generated from [[STRATEGY]] every run and any
direct edit is overwritten without warning. To change the strategy, edit the
markdown — or write what you want changed into [[BRIEF]] and let the next run
do it.

## The schedule

Every three days, and **cheap by default**. Each run:

1. Reads [[BRIEF]] for anything you've written
2. Reads the git log since the last run
3. **If nothing material changed, writes one line to [[CHANGES]] and stops.**
   That is the expected outcome most of the time and it costs almost nothing.
4. If something did change — you wrote in the brief, a feature shipped, a
   recommendation was taken or overtaken — it updates [[STRATEGY]], archives a
   dated copy in `journal/`, republishes the page, and explains itself in
   [[CHANGES]].

Deep market research is **not** on the 3-day cycle. The card market does not
move in three days and a research pass is expensive. Ask for one when you want
it, or expect roughly monthly.

The scheduler runs while Claude Code is open. If it's closed when a run is due,
it fires on next launch — so a week away means one run, not three.

## Why the file names aren't inbox/outbox

You described the brief as an "outbox". In `spec/` today, INBOX means *you
write, the loop reads* and OUTBOX means the reverse. Using those words the
other way round inside the same vault reads fine today and costs an hour of
confusion later, so they're named for what they do instead.
