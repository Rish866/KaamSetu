# Data attribution

## India locations (states/UTs, districts, PIN codes)
Department of Posts, Government of India. "All India Pincode Directory". Open Government Data (OGD) Platform India,
https://data.gov.in/catalog/all-india-pincode-directory. Used under the Government Open Data License – India (GODL-India),
https://data.gov.in/government-open-data-license-india.

Imported into migration `202611260001_pan_india_locations.sql` on 2026-11-26 by `scripts/geo/build-india-locations.py`
(36 states/UTs, 737 districts, 19,300 PIN codes). Changes made: state names mapped to two-letter codes, names title-cased,
post-office suffixes (B.O, S.O, H.O) removed, each PIN assigned to the district most of its offices are in, Delhi districts
grouped under the city "Delhi" and a few districts given the city name people search for (Mumbai, Bengaluru, Noida,
Ahmedabad). Coordinates were **not** imported: thousands of source rows contain placeholder or clearly wrong values.
The file was fetched from an unmodified republish (github.com/dropdevrahul/pincodes-india) whose columns match the
official dataset exactly; rights belong to the Department of Posts under GODL-India, not to that repository.
