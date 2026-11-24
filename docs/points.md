# Points

A county is the baseline: **10 points**. Places that are rare, hard to reach or
nationally significant are worth more; everyday stops that number in the
thousands are worth less. The values live in each place's `pts` field and are
set by `scripts/fix-atlas-data.mjs` (the `POINTS` table), so re-running it keeps
them consistent. Repeat visits pay 100%, 85%, 50%, 25%, 10%, then nothing
(`src/lib/visits.ts`).

| Points | Places |
| --- | --- |
| 50 | A state (first time in it), national parks, state highpoints, World Heritage sites, the largest cities |
| 40 | State capitols, presidential sites, national forests, seashores and battlefields, big cities |
| 30 | Scenic drives and historic highways, fourteeners, space centers and launch sites, geographic oddities (Four Corners, the centers and farthest points), landmark bridges, mid-size cities |
| 25 | State parks, caves, the famous waterfalls, wildlife refuges, forts |
| 20 | Zoos, lighthouses, natural landmarks, dams, museum ships, tri-state corners, major airports and amusement parks, small cities |
| 15 | Historic sites, museums, gardens, national cemeteries, covered bridges, roadside attractions, classic diners and drive-ins, other named waterfalls, hot springs, mountain passes, lakes, heritage railroads, air & space museums, observatories, ghost towns, ski areas, tunnels, crossings of the six biggest rivers, historic districts on the Register |
| 10 | Counties, towns, single buildings on the National Register, beaches, stadiums, breweries, wineries, distilleries, other diners, regional foods, colleges, ferries, river crossings, state lines, smaller airports and amusement parks |
| 5 | Chain restaurants and stores, grocery stores, malls |

Reservations keep their size-based values (15 to 50), and towns stay 10 to 50 by
population.

River crossings and state lines sit on the Interstate or U.S. route itself
(worked out from the atlas's road lines), so driving the road checks them off.
Places that cover a lot of ground count from farther out than the usual
quarter mile: World Heritage sites 2 miles, space centers 1, ski areas 0.75,
colleges, dams and natural landmarks half a mile (`src/lib/travel.ts`). Lakes
are added by hand, since their map point is the middle of the water.

National Register listings count only when you're within 10 feet of them,
since there are about 87,000 and many share a street. A Register listing that
is already in the atlas under another category is merged into that place
(listed in `public/atlas/register-also.json`), and its card says it's also on
the Register.
