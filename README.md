# house-hunting-v2

A house-hunting tool that scores listings against one buyer's actual rules
instead of a generic idea of a good house.

Portals rank by price, beds and square feet. None of those is why anyone
rejects a house. This measures the things that do: which way the front door
faces, how wide the smallest bedroom really is, whether the drive to work is
survivable in evening traffic, and whether the pantry is actually the laundry
room.

---

## The design, in one idea

**A model says what it can see. Code decides what that is worth.**

Vision reads a floor plan and answers "is there a bedroom on this storey, and
what are its printed dimensions". It is never asked "is this a good house".
Every judgement lives in TypeScript where it can be read, argued with, and
unit-tested. This split is the whole architecture, and most of what follows is
a consequence of it.

## What it measures that portals do not

**Facing direction, with honest confidence.** The bearing from the house to
the nearest Street View camera, with the *distance to that camera* setting the
confidence. A reading taken off a road forty metres away reports a concern; one
taken off a camera twelve metres away can rule a house out. The threshold lives
on the reading, not on the rule, so the same number cannot be "too unreliable
to reject" and "reliable enough to award full marks".

**Bedroom size, by the short wall.** A 143 sq ft bedroom sounds fine and is
not, if it is ten feet wide with two doors opening inward. Areas hide that;
the narrow wall does not. Dimensions are read off the plan and the primary is
excluded, because the complaint is never about the primary.

**Age-restricted communities.** 55+ status appears nowhere in the structured
data. It is stated in the listing prose, in words, and only there — so the
description is parsed for it. A buyer with a young child cannot live in one at
any price, so it rules out before anything else is scored.

**The subject property's own description.** A listing page carries the
marketing remarks of every comparable it shows. Searching the HTML finds a
neighbour's text and attributes it to this house. The schema.org block keyed to
the subject is read instead, with "About this home" as a fallback.

**Real commute, in the right direction.** Morning in and evening out, measured
work-to-home for the evening leg, because that is the direction the traffic is
going. Scored against a configurable ceiling, on the bad-day figure rather than
the average.

**Demographics at block-group level**, not tract. A census tract is four
thousand people across a wide area and says almost nothing about a street.

## What it deliberately does not do

- **Vastu beyond the entrance rule is reported, never scored.** Showing someone
  a reading they asked to see is different from ranking them on beliefs they
  have not settled.
- **The fence is a fact on the card, not a cap on the score.** A fence is a
  purchase. A south-facing door is the house.
- **Unknown reads as unknown.** A dimension with no data is excluded from the
  weighted average rather than scored at fifty, and the overall score is capped
  by how much of the house was actually read. Guessing in the middle looks like
  knowledge and is not.

## Running it

```bash
git clone https://github.com/skg0525/house-hunting-v2.git
cd house-hunting-v2
npm --prefix backend install && npm --prefix frontend install
npm --prefix backend run dev            # API -> http://localhost:8788
npm --prefix frontend run dev           # UI  -> http://localhost:3001
```

**No API keys are needed.** The repository ships the data the app reads —
189 listings and the vision reads that go with them, in
`backend/.localstore/`. Every score, dimension and panel renders from that
without calling anything.

Keys only matter for *adding* houses: `GEMINI_API_KEY` reads floor plans and
photos, `GOOGLE_MAPS_API_KEY` does geocoding, Street View and Routes. Without
them the app starts, says so on the console, and everything already in the
store works normally. Set them in `backend/.env` if you want to paste new
listings in.

`HOME_ADDRESS` and `WORK_ADDRESS` are optional and only affect commute
measurement for newly added houses.

All state is JSON on disk under `backend/.localstore/`, readable and editable
by hand.

## Checks

These print rather than assert. Read the output.

```bash
npm --prefix backend run keys            # which API keys actually work
npm --prefix backend run check:geometry  # bearing maths against known points
npm --prefix backend run check:scoring   # do the hard rules fire
npm --prefix backend run check:pipeline  # paste -> score -> narrative
npm --prefix backend run check:agreement # does the app contradict itself?
```

`check:agreement` is the one worth explaining. Nearly every real bug here has
had the same shape: two parts of the app holding different answers to one
question, each perfectly confident. A photo badge saying "OPEN TODAY" beside a
parsed schedule that is empty. A description saying 55+ beside a field saying
otherwise. Checking each value alone never finds those. Asking whether they
agree does.

## Layout

```
backend/src/services/   orientation, commute, scoring, vision, census, plans
backend/src/types/      the Listing shape and the preference profile
backend/scripts/        the checks above, plus one-off measurement passes
frontend/src/           Next.js app — list, detail, map, comparison
```

The comments are long on purpose. Most of them exist because something was
wrong once, and the story of how it was wrong is the reason the code is shaped
the way it is. A comment saying *what* the code does is noise; one saying why a
plausible alternative was rejected is the only durable documentation there is.
