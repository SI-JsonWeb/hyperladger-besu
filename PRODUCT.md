# Product

## Register

product

## Users

Blockchain developers using this repository as a hands-on tutorial for Besu/Quorum dapp integration. They are running a local network, deploying or exercising the `DoubleFinancingPreventer` contract, calling the NestJS backend, and using the frontend to see contract behavior without stitching every request together manually.

Their session goal is to understand the end-to-end flow: register an asset, pledge it for financing, trigger and inspect a duplicate-financing attempt, repay and release the lien, register an off-chain file hash, verify that hash, and observe the related events or indexed records.

## Product Purpose

This project demonstrates how a Besu/Quorum-backed application can prevent double financing by recording asset liens on-chain, flagging repeated financing attempts, and tying off-chain files to on-chain SHA-256 hashes.

The frontend is a developer-facing tutorial console. It should make each protocol step visible, teach what changed in contract state, and help developers confirm that the smart contract, backend API, Next.js proxy, and supporting indexer are wired correctly. Success means a developer can run one local scenario and leave understanding both the business rule and the technical path that enforces it.

## Brand Personality

Clear, educational, approachable.

The interface should feel technical enough for blockchain developers, but not like a security operations center. Copy should explain the workflow plainly, use exact protocol terms, and reveal what each action will do before the developer clicks. The tone is instructional and calm: guide the user through the scenario, show cause and effect, and avoid assuming prior familiarity with every Besu or Ethereum detail.

## Anti-references

- Crypto hype pages with speculative language, token visuals, or decorative Web3 futurism.
- Hacker-terminal dashboards that make a tutorial feel more dangerous or production-critical than it is.
- Generic SaaS admin screens that hide the contract state transitions behind vague labels.
- Finance-app polish that implies this is a production borrower or lender workflow rather than a developer tutorial.
- Dense blockchain tooling that exposes raw hashes and addresses without explaining what the developer should learn from them.

## Design Principles

1. Teach the protocol through the workflow. Each screen should make the next step obvious and connect the UI action to the contract/API behavior it exercises.
2. Keep state visible. Asset ownership, pledge status, lien amount, file hash status, flagged accounts, backend health, and recent activity should remain easy to inspect while working.
3. Use precise labels over atmosphere. Prefer action labels and result messages that name the actual operation: register asset, request financing, repay lien, register file hash, verify hash.
4. Separate tutorial confidence from production trust. The UI should feel reliable and well-made, but should not imply consumer-grade finance readiness or hide demo assumptions.
5. Preserve developer control. Show endpoints, IDs, hashes, account addresses, and event outcomes in a readable way so developers can cross-check with the backend, contract, Redis indexer, or explorer.

## Accessibility & Inclusion

Target WCAG AA for future UI work. Prioritize readable contrast for body text, labels, placeholders, code, and status text on dark surfaces. Do not rely on color alone for success, danger, pledged, free, or flagged states. Motion should be minimal and state-driven, with reduced-motion-safe behavior. Tutorial copy should be understandable to developers new to Besu/Quorum while still using accurate Ethereum and contract terminology.
