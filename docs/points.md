# Points

A county is the baseline: **10 points**. Places that are rare, hard to reach or
nationally significant are worth more; everyday stops that number in the
thousands are worth less. The values live in each place's `pts` field and are
set by `scripts/fix-atlas-data.mjs` (the `POINTS` table), so re-running it keeps
them consistent. Repeat visits pay 100%, 85%, 50%, 25%, 10%, then nothing
(`src/lib/visits.ts`).

| Points | Places |
| --- | --- |
| 50 | A state (first time in it), national parks, state highpoints, the largest cities |
| 40 | State capitols, presidential sites, national forests, seashores and battlefields, big cities |
| 30 | Scenic drives, landmark bridges, mid-size cities |
| 25 | State parks, caves, waterfalls, wildlife refuges, forts |
| 20 | Zoos, lighthouses, major airports and amusement parks, small cities |
| 15 | Historic sites, museums, gardens, national cemeteries, covered bridges, roadside attractions, classic diners and drive-ins, historic districts on the Register |
| 10 | Counties, towns, single buildings on the National Register, beaches, stadiums, breweries, wineries, distilleries, regional foods, smaller airports and amusement parks |
| 5 | Chain restaurants and stores, grocery stores, malls |

Reservations keep their size-based values (15 to 50), and towns stay 10 to 50 by
population.

National Register listings count only when you're within 10 feet of them,
since there are about 87,000 and many share a street. A Register listing that
is already in the atlas under another category is merged into that place
(listed in `public/atlas/register-also.json`), and its card says it's also on
the Register.
