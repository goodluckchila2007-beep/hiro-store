# Hiro Store Admin — Design Requirements

These requirements apply to the admin dashboard only. The customer storefront keeps its separate visual identity.

## Visual direction
- Professional, clean, operational dashboard for a real digital-products business.
- Blue is the primary interaction colour: primary actions, links, active navigation and selected controls.
- Red is a restrained accent for destructive actions, critical alerts and selected highlights; do not use red for every button or large decorative panels.
- Use a calm light workspace, clear typography, consistent spacing, restrained borders/shadows and readable tables.
- Navigation should be compact, grouped by actual work, and responsive on smaller screens.

## Keep only useful operational areas
1. Overview
2. Catalogue & pricing
3. Orders & fulfilment (statuses should be filters/tabs within this area, not duplicate top-level destinations)
4. Customers
5. Promotions & rewards
6. Support inbox (retain the existing conversation/message workflow)
7. Reports
8. Settings
9. Security & activity log, only where backed by working functionality

## Do not add
- Empty placeholder pages or menu items that do nothing.
- Duplicate order destinations for processing/completed/refunded when they can be filters within Orders.
- Decorative charts, vanity metrics or repeated cards without operational value.
- Fake product prices, stock or supplier availability.

## Behaviour and safety
- Preserve existing authentication, sessions, order history, payment records, support conversations and FZR fulfilment behaviour.
- Newly imported offers remain unavailable until an administrator sets a positive NGN selling price and deliberately activates them.
- Supplier catalogue refresh must not overwrite administrator-set retail prices or availability.
- Keep the customer storefront's design separate from the blue/red admin identity.
