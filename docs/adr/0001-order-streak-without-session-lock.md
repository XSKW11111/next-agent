# Update the order streak on the session without a lock

Each order lookup updates the unmatched order streak on the session row at that moment: an unmatched lookup adds one, up to two, a match sets it to zero, and an unavailable lookup leaves it unchanged. Two turns may run in the same session without a lock, so each lookup applies its own update. A session lock would keep those turns from overlapping, and that lock is deferred.
