# Wireless ADB Triage

## User Story

As an ADB support investigator, I want a wireless-debugging workflow, so that I can distinguish network identity, wireless debugging, adbd state, and pairing/connect symptoms.

## Acceptance Criteria

- Device network identity is captured.
- adbd and debugging properties are visible.
- Wireless debugging settings are checked.
- Recent adbd, pairing, TLS, or mDNS log hints are captured when present.

## INVEST Check

- Independent: can run on any selected online device.
- Negotiable: records evidence without restarting ADB or changing host identity.
- Valuable: supports pairing and reconnect investigations.
- Estimable: four bounded command steps.
- Small: focused on wireless ADB state, not full network diagnosis.
- Testable: command output appears in Copilot session history.

## Boundaries

This skill does not run destructive repair or host-key reset. Repair remains a separate explicit action.
