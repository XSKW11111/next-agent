# Early Risers uses the session's local timezone

Early Risers follows the timezone fixed at session start, not Pacific: the system timezone wins, and a single-timezone IP region is the fallback. A code is issued only from 08:00 to 10:00 local, once per local day, lasting until the next local midnight. If no timezone can be resolved, no code is issued.
