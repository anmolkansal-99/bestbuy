# Best Buy Canada laptop monitor

Watches this listing and emails you the moment something worth buying changes:

**Gaming laptops · Open Box / Geek Squad Open Box / Refurbished Excellent · $200 to $1,950**

Each check compares what the site shows now with what it showed last time. You get **one email** with:

- **New laptops**, as full cards: photo, price and savings, condition, CPU / GPU / RAM / storage, rating, availability, first-seen time, and a *View & buy* button. When the site provides them, the product description and full spec table are included too.
- **Price drops** (old price, new price, % off), **back in stock**, and **gone from the listing**.
- An **old vs new** summary (laptops listed, cheapest, median) and a **full list of every laptop** with its status (New, Drop, Restock, Same, Gone), plus a **CSV** attachment with the same comparison.
- A **coverage line**, for example *Checked the complete list: 58 of 58 listings (3 pages of results)*, so you can see that every "Show more" page was read.

Nothing is sent when nothing changed. The first run emails a starting snapshot (so you can see that it works); after that only changes.

## How it works

It calls the same JSON API the category page uses, with the filters copied from your URL, and keeps its memory in `data/state.json`. A laptop must be missing for 3 checks in a row before it counts as gone, so a glitchy response never creates fake "new" laptops. If the site can't be read, the run is treated as a failure and nothing is compared, so a half-loaded page can't cause false alerts. If an email can't be sent, the snapshot is **not** saved, so the next check delivers the same news again.

### The whole list, not just the first page ("Show more")

The category page shows 24 laptops at a time and **Show more** loads the next 24. The monitor makes the same requests, page 1, 2, 3 and so on, until the site says the list is over, so every comparison covers **all** laptops.

- The number of pages comes from the site's own totals, not from a guess. Up to `MAX_PAGES` pages are read (40 pages = 960 laptops). A longer list is reported as an error and never cut off silently.
- Every email says what was read: *Checked the complete list: 58 of 58 listings (3 pages of results)*.
- If a laptop sells or appears while the pages are being read, later pages shift by one and a laptop could slip past. The monitor notices that the site's total changed during the read and reads the list again, merging both reads.
- If the full list can't be read (a page fails, the site ignores the page number, or the result is far below the site's own total), the check **fails instead of comparing**. A half-read list can therefore never cause fake "new" or "removed" laptops. You get an email if this lasts 45 minutes.

## Deploy for free on GitHub Actions (about 10 minutes)

The workflow in `.github/workflows/monitor.yml` runs every 5 minutes on GitHub's servers, which cost you nothing for a **public** repository. (A private repo only gets a limited number of free minutes, and this schedule needs roughly 8,600 a month.) Your email address and password stay in encrypted secrets; the repo only contains listing data.

1. **Gmail app password.** Google Account → Security → turn on 2-Step Verification → *App passwords* → create one and copy the 16 characters. Any other SMTP service works too (`SMTP_HOST`, `SMTP_PORT`).
2. **Create the repo and push this folder:**
   ```bash
   git init -b main
   git add .
   git commit -m "Best Buy laptop monitor"
   gh repo create bestbuy-laptop-monitor --public --source=. --push
   ```
3. **Add the secrets** (repo → Settings → Secrets and variables → Actions, or with the CLI):
   ```bash
   gh secret set MAIL_TO      # the address that should receive reports
   gh secret set SMTP_USER    # the Gmail address that sends them
   gh secret set SMTP_PASS    # the app password from step 1
   ```
4. **Test it.** Actions tab → *Best Buy laptop monitor* → *Run workflow* → tick **Only send a test email** → check your inbox.
5. **Start it.** Run the workflow again without the tick (or just wait for the schedule). You get the *Monitor started* email listing every current laptop. From then on you only hear about changes.

| Secret | Required | Meaning |
|---|---|---|
| `MAIL_TO` | yes | Recipient(s), comma separated |
| `SMTP_USER`, `SMTP_PASS` | yes | SMTP login (Gmail address + app password) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | no | Defaults: `smtp.gmail.com`, `465`, same as `SMTP_USER` |
| `HTTPS_PROXY` | no | Only if bestbuy.ca blocks GitHub (see below) |

## Settings

Environment variables (GitHub: add them to the `env:` block of the poll step; locally: `.env`).

