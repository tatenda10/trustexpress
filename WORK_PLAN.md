# Trust Express Work Plan

Ordered backlog for the next implementation steps. We should work top to bottom unless a blocker forces a reorder.

## 1. Admin Verification Workflow

- Add the automatic tier assessment summary to the main drivers list so admins can spot mismatches without opening each profile.
- Add the same assessment to the driver verification review flow, not only the driver details page.
- Add explicit approve or reject actions for vehicle verification based on the assessment result.
- Let admins override the recommended tier when they approve a vehicle.

## 2. Driver Vehicle Submission UX

- Show tier guidance on the driver car registration screen using the configured vehicle tier rules.
- Pre-fill or hint required fields based on the selected tier.
- Validate seat count, category, and feature fields more clearly on the client before submission.
- Show the driver whether their car appears to match the selected tier before they submit.

## 3. Server Validation And Approval Logic

- Use the configured vehicle tier rules during admin approval, not just for display.
- Store the final approved tier separately from the driver-selected tier.
- Add rejection reasons tied to failed assessment checks.
- Decide whether hard-required checks should block approval automatically or only warn the admin.

## 4. Vehicle Tier Rules Management

- Improve the admin `Vehicle Tiers` page with a cleaner editor for requirements and feature categories.
- Add rule structure for hard requirements vs preferred requirements vs informational examples.
- Add import/export support for tier rules.
- Add a reset-to-default action using the seeded Trust Express, Trust XL, and Trust Luxury definitions.

## 5. Data Model Cleanup

- Backfill older vehicle submissions that do not yet have structured fields like seat count or door count.
- Standardize vehicle metadata keys across client, server, and admin.
- Decide whether vehicle tier rules should stay in Clerk metadata flow only or move into MySQL-backed driver vehicle records.

## 6. Driver Operations UI

- Improve the incoming request simulation further with better transitions between requests.
- Replace the mock request queue with backend-driven live requests when ride dispatch is ready.
- Align accepted request state with trip lifecycle screens.

## 7. Testing And Stability

- Add server tests for tier matching logic.
- Add admin UI checks for the vehicle assessment rendering.
- Add regression checks for driver vehicle submission payload shape.
- Verify the admin build issue caused by local `spawn EPERM` and restore a reliable build/test path.

## 8. Open Product Decisions

- Should a driver be allowed to submit for multiple tiers at once, or only one selected tier?
- Should Luxury and XL require manual approval even when all checks pass?
- Should example vehicles affect scoring or stay informational only?
- Should the passenger app expose tier qualification differences more explicitly during booking?
