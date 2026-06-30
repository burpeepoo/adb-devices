# Network Triage

## User Story

As a device investigator, I want a network workflow, so that I can separate interface, route, DNS, Android connectivity, and recent network-service failures.

## Acceptance Criteria

- Interfaces and routes are captured.
- DNS and network properties are visible.
- Connectivity service state is checked.
- Recent network errors are captured when present.

## INVEST Check

- Independent: runs with only a selected online device.
- Negotiable: observes device network state without changing configuration.
- Valuable: supports Calendar, account, browser, update, and cloud-service failures.
- Estimable: four bounded command steps.
- Small: focuses on device-side connectivity.
- Testable: evidence is stored in Copilot session history.

## Boundaries

This skill does not change Wi-Fi, proxy, DNS, or VPN settings.
