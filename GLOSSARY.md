# Support

The language of a customer's conversation with the support assistant.

## Language

**Customer**:
The one person a session is for.
_Avoid_: User, email, account

**Email**:
An address the customer supplies so the assistant can look up orders.
_Avoid_: Customer, contact email

**Contact email**:
The address the customer gives so a person can reach them about a handoff. It does not identify the customer.
_Avoid_: Email, order-search email

**Order**:
A purchase recorded under an email address. A lookup returns the orders for the address the customer typed, without proving they own that address.
_Avoid_: The customer's own purchases

**Product**:
A catalog item with a name and a stock level. It is absent only when a catalog result says so. Price, size, color, rating, and a stock-keeping code are not part of it.
_Avoid_: SKU, price, size, color, rating

**Local timezone**:
The timezone chosen for a session when it starts, and kept for that session. It is the timezone the customer's system reports. When the system reports none, it is the one timezone of their IP region.
_Avoid_: Pacific time

**Early Risers**:
A 10% morning discount for this session's customer, available from 08:00 to 10:00 in the local timezone. One claim in a session on a local day, and a repeat that day is that same claim.
_Avoid_: Pacific time, order-search email

**Claim**:
The customer's request for Early Risers, or their acceptance of it after an explanation, during 08:00–10:00 local. A general question about discounts is not a claim.
_Avoid_: A general discount question, a claim outside the window

**Session**:
One conversation for one customer.
_Avoid_: Shared inbox, multi-user chat

**Turn**:
One customer send in a session, identified by its turn id.
_Avoid_: Operation, lease, request

**Unmatched order streak**:
The count of consecutive order lookups in a session that did not find the order. A lookup that finds the order ends the streak. An unavailable lookup leaves the streak unchanged. At two, the assistant may offer a person.
_Avoid_: Failed order attempts, eligibility counter

**Person offer**:
The assistant suggesting a person once the unmatched order streak has reached two.
_Avoid_: Handoff, capture, case

**Proposal**:
A pending request for a person, for this session's customer, prepared only after they give a contact email. It may name an order number they give for the handoff. It waits for confirm or cancel.
_Avoid_: Case, ticket

**Case**:
The support case for this session's customer, reached at the contact email they gave. It exists only after the customer confirms a proposal, and it starts open. The customer does not close or resolve it. Cancel creates no case.
_Avoid_: Closed proposal, ticket
