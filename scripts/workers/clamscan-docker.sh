#!/usr/bin/env bash
# Scans a directory with the official ClamAV image (signature database bundled in the image; refreshed when the image
# is rebuilt upstream). Prints clamscan lines "<path>: OK" / "<path>: <signature> FOUND". Exit 0 clean, 1 found, 2 error.
set -uo pipefail
dir="$1"
docker run --rm --network none -v "$dir":/scan:ro --entrypoint clamscan "${CLAMAV_IMAGE:-clamav/clamav:stable}" --no-summary --stdout -r /scan