| Variable | Default | |
|---|---|---|
| `NOTIFY_ON` | `new,price_drop,restock` | Add `removed` and/or `price_increase` for those alerts too |
| `MIN_PRICE_DROP` | `1` | Ignore price drops smaller than this many CAD |
| `REGION` | `ON` | Province used for prices and availability |
| `BASELINE_EMAIL` | `true` | Email the starting snapshot on the first run |
| `REPORT_TZ` | `Asia/Kolkata` | Time zone shown in emails (Toronto time is shown beside it) |
| `FETCH_DETAILS` | `true` | Fetch description and specs for new laptops |
| `FAILURE_ALERT_AFTER_MINUTES` | `45` | How long the site must be unreadable before you are told |
| `MAX_PAGES` | `40` | Safety stop for very long lists (24 laptops per page). A longer list is an error, never silently cut |
| `MIN_COVERAGE_PERCENT` | `90` | The check fails if the site returns less than this share of the total it reports. A smaller gap is allowed but shown as a warning in the email |
| `PAGE_URL` | your URL | Watch a different category or filter set |

You will also get one email if the site stays unreadable for 45 minutes (then a reminder every 24 hours), and one when it recovers.

## Run it on your own machine or a free VM instead

```bash
npm install
cp .env.example .env     # fill in MAIL_TO, SMTP_USER, SMTP_PASS
npm run preview          # writes out/report.html; sends and saves nothing
npm run watch            # checks every ~2 minutes (POLL_INTERVAL_SECONDS)
```

Needs Node 22.9 or newer. To keep it running after you close the terminal: `pm2 start "npm run watch" --name bestbuy`, or a systemd service. Oracle Cloud's Always Free VMs work for this, though Oracle may reclaim idle free instances. A home PC or Raspberry Pi works too.

`npm run watch` checks more often than GitHub's schedule can (GitHub's 5-minute cron is best effort and often starts a few minutes late when busy).

## If Best Buy blocks the server

Best Buy sits behind bot protection that sometimes refuses cloud IP addresses. Symptoms: the *Monitor started* email never arrives, the Actions log says `blocked:403`, and after 45 minutes you get a "can't read Best Buy" email. Options, easiest first:

1. **Run it at home** with `npm run watch` (home connections are rarely blocked).
2. **Keep GitHub Actions but run on your own computer**: install a [self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners) and change `runs-on: ubuntu-latest` to `runs-on: self-hosted`.
3. **Use a proxy**: add an `HTTPS_PROXY` secret (for example `http://user:pass@host:port`). The workflow routes the Best Buy requests through it. Needs a proxy located in Canada.

## Checking the data

The field names were taken from published descriptions of the bestbuy.ca search API and have not been confirmed against the live site, so check once after setup:

- The first email ends its intro with a **Sanity check** line: laptop count by condition, the price range, and the coverage (*Checked the complete list: N of N listings*). It should say Open Box / Geek Squad Open Box / Refurbished and prices between $200 and $1,950, and **N should be the number of laptops you see on the website after pressing "Show more" until the button is gone**.
- A warning such as *⚠ Checked 55 of 58 listings* means the site counted more laptops than it returned. The run log shows the same numbers (`read 55 of 58 listings (3 pages of results, 2 reads)`), and `npm run dump-raw` saves the first raw products to `out/raw-sample.json` so you can see exactly what the site sends.
- If the wrong laptops show up, or the monitor keeps failing with `incomplete`, open the category page, press F12 → Network, press **Show more** and find the `search?` request it makes. Copy that request URL and set it as `API_URL`. The monitor then uses it for every page.
- If availability or prices look off, run `npm run dump-raw` and look at `out/raw-sample.json`: it holds the first three raw products exactly as the site returned them.

## Things to know

- GitHub pauses scheduled workflows after 60 days without repository activity. The monitor commits a small heartbeat to `data/state.json` every 20 days, so that does not happen.
- Don't delete `data/state.json` unless you want to start over with a new baseline.
- Open-box units are one of a kind: an email gets you a head start, not a reservation.
- This is meant for personal use at a modest rate (one check every few minutes). Please keep it that way and respect Best Buy's terms of use.
- `npm test` runs the whole thing against a mock Best Buy API and a local mail server: baseline, new laptops, price drops, restocks, glitches, a blocked site, a failing mail server, and multi-page lists (a new laptop on the last page, a laptop sold while the pages are being read, a site that ignores the page number, totals that are missing or too small, very long lists).
