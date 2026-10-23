# Session URLs and ownership rollout

A new chat starts by creating a session and replacing `/` with `/chat/{sessionId}`. The URL identifies the session, while a session-specific HttpOnly cookie proves that the same browser created it. A missing, malformed, or unowned session URL redirects to `/`, which starts a new chat. Each session gets its own cookie so two tabs that create chats at the same time cannot overwrite each other's ownership token.

Apply `supabase/migrations/20261024120000_session_ownership.sql` before deploying the route change. New rows require `owner_hash` to be written by the session route. Rows created before the migration have no owner token to present to a browser. They remain in the database, but this release intentionally treats them as inaccessible and redirects their old URLs to a new chat. Recovering them by accepting a bare session ID would make a shared URL sufficient to read another chat, which conflicts with the ownership rule. If existing chat continuity is required, it needs a separate authenticated migration path before deployment.

The HTTP live evaluator forwards the session-specific cookie from the creation response to each message request. Its in-process mode supplies an owner hash when saving a fixture session. The URL and API routes check ownership before returning messages or allowing handoff decisions.
